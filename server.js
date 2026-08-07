import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const {
  FASTSPRING_USERNAME,
  FASTSPRING_PASSWORD,
  FASTSPRING_API_BASE = "https://api.fastspring.com",
  FASTSPRING_WEBHOOK_SECRET,
  PORT = 3000,
} = process.env;

if (!FASTSPRING_USERNAME || !FASTSPRING_PASSWORD) {
  throw new Error(
    "Missing FASTSPRING_USERNAME or FASTSPRING_PASSWORD - see .env.example",
  );
}
if (!FASTSPRING_WEBHOOK_SECRET) {
  throw new Error("Missing FASTSPRING_WEBHOOK_SECRET - see .env.example");
}

const authHeader =
  "Basic " +
  Buffer.from(`${FASTSPRING_USERNAME}:${FASTSPRING_PASSWORD}`).toString(
    "base64",
  );

// Checkout Components sessions have to be created against this
// checkout-scoped v2 endpoint (not the generic /sessions one) - confirmed
// from a working reference implementation. Account/checkout match the
// checkoutUrl the frontend initializes the SDK with. Different checkouts
// have their own renewal/domain-whitelisting config, so each frontend flow
// (game store vs gym) passes its own checkoutPath rather than sharing one.
const FASTSPRING_ACCOUNT = "thoran";
const DEFAULT_CHECKOUT_PATH = "components-gaming";

// Any product tagged with this sku (case-sensitive, set in the dashboard)
// is treated as part of the storefront catalog - no path list to maintain.
const CATALOG_SKU = "GAME";

