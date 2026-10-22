import express from "express";

const router = express.Router();

// Order IDs and subscription IDs are both opaque strings that show up next
// to each other in the dashboard, so pasting the wrong one is an easy
// mistake to make. If the given ID isn't a subscription, check whether it's
// actually an order and use *its* subscription instead of just failing.
async function resolveSubscriptionId(fs, id) {
  const subResponse = await fetch(
    `${fs.apiBase}/subscriptions/${id}`,
    {
      headers: { Authorization: fs.auth },
    },
  );
  const subData = await subResponse.json();
  if (subResponse.ok && subData.result === "success") {
    return { subscriptionId: id, resolvedFrom: "subscription" };
  }

  const orderResponse = await fetch(`${fs.apiBase}/orders/${id}`, {
    headers: { Authorization: fs.auth },
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
// Shared by the single-subscription charge endpoint below and the bulk
// "simulate monthly rebill" job - both just need this same two-call sequence
// against an already-resolved subscription id.
// Price has to be set in the subscription's own currency (e.g. EUR for an
// IE buyer), not a hardcoded USD.
async function getSubscriptionCurrency(fs, subscriptionId) {
  const response = await fetch(`${fs.apiBase}/subscriptions/${subscriptionId}`, {
    headers: { Authorization: fs.auth },
  });
  const data = await response.json();
  return data.currency || "USD";
}

async function chargeSubscription(fs, subscriptionId, amount, currency = "USD") {
  const priceResponse = await fetch(`${fs.apiBase}/subscriptions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: fs.auth,
    },
    body: JSON.stringify({
      subscriptions: [
        {
          subscription: subscriptionId,
          pricing: { price: { [currency]: amount } },
        },
      ],
    }),
  });
  const priceData = await priceResponse.json();
  const priceResult = priceData.subscriptions?.[0];
  if (!priceResponse.ok || priceResult?.result !== "success") {
    const err = new Error("Failed to set charge amount");
    err.details = priceData;
    throw err;
  }

  const chargeResponse = await fetch(
    `${fs.apiBase}/subscriptions/charge`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: fs.auth,
      },
      body: JSON.stringify({
        subscriptions: [{ subscription: subscriptionId }],
      }),
    },
  );
  const chargeData = await chargeResponse.json();
  const chargeResult = chargeData.subscriptions?.[0];
  if (!chargeResponse.ok || chargeResult?.result !== "success") {
    const err = new Error("Charge failed");
    err.details = chargeResult || chargeData;
    throw err;
  }

  return chargeResult;
}

router.post("/api/subscriptions/:id/charge", async (req, res) => {
  const inputId = req.params.id;
  const amount = Number(req.body?.amount);

  if (!inputId) {
    return res.status(400).json({ error: "subscription id is required" });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "amount must be a positive number" });
  }

  try {
    const resolved = await resolveSubscriptionId(req.fs, inputId);
    if (!resolved) {
      return res.status(404).json({
        error: `Could not find a subscription for "${inputId}" - checked it as both a subscription ID and an order ID`,
      });
    }

    const currency = await getSubscriptionCurrency(
      req.fs,
      resolved.subscriptionId,
    );
    await chargeSubscription(req.fs, resolved.subscriptionId, amount, currency);

    res.json({
      subscription: resolved.subscriptionId,
      amount,
      currency,
      result: "success",
      resolvedFrom: resolved.resolvedFrom,
    });
  } catch (err) {
    console.error("Subscription charge error", err, err.details);
    res.status(502).json({ error: err.message, details: err.details });
  }
});

// Random amount per active subscriber: mostly a small "usage" charge, with
// a deliberate 1-in-5 chance of a large one, so a single run exercises both
// the common case and the high-amount edge case rather than needing a
// separate manual test for each.
function randomChargeAmount() {
  const isHigh = Math.random() < 0.2;
  const [min, max] = isHigh ? [500, 9999] : [1, 25];
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

// Simulates the 1st-of-the-month usage rebill for a Managed Subscription
// product like ibm-sub - there's no real usage metering in this demo, so
// this stands in for "the seller decided what everyone owes this cycle" by
// charging every active subscriber a random amount.
//
// Both /subscriptions and /subscriptions/charge accept an array of multiple
// subscriptions in one request, so this sends exactly two requests total
// (one to set every subscriber's price for this cycle, one to charge all of
// them) instead of looping per-subscriber. The response's per-item results
// don't echo the subscription id back, so matching a result to a subscriber
// is done positionally - result at index i belongs to the subscription that
// was at index i in that same request's array.
router.post("/api/subscriptions/bulk-charge", async (req, res) => {
  const { product } = req.body ?? {};
  if (!product) {
    return res.status(400).json({ error: "product is required" });
  }

  try {
    const subsResponse = await fetch(
      `${req.fs.apiBase}/subscriptions?products=${product}&scope=test`,
      { headers: { Authorization: req.fs.auth } },
    );
    const subsData = await subsResponse.json();
    if (!subsResponse.ok) {
      console.error("Bulk charge subscription list failed", subsData);
      return res
        .status(502)
        .json({ error: "Failed to list subscriptions", details: subsData });
    }

    const activeSubs = (subsData.subscriptions || []).filter(
      (s) => s && typeof s === "object" && s.state === "active",
    );

    if (activeSubs.length === 0) {
      return res.json({ product, charged: 0, failed: 0, results: [] });
    }

    const amounts = activeSubs.map(() => randomChargeAmount());

    const priceResponse = await fetch(`${req.fs.apiBase}/subscriptions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: req.fs.auth,
      },
      body: JSON.stringify({
        subscriptions: activeSubs.map((s, i) => ({
          subscription: s.id,
          pricing: { price: { [s.currency || "USD"]: amounts[i] } },
        })),
      }),
    });
    const priceData = await priceResponse.json();
    if (!priceResponse.ok) {
      console.error("Bulk price-set request failed", priceData);
      return res
        .status(502)
        .json({ error: "Failed to set charge amounts", details: priceData });
    }
    const priceResults = priceData.subscriptions || [];

    // Only charge subscriptions whose price actually got set - charging one
    // that failed to price would rebill it at whatever amount was already
    // on it (stale from a prior cycle), not this run's intended amount.
    const pricedIndexes = activeSubs
      .map((_, i) => i)
      .filter((i) => priceResults[i]?.result === "success");

    let chargeResults = [];
    if (pricedIndexes.length > 0) {
      const chargeResponse = await fetch(
        `${req.fs.apiBase}/subscriptions/charge`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: req.fs.auth,
          },
          body: JSON.stringify({
            subscriptions: pricedIndexes.map((i) => ({
              subscription: activeSubs[i].id,
            })),
          }),
        },
      );
      const chargeData = await chargeResponse.json();
      if (!chargeResponse.ok) {
        console.error("Bulk charge request failed", chargeData);
        return res
          .status(502)
          .json({ error: "Failed to charge subscriptions", details: chargeData });
      }
      chargeResults = chargeData.subscriptions || [];
    }

    const results = activeSubs.map((s, i) => {
      const chargeIndex = pricedIndexes.indexOf(i);
      const priceOk = priceResults[i]?.result === "success";
      const chargeOk = chargeIndex !== -1 && chargeResults[chargeIndex]?.result === "success";

      return {
        subscription: s.id,
        amount: amounts[i],
        currency: s.currency || "USD",
        result: chargeOk ? "success" : "error",
        error: chargeOk
          ? undefined
          : priceOk
            ? "Charge failed"
            : "Failed to set charge amount",
      };
    });

    res.json({
      product,
      charged: results.filter((r) => r.result === "success").length,
      failed: results.filter((r) => r.result === "error").length,
      results,
    });
  } catch (err) {
    console.error("Bulk charge error", err);
    res.status(500).json({ error: "Failed to run bulk charge" });
  }
});

router.post("/api/subscriptions/:id/cancel", async (req, res) => {
  const inputId = req.params.id;

  try {
    const resolved = await resolveSubscriptionId(req.fs, inputId);
    if (!resolved) {
      return res.status(404).json({
        error: `Could not find a subscription for "${inputId}" - checked it as both a subscription ID and an order ID`,
      });
    }

    const response = await fetch(
      `${req.fs.apiBase}/subscriptions/${resolved.subscriptionId}`,
      { method: "DELETE", headers: { Authorization: req.fs.auth } },
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

export default router;
