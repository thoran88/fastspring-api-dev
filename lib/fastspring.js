import "dotenv/config";

export const {
  FASTSPRING_USERNAME,
  FASTSPRING_PASSWORD,
  FASTSPRING_API_BASE = "https://api.fastspring.com",
  FASTSPRING_WEBHOOK_SECRET,
} = process.env;

if (!FASTSPRING_USERNAME || !FASTSPRING_PASSWORD) {
  throw new Error(
    "Missing FASTSPRING_USERNAME or FASTSPRING_PASSWORD - see .env.example",
  );
}
if (!FASTSPRING_WEBHOOK_SECRET) {
  throw new Error("Missing FASTSPRING_WEBHOOK_SECRET - see .env.example");
}

export const authHeader =
  "Basic " +
  Buffer.from(`${FASTSPRING_USERNAME}:${FASTSPRING_PASSWORD}`).toString(
    "base64",
  );

export function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function basicAuth(username, password) {
  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
}

// Per-store API config. thoran (QA2) is the default every existing demo
// uses. tariqh is the production store behind the IBM Checkout Components
// demo, with its own credentials in .env (tariqh_username / tariqh_password,
// optional tariqh_api_base). Returns null for an unknown store or one whose
// credentials aren't set.
const STORES = {
  thoran: () => ({
    name: "thoran",
    account: "thoran",
    apiBase: FASTSPRING_API_BASE,
    auth: authHeader,
  }),
  tariqh: () => {
    const {
      tariqh_username: username,
      tariqh_password: password,
      tariqh_api_base: apiBase = "https://api.fastspring.com",
    } = process.env;
    if (!username || !password) return null;
    return {
      name: "tariqh",
      account: "tariqh",
      apiBase,
      auth: basicAuth(username, password),
    };
  },
};

export const DEFAULT_STORE = "thoran";

export function getStore(name = DEFAULT_STORE) {
  return STORES[name]?.() ?? null;
}

// Express middleware: resolves which store this request talks to from the
// X-FS-Store header (or ?store= / body.store), defaulting to thoran, and
// puts its config on req.fs for the routes to use.
export function storeMiddleware(req, res, next) {
  const name =
    req.get("X-FS-Store") || req.query.store || req.body?.store || DEFAULT_STORE;
  const store = getStore(name);
  if (!store) {
    return res.status(500).json({
      error: `Store "${name}" is unknown or its API credentials aren't set in .env`,
    });
  }
  req.fs = store;
  next();
}
