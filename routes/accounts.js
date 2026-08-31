import express from "express";
import { FASTSPRING_API_BASE, authHeader, chunk } from "../lib/fastspring.js";

const router = express.Router();

// Every subscription for a given product plus its account contact info
// (subscriptions don't carry the customer's email/name directly, only an
// account ID, so this is a list call followed by a bulk account lookup).
// Shared by the admin member list and the self-service "find my account"
// lookup below, so the account-join logic lives in one place.
async function getMembersForProduct(product) {
  const subsResponse = await fetch(
    `${FASTSPRING_API_BASE}/subscriptions?products=${product}&scope=test`,
    { headers: { Authorization: authHeader } },
  );
  const subsData = await subsResponse.json();
  if (!subsResponse.ok) {
    const err = new Error("Failed to list subscriptions");
    err.details = subsData;
    throw err;
  }

  const subs = (subsData.subscriptions || []).filter(
    (s) => s && typeof s === "object",
  );
  if (subs.length === 0) return [];

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

  return subs.map((s) => {
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
}

router.get("/api/members", async (req, res) => {
  const product = req.query.product;
  if (!product) {
    return res.status(400).json({ error: "product query param is required" });
  }

  try {
    const members = await getMembersForProduct(product);
    res.json({ members });
  } catch (err) {
    console.error("Members fetch error", err, err.details);
    res.status(502).json({ error: err.message, details: err.details });
  }
});

// Self-service lookup for the member account page - same data as
// /api/members, but scoped to a single email so a buyer can only ever see
// their own subscription rather than the whole product's member list.
router.get("/api/my-account", async (req, res) => {
  const { email, product } = req.query;
  if (!email || !product) {
    return res
      .status(400)
      .json({ error: "email and product query params are required" });
  }

  try {
    const members = await getMembersForProduct(product);
    const matches = members.filter(
      (m) => m.email && m.email.toLowerCase() === email.toLowerCase(),
    );
    // A buyer can accumulate multiple subscriptions under one email in
    // test mode - prefer their active one over stale overdue/deactivated
    // ones rather than just returning whichever the API listed first.
    const member =
      matches.find((m) => m.state === "active") ||
      matches.find((m) => m.state === "overdue") ||
      matches[0];
    if (!member) {
      return res.status(404).json({
        error: `No ${product} subscription found for ${email}`,
      });
    }
    res.json({ member });
  } catch (err) {
    console.error("My-account lookup error", err, err.details);
    res.status(502).json({ error: err.message, details: err.details });
  }
});

// Wraps FastSpring's authenticated Account Management Portal link - needed
// both as the fastspring.epml.init() parameter and as a "view full account
// history" link, since neither is safe to construct client-side (it embeds
// a short-lived auth token FastSpring issues server-side only).
router.get("/api/accounts/:id/authenticate", async (req, res) => {
  try {
    const response = await fetch(
      `${FASTSPRING_API_BASE}/accounts/${req.params.id}/authenticate`,
      { headers: { Authorization: authHeader } },
    );
    const data = await response.json();
    const result = data.accounts?.[0];
    if (!response.ok || result?.result !== "success") {
      console.error("Account authenticate failed", data);
      return res.status(502).json({
        error: "Failed to authenticate account",
        details: result || data,
      });
    }
    res.json({ url: result.url, expires: result.expires });
  } catch (err) {
    console.error("Account authenticate error", err);
    res.status(500).json({ error: "Failed to authenticate account" });
  }
});

// Order history for the account page - GET /accounts/{id} already returns
// every order ID for that account (plus a flat "charges" list), but neither
// includes what was actually purchased. A batch GET /orders/{ids} fills in
// the product name per line item so the history reads like a real receipt
// list rather than just a pile of amounts.
router.get("/api/accounts/:id/history", async (req, res) => {
  try {
    const accountResponse = await fetch(
      `${FASTSPRING_API_BASE}/accounts/${req.params.id}`,
      { headers: { Authorization: authHeader } },
    );
    const accountData = await accountResponse.json();
    if (!accountResponse.ok || accountData.result !== "success") {
      console.error("Account fetch failed", accountData);
      return res
        .status(502)
        .json({ error: "Failed to load account", details: accountData });
    }

    const orderIds = accountData.orders || [];
    if (orderIds.length === 0) {
      return res.json({ orders: [] });
    }

    const rawOrders = [];
    for (const batch of chunk(orderIds, 50)) {
      const detailResponse = await fetch(
        `${FASTSPRING_API_BASE}/orders/${batch.join(",")}`,
        { headers: { Authorization: authHeader } },
      );
      const detailData = await detailResponse.json();
      if (!detailResponse.ok) {
        console.error("Order detail fetch failed", detailData);
        continue;
      }
      const items = Array.isArray(detailData.orders)
        ? detailData.orders
        : [detailData];
      rawOrders.push(...items.filter((o) => o && o.order));
    }

    const orders = rawOrders
      .map((o) => ({
        id: o.order,
        reference: o.reference,
        date: o.changedDisplay,
        changed: o.changed,
        total: o.totalDisplay,
        invoiceUrl: o.invoiceUrl,
        items: (o.items || []).map((item) => ({
          display: item.shortDisplay || item.display,
          subtotal: item.subtotalDisplay,
          isSubscription: item.isSubscription,
        })),
      }))
      .sort((a, b) => b.changed - a.changed);

    res.json({ orders });
  } catch (err) {
    console.error("Account history error", err);
    res.status(500).json({ error: "Failed to load order history" });
  }
});

export default router;
