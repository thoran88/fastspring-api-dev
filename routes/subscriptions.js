import express from "express";
import { FASTSPRING_API_BASE, authHeader } from "../lib/fastspring.js";

const router = express.Router();

// Order IDs and subscription IDs are both opaque strings that show up next
// to each other in the dashboard, so pasting the wrong one is an easy
// mistake to make. If the given ID isn't a subscription, check whether it's
// actually an order and use *its* subscription instead of just failing.
async function resolveSubscriptionId(id) {
  const subResponse = await fetch(
    `${FASTSPRING_API_BASE}/subscriptions/${id}`,
    {
      headers: { Authorization: authHeader },
    },
  );
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

router.post("/api/subscriptions/:id/cancel", async (req, res) => {
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

export default router;
