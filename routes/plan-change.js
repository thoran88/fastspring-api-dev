import express from "express";

const router = express.Router();

// Plan change tester (PS-1246, PimEyes). Upgrade then downgrade a sub in the
// same billing period via POST /subscriptions with prorate true or false,
// and snapshot the sub before and after every call. The bug: a downgrade can
// come back as an error ("Refund amount exceeds previous charge") while the
// product change is still saved, so the response and the sub disagree.
//
// Runs on tariqh (X-FS-Store header from the page). tariqh is a production
// store, so every write checks the sub is test mode first, same as renew.

const SETTLE_TIMEOUT_MS = 20000;
const SETTLE_POLL_MS = 1500;

const PLANS = [
  { role: "A", label: "Starting plan (mid)", product: "prorate-test-plan-a" },
  { role: "B", label: "Upgrade (top)", product: "prorate-test-plan-b" },
  { role: "C", label: "Downgrade target (cheapest)", product: "prorate-test-plan-c" },
];

async function fsCall(fs, method, path, body) {
  const response = await fetch(`${fs.apiBase}${path}`, {
    method,
    headers: {
      Authorization: fs.auth,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { httpStatus: response.status, data };
}

// Sub state plus billing entries, so the page can show what a call changed:
// product, price, next charge, and whether a proration charge or credit
// was created.
async function snapshot(fs, id) {
  const [sub, entries] = await Promise.all([
    fsCall(fs, "GET", `/subscriptions/${id}`),
    fsCall(fs, "GET", `/subscriptions/${id}/entries`),
  ]);
  const s = sub.data;
  if (sub.httpStatus !== 200 || s?.result === "error" || !s?.id) return null;

  const list = Array.isArray(entries.data) ? entries.data : [];
  return {
    at: new Date().toISOString(),
    id: s.id,
    product: s.product,
    state: s.state,
    live: s.live,
    currency: s.currency,
    price: s.priceDisplay ?? s.price,
    discount: s.discountDisplay ?? s.discount ?? null,
    next: s.nextDisplay ?? s.next,
    nextChargeTotal: s.nextChargeTotalDisplay ?? s.nextChargeTotal ?? null,
    entryCount: list.length,
    entries: list.slice(-5).map((e) => ({
      reference: e.order?.reference,
      total: e.order?.totalDisplay ?? e.order?.total,
      date: e.order?.changedDisplay ?? e.beginPeriodDate,
      period: [e.beginPeriodDate, e.endPeriodDate].filter(Boolean).join(" to "),
    })),
  };
}

function itemResult(data) {
  const item = data?.subscriptions?.[0];
  if (!item) return { ok: false, error: data?.error ? JSON.stringify(data.error) : null };
  const error = item.error
    ? typeof item.error === "string"
      ? item.error
      : Object.values(item.error).join("; ")
    : null;
  return { ok: item.result === "success" && !error, error };
}

router.get("/api/plan-change/plans", async (req, res) => {
  try {
    const { httpStatus, data } = await fsCall(
      req.fs,
      "GET",
      `/products/${PLANS.map((p) => p.product).join(",")}`,
    );
    const found = new Map(
      (data.products || [])
        .filter((p) => p && p.result !== "error" && p.pricing)
        .map((p) => [p.product, p]),
    );
    res.json({
      httpStatus,
      plans: PLANS.map((plan) => {
        const p = found.get(plan.product);
        return {
          ...plan,
          exists: Boolean(p),
          display: p?.display?.en,
          price: p?.pricing?.price,
          interval: p?.pricing?.interval,
          intervalLength: p?.pricing?.intervalLength,
          trial: p?.pricing?.trial ?? 0,
        };
      }),
    });
  } catch (err) {
    console.error("Plan lookup error", err);
    res.status(500).json({ error: "Failed to look up plans" });
  }
});

router.get("/api/plan-change/subscription/:id", async (req, res) => {
  try {
    const snap = await snapshot(req.fs, req.params.id);
    if (!snap) return res.status(404).json({ error: "Subscription not found" });
    res.json(snap);
  } catch (err) {
    console.error("Subscription snapshot error", err);
    res.status(500).json({ error: "Failed to look up subscription" });
  }
});

// The plan change itself. Body: { subscription, product, prorate }.
// prorate is always sent explicitly so the test never depends on a default.
router.post("/api/plan-change/change", async (req, res) => {
  const { subscription, product, prorate } = req.body ?? {};
  if (!subscription || !product || typeof prorate !== "boolean") {
    return res
      .status(400)
      .json({ error: "subscription, product and prorate (true/false) are required" });
  }

  try {
    const before = await snapshot(req.fs, subscription);
    if (!before) return res.status(404).json({ error: "Subscription not found" });
    if (before.live === true) {
      return res
        .status(400)
        .json({ error: "This is a live subscription. This page only changes test subscriptions." });
    }

    const sent = { subscriptions: [{ subscription, product, prorate }] };
    const { httpStatus, data } = await fsCall(req.fs, "POST", "/subscriptions", sent);
    const result = itemResult(data);

    // The change can land a few seconds after the response (seen on
    // tariqh), so poll until the sub is on the target plan or we give up.
    // settledMs tells the page how long the change took to show.
    const started = Date.now();
    let after = null;
    while (Date.now() - started < SETTLE_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, SETTLE_POLL_MS));
      after = await snapshot(req.fs, subscription);
      if (after?.product === product) break;
    }
    const settledMs = after?.product === product ? Date.now() - started : null;
    // One more read so billing entries written just after the product
    // change are counted too.
    if (settledMs != null) {
      await new Promise((r) => setTimeout(r, SETTLE_POLL_MS));
      after = (await snapshot(req.fs, subscription)) ?? after;
    }

    console.log(
      `plan-change ${subscription} ${before.product} -> ${product} prorate=${prorate} http=${httpStatus} ok=${result.ok} now=${after?.product} settled=${settledMs ?? "no"}ms`,
    );

    res.json({ sent, httpStatus, response: data, ...result, before, after, settledMs });
  } catch (err) {
    console.error("Plan change error", err);
    res.status(502).json({ error: err.message });
  }
});

// POST /subscriptions/estimate (proration preview) for the same change, so
// the page can show whether the estimate catches the refund check before
// the real change is sent. The docs list "refund exceeds the last charge
// amount" as a 400 on this endpoint. Response shown as-is.
router.post("/api/plan-change/estimate", async (req, res) => {
  const { subscription, product, prorate } = req.body ?? {};
  if (!subscription || !product || typeof prorate !== "boolean") {
    return res
      .status(400)
      .json({ error: "subscription, product and prorate (true/false) are required" });
  }
  try {
    const sent = { subscription, product, quantity: 1, prorate };
    const { httpStatus, data } = await fsCall(req.fs, "POST", "/subscriptions/estimate", sent);
    res.json({ sent, httpStatus, response: data });
  } catch (err) {
    console.error("Estimate error", err);
    res.status(502).json({ error: err.message });
  }
});

export default router;
