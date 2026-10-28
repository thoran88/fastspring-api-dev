import express from "express";

const router = express.Router();

// IBM invoice at checkout test. IBM's front end takes the order id from the
// SBL callback and calls GET /orders/{id} before it fulfils. This returns
// exactly what that call gives back (status and body), so we can see what
// IBM would see for a card order, an invoice order and a wire order.
router.get("/api/ibm-test/order/:id", async (req, res) => {
  const started = Date.now();
  try {
    const response = await fetch(
      `${req.fs.apiBase}/orders/${encodeURIComponent(req.params.id)}`,
      { headers: { Authorization: req.fs.auth } },
    );
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }

    const summary =
      response.ok && body.result !== "error"
        ? {
            id: body.id,
            reference: body.reference,
            live: body.live,
            completed: body.completed,
            total: body.totalDisplay,
            currency: body.currency,
            paymentType: body.payment?.type ?? null,
            account: body.account,
            subscriptions: (body.items || [])
              .filter((i) => i.subscription)
              .map((i) => ({ product: i.product, subscription: i.subscription })),
          }
        : null;

    res.json({
      httpStatus: response.status,
      ms: Date.now() - started,
      summary,
      body,
    });
  } catch (err) {
    console.error("IBM test order lookup error", err);
    res.status(502).json({ error: err.message });
  }
});

export default router;
