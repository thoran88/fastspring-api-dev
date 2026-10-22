// Shared by the renew pages. Every /api call goes to the tariqh store
// (X-FS-Store header, see storeMiddleware in server.js).
export const STORE = "tariqh";
export const DEFAULT_PRODUCT = "archicad-solo-1m-monthly";

export function storeFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      "Content-Type": "application/json",
      "X-FS-Store": STORE,
    },
  });
}

export async function getManagedProducts() {
  const res = await storeFetch("/api/renew/products");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to load products");
  return (data.products || []).filter((p) => p.managed);
}

const POLL_DELAYS = [2, 5, 10, 30];
const MAX_POLLS = 20;
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

async function post(payload, idempotencyKey) {
  const res = await storeFetch("/api/renew", {
    method: "POST",
    body: JSON.stringify({ payload, idempotencyKey }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Renew failed (${res.status})`);
  return data;
}

// POST /subscriptions/renew, then poll with the same key and the exact body
// FastSpring got the first time, until the batch is completed or failed.
// onUpdate gets { phase, httpStatus, status, polls, key } as it goes.
export async function renewAndPoll(payload, onUpdate = () => {}) {
  let data = await post(payload, null);
  const key = data.idempotencyKey;
  const sent = data.sent;
  let polls = 0;

  for (;;) {
    const status = data.response?.status;
    onUpdate({ phase: polls ? "poll" : "start", httpStatus: data.httpStatus, status, polls, key });

    if (data.httpStatus === 409) throw new Error("409: same key, different body");
    if (data.httpStatus >= 400) {
      throw new Error(errorText(data.response) || `HTTP ${data.httpStatus}`);
    }
    if (data.httpStatus === 200 || status === "completed" || status === "failed") {
      return { key, status, response: data.response, items: findItems(data.response) };
    }
    if (polls >= MAX_POLLS) {
      throw new Error(`Still ${status || "pending"} after ${MAX_POLLS} polls (key ${key})`);
    }
    await sleep(POLL_DELAYS[Math.min(polls, POLL_DELAYS.length - 1)]);
    polls += 1;
    data = await post(sent, key);
  }
}

function errorText(response) {
  if (!response) return "";
  if (typeof response.error === "string") return response.error;
  if (response.error) return JSON.stringify(response.error);
  return "";
}

// The docs show the per-item result shape but not the wrapper key.
export function findItems(response) {
  if (!response || typeof response !== "object") return [];
  for (const key of ["results", "subscriptions", "items"]) {
    if (Array.isArray(response[key])) return response[key];
  }
  return (
    Object.values(response).find(
      (v) => Array.isArray(v) && v.some((x) => x && typeof x === "object" && "subscription" in x),
    ) || []
  );
}

// Plain-English summary of one subscription's result.
export function describeItem(item) {
  if (!item) return { ok: false, text: "No result returned for this subscription." };
  const ok = item.result === "success";
  if (item.renewalInvoiceId || /invoice/i.test(item.action || "")) {
    return {
      ok,
      track: "B",
      text: ok
        ? `Renewal invoice raised${item.paymentDueDate ? `, due ${item.paymentDueDate}` : ""}. Buyer emailed a Pay Now link.`
        : `Renewal invoice failed: ${JSON.stringify(item.error || item)}`,
      url: item.renewalInvoiceUrl,
      invoiceId: item.renewalInvoiceId,
    };
  }
  if (item.action === "subscription.charge") {
    return {
      ok,
      track: "A",
      text: ok
        ? "Charged the saved payment method."
        : `Charge failed. New price is kept, nothing paid. ${item.error ? JSON.stringify(item.error) : ""}`,
    };
  }
  if (item.action === "subscription.update") {
    return { ok: false, track: "A", text: `Update rejected, nothing charged. ${JSON.stringify(item.error || "")}` };
  }
  return { ok, text: JSON.stringify(item) };
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}
