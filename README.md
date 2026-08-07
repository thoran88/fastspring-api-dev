# FastSpring Payment Components Demo

Plain Node + vanilla JS (no TypeScript, no build step). Mounts FastSpring's
Checkout SDK components (card, pay button, disclosures) against a session
created server-side, styled to match the Odyssey product used elsewhere.

This is a separate project from the static
[`fastspring-dev`](https://github.com/thoran88/fastspring-dev) repo on
purpose — Payment Components need a session created via the FastSpring
REST API first, which requires API credentials that must stay server-side.
The other integrations (Embedded/Popup/Web Checkout) are pure client-side
SBL and don't need a backend at all.

## Setup

```bash
cp .env.example .env   # fill in the FastSpring credentials/secret below
npm install
npm run dev
```

Open `http://localhost:3000`.

## Webhooks

`POST /webhooks` verifies FastSpring's `X-FS-Signature` header (HMAC-SHA256
over the raw request body, base64-encoded, using `FASTSPRING_WEBHOOK_SECRET`)
before processing anything, and rejects unsigned or mismatched requests. A
single POST can carry multiple events in `payload.events`, and FastSpring may
redeliver the same event more than once — dedupe on `event.id` if you persist
these instead of just logging them.

To receive real webhooks locally, FastSpring's servers need a public URL —
`localhost` alone isn't reachable, so tunnel it (e.g. `ngrok http 3000`) and
point the FastSpring dashboard's webhook config at the tunnel URL + `/webhooks`.
Get the signing secret from Developer Tools -> Webhooks -> your webhook ->
HMAC SHA256 Secret.
