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

const app = express();

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
  const items = req.body?.items;
  const contact = req.body?.contact;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items array is required" });
  }
  if (!contact?.email) {
    return res.status(400).json({ error: "contact.email is required" });
  }

  try {
    const response = await fetch(`${FASTSPRING_API_BASE}/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ items, contact }),
    });

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

app.listen(PORT, () => {
  console.log(`Payment Components demo running at http://localhost:${PORT}`);
});