const app = express();

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// Raw body needed here for signature verification - must be registered
// before express.json() below, and only applies to this one path.
app.post(
  "/webhooks",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const signature = req.get("x-fs-signature");
    if (!signature) {
      return res.status(400).send("Missing X-FS-Signature header");
    }

    const expected = crypto
      .createHmac("sha256", FASTSPRING_WEBHOOK_SECRET)
      .update(req.body)
      .digest("base64");

    const signatureBuf = Buffer.from(signature, "base64");
    const expectedBuf = Buffer.from(expected, "base64");
    const valid =
      signatureBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(signatureBuf, expectedBuf);

    if (!valid) {
      console.warn("Webhook signature mismatch - rejecting");
      return res.status(401).send("Invalid signature");
    }

    let payload;
    try {
      payload = JSON.parse(req.body.toString("utf8"));
    } catch {
      return res.status(400).send("Invalid JSON");
    }

    // FastSpring can batch multiple events per POST and may redeliver the
    // same event more than once - dedupe on event.id if you persist these.
    for (const event of payload.events ?? []) {
      console.log(`Webhook event: ${event.type} (${event.id})`, event.data);

      // order.completed doesn't include a subscription ID - this is the
      // one reliable place to find it, since it's the subscription object
      // itself (data.id, with a legacy "subscription" alias for the same).
      if (event.type === "subscription.activated") {
        console.log(
          `  -> subscription.activated: id=${event.data?.id} account=${event.data?.account}`,
        );
      }
    }

    res.sendStatus(200);
  },
);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Session creation has to happen server-side - it's the one step that
// needs the store's API credentials, which must never reach the browser.
// The client only ever sees the resulting session id.
app.post("/api/session", async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    productPath,
    checkoutPath = DEFAULT_CHECKOUT_PATH,
  } = req.body ?? {};
  if (!email) {
    return res.status(400).json({ error: "email is required" });
  }
  if (!productPath) {
    return res.status(400).json({ error: "productPath is required" });
  }

  try {
    const response = await fetch(
      `${FASTSPRING_API_BASE}/v2/checkouts/${FASTSPRING_ACCOUNT}/${checkoutPath}/sessions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({
          locale: "en",
          country: "US",
          live: true,
          customer: {
            billToContact: {
              email,
              firstName,
              lastName,
            },
          },
          cart: {
            lineItems: [{ productPath, quantity: 1 }],
          },
        }),
      },
    );

    const data = await response.json();
    if (!response.ok) {
      console.error("Session creation failed", data);
      return res
        .status(502)
        .json({ error: "Failed to create session", details: data });
    }

    res.json(data);
  } catch (err) {
    console.error("Session creation error", err);
    res.status(500).json({ error: "Failed to create session" });
  }
});

// Discovers the storefront catalog dynamically: list every product on the
// account, then keep only the ones tagged sku === "GAME" in the dashboard.
app.get("/api/products", async (req, res) => {
  try {
    const listResponse = await fetch(`${FASTSPRING_API_BASE}/products`, {
      headers: { Authorization: authHeader },
    });
    const listData = await listResponse.json();
    if (!listResponse.ok) {
      console.error("Product list fetch failed", listData);
      return res
        .status(502)
        .json({ error: "Failed to list products", details: listData });
    }

    const allPaths = Array.isArray(listData.products) ? listData.products : [];
    if (allPaths.length === 0) {
      return res.json({ products: [] });
    }

    const rawProducts = [];
    for (const batch of chunk(allPaths, 50)) {
      const detailResponse = await fetch(
        `${FASTSPRING_API_BASE}/products/${batch.join(",")}`,
        { headers: { Authorization: authHeader } },
      );
      const detailData = await detailResponse.json();
      if (!detailResponse.ok) {
        console.error("Product detail fetch failed", detailData);
        continue;
      }
      const items = Array.isArray(detailData.products)
        ? detailData.products
        : [detailData];
      rawProducts.push(...items);
    }

    const products = rawProducts
      .filter((p) => p && p.product && p.sku === CATALOG_SKU)
      .map((p) => ({
        productPath: p.product,
        display: typeof p.display === "string" ? p.display : p.display?.en,
        price:
          p.pricing?.price?.USD != null
            ? `$${Number(p.pricing.price.USD).toFixed(2)}`
            : null,
        image: p.image || null,
      }));

    res.json({ products });
  } catch (err) {
    console.error("Products fetch error", err);
    res.status(500).json({ error: "Failed to load products" });
  }
});

// Order IDs and subscription IDs are both opaque strings that show up next
// to each other in the dashboard, so pasting the wrong one is an easy
// mistake to make. If the given ID isn't a subscription, check whether it's
// actually an order and use *its* subscription instead of just failing.
async function resolveSubscriptionId(id) {
  const subResponse = await fetch(`${FASTSPRING_API_BASE}/subscriptions/${id}`, {
    headers: { Authorization: authHeader },
  });
  const subData = await subResponse.json();
  if (subResponse.ok && subData.result === "success") {
    return { subscriptionId: id, resolvedFrom: "subscription" };
  }

  const orderResponse = await fetch(`${FASTSPRING_API_BASE}/orders/${id}`, {
    headers: { Authorization: authHeader },
  });
  const orderData = await orderResponse.json();
  if (orderResponse.ok && orderData.result === "success") {
    const subscriptionId = orderData.items?.find(
      (item) => item.subscription,
    )?.subscription;
    if (subscriptionId) {
      return { subscriptionId, resolvedFrom: "order" };
    }
  }

  return null;
}

// Managed Subscriptions have no fixed price on the product itself - the
// seller decides what to charge and when. Doing that is two separate API
// calls: set the price for this cycle, then trigger a rebill at that price.
app.post("/api/subscriptions/:id/charge", async (req, res) => {
  const inputId = req.params.id;
  const amount = Number(req.body?.amount);

  if (!inputId) {
    return res.status(400).json({ error: "subscription id is required" });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return res
      .status(400)
      .json({ error: "amount must be a positive number" });
  }

  try {
    const resolved = await resolveSubscriptionId(inputId);
    if (!resolved) {
      return res.status(404).json({
        error: `Could not find a subscription for "${inputId}" - checked it as both a subscription ID and an order ID`,
      });
    }
    const subscriptionId = resolved.subscriptionId;

    const priceResponse = await fetch(`${FASTSPRING_API_BASE}/subscriptions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        subscriptions: [
          {
            subscription: subscriptionId,
            pricing: { price: { USD: amount } },
          },
        ],
      }),
    });
    const priceData = await priceResponse.json();
    const priceResult = priceData.subscriptions?.[0];
    if (!priceResponse.ok || priceResult?.result !== "success") {
      console.error("Setting subscription price failed", priceData);
      return res
        .status(502)
        .json({ error: "Failed to set charge amount", details: priceData });
    }

    const chargeResponse = await fetch(
      `${FASTSPRING_API_BASE}/subscriptions/charge`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({
          subscriptions: [{ subscription: subscriptionId }],
        }),
      },
    );
    const chargeData = await chargeResponse.json();
    const chargeResult = chargeData.subscriptions?.[0];
    if (!chargeResponse.ok || chargeResult?.result !== "success") {
      console.error("Charging subscription failed", chargeData);
      return res.status(502).json({
        error: "Charge failed",
        details: chargeResult || chargeData,
      });
    }

    res.json({
      subscription: subscriptionId,
      amount,
      result: "success",
      resolvedFrom: resolved.resolvedFrom,
    });
  } catch (err) {
    console.error("Subscription charge error", err);
    res.status(500).json({ error: "Failed to process charge" });
  }
});

