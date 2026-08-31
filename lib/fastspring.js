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
