import crypto from "node:crypto";
import express from "express";

const router = express.Router();

// POST /subscriptions/renew (managed subscription renewals, released 26.4.5).
// One call per batch of up to 50 managed subs. FastSpring picks the track
// per sub: Track A charges the saved payment method, Track B raises a
// renewal invoice and emails the buyer a Pay Now link.
//
// The endpoint is async. The first call returns 202, and you poll by sending
// the SAME Idempotency-Key with the SAME body until it returns 200 with a
// final status. A different body on the same key returns 409, so the page
// keeps the exact payload it sent and posts it back here for every poll.

const MAX_BATCH = 50;
const ITEM_FIELDS = new Set([
  "subscription",
  "pricing",
  "quantity",
  "netTerms",
  "simulate",
  "reasonCode",
]);

// Only the fields the endpoint accepts, in a fixed order, so the body we
// send on the first call and on every poll stringifies the same way.
function buildPayload(input) {
  const items = Array.isArray(input?.subscriptions) ? input.subscriptions : [];
  if (items.length === 0 || items.length > MAX_BATCH) {
    throw new Error(`subscriptions must have 1 to ${MAX_BATCH} items`);
  }

  const subscriptions = items.map((item, i) => {
    for (const key of Object.keys(item)) {
      if (!ITEM_FIELDS.has(key)) {
        throw new Error(`subscriptions[${i}].${key} is not a supported field`);
      }
    }
    if (!item.subscription) {
      throw new Error(`subscriptions[${i}].subscription is required`);
    }

    const out = { subscription: String(item.subscription).trim() };
    if (item.pricing?.price !== undefined && item.pricing.price !== "") {
      out.pricing = { price: item.pricing.price };
    }
    if (item.quantity !== undefined && item.quantity !== "") {
      out.quantity = Number(item.quantity);
    }
    if (item.netTerms !== undefined && item.netTerms !== "") {
      out.netTerms = Number(item.netTerms);
    }
    if (item.simulate) out.simulate = item.simulate;
    if (item.reasonCode) {
      if (item.simulate !== "failure") {
        throw new Error(
          `subscriptions[${i}].reasonCode only works with simulate: "failure"`,
        );
      }
      out.reasonCode = item.reasonCode;
    }
    return out;
  });

  const payload = {};
  if (input.netTerms !== undefined && input.netTerms !== "") {
    payload.netTerms = Number(input.netTerms);
  }
  payload.subscriptions = subscriptions;
  return payload;
}

async function getSubscription(fs, id) {
  const res = await fetch(`${fs.apiBase}/subscriptions/${id}`, {
    headers: { Authorization: fs.auth },
  });
  const data = await res.json();
  if (!res.ok || data.result === "error") return null;
  return data;
}

// tariqh is a production store, so a renew on a live sub can move real
// money. Refuse anything that isn't a test-mode sub before calling FastSpring.
async function assertAllTestSubs(fs, payload) {
  const subs = await Promise.all(
    payload.subscriptions.map((s) => getSubscription(fs, s.subscription)),
  );
  subs.forEach((sub, i) => {
    const id = payload.subscriptions[i].subscription;
    if (!sub) throw new Error(`Subscription ${id} not found on ${fs.name}`);
    if (sub.live === true) {
      throw new Error(
        `Subscription ${id} is a live subscription. This page only renews test subscriptions.`,
      );
    }
  });
}

router.post("/api/renew", async (req, res) => {
  let payload;
  try {
    payload = buildPayload(req.body?.payload);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const isPoll = Boolean(req.body?.idempotencyKey);
  const idempotencyKey = req.body?.idempotencyKey || crypto.randomUUID();

  try {
    // Check once on the first call. Polls reuse the same body, so the subs
    // were already checked.
    if (!isPoll) await assertAllTestSubs(req.fs, payload);

    const response = await fetch(`${req.fs.apiBase}/subscriptions/renew`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        Authorization: req.fs.auth,
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }

    console.log(
      `renew ${isPoll ? "poll" : "start"} key=${idempotencyKey} http=${response.status} status=${body?.status ?? "-"}`,
    );

    res.json({
      idempotencyKey,
      httpStatus: response.status,
      sent: payload,
      response: body,
    });
  } catch (err) {
    console.error("Renew error", err);
    res.status(502).json({ error: err.message, idempotencyKey });
  }
});

// After a checkout the SBL callback only gives us the order id, so look up
// the order and return the subscription(s) it created.
router.get("/api/renew/order/:id", async (req, res) => {
  try {
    const response = await fetch(`${req.fs.apiBase}/orders/${req.params.id}`, {
      headers: { Authorization: req.fs.auth },
    });
    const data = await response.json();
    if (!response.ok || data.result === "error") {
      return res.status(404).json({ error: "Order not found", details: data });
    }
    const subscriptions = (data.items || [])
      .filter((item) => item.subscription)
      .map((item) => ({ product: item.product, subscription: item.subscription }));
    res.json({
      order: data.id,
      reference: data.reference,
      live: data.live,
      completed: data.completed,
      total: data.totalDisplay,
      paymentType: data.payment?.type,
      subscriptions,
    });
  } catch (err) {
    console.error("Order lookup error", err);
    res.status(500).json({ error: "Failed to look up order" });
  }
});

// Quick look at a sub before renewing it: state, price, live/test.
router.get("/api/renew/subscription/:id", async (req, res) => {
  try {
    const sub = await getSubscription(req.fs, req.params.id);
    if (!sub) return res.status(404).json({ error: "Subscription not found" });
    res.json({
      id: sub.id,
      product: sub.product,
      state: sub.state,
      live: sub.live,
      adhoc: sub.adhoc,
      currency: sub.currency,
      price: sub.priceDisplay ?? sub.price,
      quantity: sub.quantity,
      next: sub.nextDisplay ?? sub.next,
      account: sub.account,
    });
  } catch (err) {
    console.error("Subscription lookup error", err);
    res.status(500).json({ error: "Failed to look up subscription" });
  }
});

// Product paths on the store, so the pages can pick the managed product
// without hardcoding it.
router.get("/api/renew/products", async (req, res) => {
  try {
    const list = await fetch(`${req.fs.apiBase}/products`, {
      headers: { Authorization: req.fs.auth },
    }).then((r) => r.json());
    const paths = list.products || [];
    const details = paths.length
      ? await fetch(`${req.fs.apiBase}/products/${paths.slice(0, 50).join(",")}`, {
          headers: { Authorization: req.fs.auth },
        }).then((r) => r.json())
      : { products: [] };
    res.json({
      products: (details.products || []).map((p) => ({
        product: p.product,
        display: p.display?.en,
        managed: p.pricing?.interval === "adhoc",
        interval: p.pricing?.interval,
        price: p.pricing?.price,
      })),
    });
  } catch (err) {
    console.error("Products lookup error", err);
    res.status(500).json({ error: "Failed to list products" });
  }
});

export default router;
