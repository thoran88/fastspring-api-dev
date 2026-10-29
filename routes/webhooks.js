import crypto from "node:crypto";
import express from "express";
import { FASTSPRING_WEBHOOK_SECRET } from "../lib/fastspring.js";

const router = express.Router();

// Connected /api/webhooks/stream clients (SSE) - lets demo pages show
// webhook events live instead of only ever seeing them in this process's
// console output.
const webhookClients = new Set();

// Last events received and signature rejects, so a page opened after the
// event (or a delivery problem) is still visible via /api/webhooks/recent.
const recentEvents = [];
const RECENT_MAX = 200;
const deliveryStats = { received: 0, rejected: 0, lastRejectAt: null, lastRejectReason: null };

// Read by the IBM test "backend" (routes/ibm-test.js) to look up a cart id.
export function getRecentEvents() {
  return recentEvents;
}

function recordReject(reason) {
  deliveryStats.rejected += 1;
  deliveryStats.lastRejectAt = new Date().toISOString();
  deliveryStats.lastRejectReason = reason;
}

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
      recordReject("missing signature");
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
      recordReject("signature mismatch");
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

      deliveryStats.received += 1;
      recentEvents.unshift({ receivedAt: new Date().toISOString(), event });
      recentEvents.length = Math.min(recentEvents.length, RECENT_MAX);
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

router.get("/api/webhooks/recent", (req, res) => {
  res.json({ stats: deliveryStats, events: recentEvents });
});

export default router;
