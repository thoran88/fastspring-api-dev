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

## How it works

1. `public/index.html` mounts the `fs-card`, `fs-pay-button`, and
   `fs-disclosures` components via the Checkout SDK on page load, and shows
   a buyer-info form (email/name/country) alongside the order summary.
2. On "Continue to Payment", the page `POST`s `{ items, contact }` to
   `/api/session`.
3. `server.js` creates the session server-side (`POST <FASTSPRING_API_BASE>/sessions`,
   Basic Auth) and returns the full session object — the page uses it to
   populate the order summary (price/total) and gets the session `id`.
4. The page calls `sdk.checkout(id, ...)`, which loads the session into the
   already-mounted components and reveals them.

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

## Gotchas

- `FASTSPRING_API_BASE` differs by environment. QA environments (like QA0
  here) have their own API host (`qa0-api.fastspring.com`), separate from
  the standard `api.fastspring.com` used by production and normal sandbox
  stores.
- The SDK's `checkoutUrl` domain (`thoran.test.qa.onfastspring.com`) needs
  the running origin whitelisted in the FastSpring dashboard, same as the
  SBL storefronts in the other repo — otherwise component mounts fail
  outright (we hit this as a TLS cert mismatch when the hostname was
  slightly wrong, and separately as blocked component-mount requests when
  the origin wasn't whitelisted).
- Session creation requires either an `account` ID or a `contact` object
  with at least `email` — this store enforces that even though FastSpring's
  own docs list both as optional.
