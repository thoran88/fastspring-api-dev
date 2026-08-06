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
// checkoutUrl the frontend initializes the SDK with.
const FASTSPRING_ACCOUNT = "thoran";
const FASTSPRING_CHECKOUT_PATH = "components-gaming";

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
  const { firstName, lastName, email, productPath } = req.body ?? {};
  if (!email) {
    return res.status(400).json({ error: "email is required" });
  }
  if (!productPath) {
    return res.status(400).json({ error: "productPath is required" });
  }

  try {
    const response = await fetch(
      `${FASTSPRING_API_BASE}/v2/checkouts/${FASTSPRING_ACCOUNT}/${FASTSPRING_CHECKOUT_PATH}/sessions`,
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

app.listen(PORT, () => {
  console.log(`Payment Components demo running at http://localhost:${PORT}`);
});