// Admin member list - every subscription for the given product plus its
// account contact info (subscriptions don't carry the customer's email/name
// directly, only an account ID, so this is a list call followed by a bulk
// account lookup). Shared across every admin panel (gym, thrift, ...) -
// each just passes its own product path, so this stays in one place rather
// than duplicating the account-lookup logic per admin panel.
app.get("/api/members", async (req, res) => {
  const product = req.query.product;
  if (!product) {
    return res.status(400).json({ error: "product query param is required" });
  }

  try {
    const subsResponse = await fetch(
      `${FASTSPRING_API_BASE}/subscriptions?products=${product}&scope=test`,
      { headers: { Authorization: authHeader } },
    );
    const subsData = await subsResponse.json();
    if (!subsResponse.ok) {
      console.error("Listing subscriptions failed", subsData);
      return res
        .status(502)
        .json({ error: "Failed to list subscriptions", details: subsData });
    }

    const subs = (subsData.subscriptions || []).filter(
      (s) => s && typeof s === "object",
    );
    if (subs.length === 0) {
      return res.json({ members: [] });
    }

    // Unlike /products and /orders, /accounts doesn't support a
    // comma-separated batch lookup - it just treats the joined string as
    // one (invalid) id. Fetch each unique account individually instead.
    const accountIds = [...new Set(subs.map((s) => s.account))];
    const accountResults = await Promise.all(
      accountIds.map((id) =>
        fetch(`${FASTSPRING_API_BASE}/accounts/${id}`, {
          headers: { Authorization: authHeader },
        }).then((r) => r.json()),
      ),
    );
    const contactByAccount = new Map(
      accountResults
        .filter((a) => a.result === "success")
        .map((a) => [a.account, a.contact]),
    );

    const members = subs.map((s) => {
      const contact = contactByAccount.get(s.account) || {};
      return {
        id: s.id,
        accountId: s.account,
        email: contact.email || null,
        name: [contact.first, contact.last].filter(Boolean).join(" ") || null,
        state: s.state,
        price: s.priceDisplay,
        begin: s.beginDisplay,
        nextChargeDate: s.nextChargeDateDisplay,
      };
    });

    res.json({ members });
  } catch (err) {
    console.error("Members fetch error", err);
    res.status(500).json({ error: "Failed to load members" });
  }
});

app.post("/api/subscriptions/:id/cancel", async (req, res) => {
  const inputId = req.params.id;

  try {
    const resolved = await resolveSubscriptionId(inputId);
    if (!resolved) {
      return res.status(404).json({
        error: `Could not find a subscription for "${inputId}" - checked it as both a subscription ID and an order ID`,
      });
    }

    const response = await fetch(
      `${FASTSPRING_API_BASE}/subscriptions/${resolved.subscriptionId}`,
      { method: "DELETE", headers: { Authorization: authHeader } },
    );
    const data = await response.json();
    const result = data.subscriptions?.[0];
    if (!response.ok || result?.result !== "success") {
      console.error("Canceling subscription failed", data);
      return res
        .status(502)
        .json({ error: "Cancel failed", details: result || data });
    }

    res.json({
      subscription: resolved.subscriptionId,
      result: "success",
      resolvedFrom: resolved.resolvedFrom,
    });
  } catch (err) {
    console.error("Subscription cancel error", err);
    res.status(500).json({ error: "Failed to cancel subscription" });
  }
});

app.listen(PORT, () => {
  console.log(`Payment Components demo running at http://localhost:${PORT}`);
});
