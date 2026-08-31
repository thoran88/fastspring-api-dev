import express from "express";
import { FASTSPRING_API_BASE, authHeader, chunk } from "../lib/fastspring.js";

const router = express.Router();

// Refunds admin - lists real orders (with items/returns already embedded
// per order, no separate detail call needed) so staff can check off however
// many they want to refund, rather than having to already know order IDs.
router.get("/api/orders", async (req, res) => {
  const {
    status = "completed",
    scope,
    products,
    page = "1",
    limit = "25",
    returns,
    begin,
    end,
    days,
  } = req.query;

  const params = new URLSearchParams({ status, page, limit });
  if (scope) params.set("scope", scope);
  if (products) params.set("products", products);
  if (returns) params.set("returns", returns);
  if (begin) params.set("begin", begin);
  if (end) params.set("end", end);
  if (days) params.set("days", days);

  try {
    const response = await fetch(
      `${FASTSPRING_API_BASE}/orders?${params.toString()}`,
      { headers: { Authorization: authHeader } },
    );
    const data = await response.json();
    if (!response.ok) {
      console.error("Order list failed", data);
      return res
        .status(502)
        .json({ error: "Failed to list orders", details: data });
    }
    res.json(data);
  } catch (err) {
    console.error("Order list error", err);
    res.status(500).json({ error: "Failed to list orders" });
  }
});

// Refund history - GET /orders?returns=true already tells us which orders
// have at least one return, and each order embeds its return IDs/amounts,
// but not the reason/note/date - a second batch GET /returns/{ids} call
// fills those in. Flattened to one row per return (an order can have more
// than one, e.g. two partial refunds against the same order).
router.get("/api/refunds", async (req, res) => {
  try {
    const allOrders = [];
    let page = 1;
    let total = Infinity;
    while (allOrders.length < total) {
      const response = await fetch(
        `${FASTSPRING_API_BASE}/orders?returns=true&status=completed&page=${page}&limit=50`,
        { headers: { Authorization: authHeader } },
      );
      const data = await response.json();
      if (!response.ok) {
        console.error("Refund history order list failed", data);
        return res
          .status(502)
          .json({ error: "Failed to load refund history", details: data });
      }
      allOrders.push(...(data.orders || []));
      total = data.total ?? allOrders.length;
      page += 1;
      if (!data.orders?.length) break;
    }

    const returnIds = allOrders.flatMap((o) =>
      (o.returns || []).map((r) => r.return),
    );
    if (returnIds.length === 0) {
      return res.json({ refunds: [] });
    }

    const returnDetails = [];
    for (const batch of chunk(returnIds, 50)) {
      const detailResponse = await fetch(
        `${FASTSPRING_API_BASE}/returns/${batch.join(",")}`,
        { headers: { Authorization: authHeader } },
      );
      const detailData = await detailResponse.json();
      if (!detailResponse.ok) {
        console.error("Return detail fetch failed", detailData);
        continue;
      }
      returnDetails.push(...(detailData.returns || []));
    }
    const detailsById = new Map(returnDetails.map((r) => [r.return, r]));

    const refunds = allOrders.flatMap((order) =>
      (order.returns || []).map((r) => {
        const detail = detailsById.get(r.return);
        return {
          returnId: r.return,
          orderId: order.order,
          orderReference: order.reference,
          items: (order.items || []).map((i) => i.display).join(", "),
          amount: r.amountDisplay,
          reason: detail?.reason || null,
          note: detail?.note || null,
          date: detail?.changedDisplay || null,
        };
      }),
    );

    res.json({ refunds });
  } catch (err) {
    console.error("Refund history error", err);
    res.status(500).json({ error: "Failed to load refund history" });
  }
});

// Looks up a single order by ID/reference - used when refunding by ID
// directly rather than off the list above.
router.get("/api/orders/:id", async (req, res) => {
  try {
    const response = await fetch(
      `${FASTSPRING_API_BASE}/orders/${req.params.id}`,
      { headers: { Authorization: authHeader } },
    );
    const data = await response.json();
    const order = data.orders?.[0];
    if (!response.ok || order?.result === "error") {
      return res.status(404).json({
        error: order?.error?.order || "Order not found",
      });
    }
    res.json({ order });
  } catch (err) {
    console.error("Order fetch error", err);
    res.status(500).json({ error: "Failed to load order" });
  }
});

// Wraps POST /returns directly - it already accepts an array, so "one
// refund" and "multiple refunds" are the same call with a different array
// length, whether that's several partial refunds against one order over
// time or several different orders refunded together in a single request.
router.post("/api/refunds", async (req, res) => {
  const { returns } = req.body ?? {};
  if (!returns?.length) {
    return res.status(400).json({ error: "returns array is required" });
  }

  try {
    const response = await fetch(`${FASTSPRING_API_BASE}/returns`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ returns }),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      console.error("Refund creation failed", response.status, data);
      return res.status(502).json({
        error: "Failed to process refunds",
        details: data,
      });
    }
    res.json(data);
  } catch (err) {
    console.error("Refund creation error", err);
    res.status(500).json({ error: "Failed to process refunds" });
  }
});

export default router;
