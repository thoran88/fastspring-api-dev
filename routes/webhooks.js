import crypto from "node:crypto";
import express from "express";
import { FASTSPRING_WEBHOOK_SECRET } from "../lib/fastspring.js";

const router = express.Router();

// Connected /api/webhooks/stream clients (SSE) - lets demo pages show
// webhook events live instead of only ever seeing them in this process's
// console output.
const webhookClients = new Set();

function broadcastWebhookEvent(event) {
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of webhookClients) {
    client.write(frame);
  }
}

// Raw body needed here for signature verification - must be registered
// before express.json() in server.js, and only applies to this one path.
router.post(
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

      broadcastWebhookEvent(event);
    }

    res.sendStatus(200);
  },
);

// Live feed of webhook events for the demo pages' activity dropdown - just
// broadcasts whatever /webhooks already received, no separate FastSpring
// call. Heartbeat comment keeps the connection open through idle periods.
router.get("/api/webhooks/stream", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  res.write("retry: 2000\n\n");
  webhookClients.add(res);

  const heartbeat = setInterval(() => res.write(":\n\n"), 20000);
  req.on("close", () => {
    clearInterval(heartbeat);
    webhookClients.delete(res);
  });
});

export default router;
