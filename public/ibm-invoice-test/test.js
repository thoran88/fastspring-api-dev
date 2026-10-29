import { storeFetch, getManagedProducts, esc } from "../renew/renew-api.js";

// What IBM Digital Sales does today:
// 1. embedded checkout, fulfil off the browser callback (data-popup-webhook-received)
// 2. take the order id from it and call GET /orders/{id}
// 3. server side, consume only the webhooks below
// This page records all three against one timeline so we can see what IBM
// gets (and misses) for card, invoice and wire purchases.
const IBM_CONSUMES = new Set([
  "order.completed",
  "subscription.updated",
  "subscription.charge.completed",
  "subscription.charge.failed",
  "return.created",
]);
// Planned for the new renew flow, not consumed in prod yet.
const IBM_PLANNED = new Set(["renewal.invoice.created"]);

const STOREFRONT = "embedded-ibm-ds";

// IBM's workaround, modelled on Adam's code in the #fastspring-ibm thread:
// FSC-checkoutStep5 -> remember fsc-paymentMethod
// ecommerce.purchase event -> grab fsc-order-id (this is the REFERENCE)
// FSC-purchaseComplete -> if purchaseorder: session id from fsc-url,
//   GET sessions v2 -> order.orderId, then GET /orders/{orderId}, then redirect
const fscInvoice = { method: null, reference: null, sessionId: null, orderId: null, redirected: false, steps: [] };
function resetWorkaround() {
  Object.assign(fscInvoice, { method: null, reference: null, sessionId: null, orderId: null, redirected: false, steps: [] });
}
function step(name, ok, detail) {
  fscInvoice.steps.push({ name, ok, detail });
  renderSummary();
}

// Option 1: IBM brings its own ID. Before checkout we tag the session with
// an IBM-style cart id, then look for it in every callback, lookup and
// webhook. IBM would send it in the secure payload tags; here it goes
// through fastspring.builder.tag() because this harness can't encrypt.
const CART_TAG_KEY = "ibmCartId";
const cartTag = { value: null, sources: [], startedAt: 0 }; // sources: { source, type, cartPaths, refPaths }
function newCartId() {
  return `IBMCART-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}
// Every JSON path whose string value contains needle.
function findPaths(obj, needle, path = "", out = []) {
  if (!needle || obj == null) return out;
  if (typeof obj === "string") {
    if (obj.includes(needle)) out.push(path || "(root)");
  } else if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) findPaths(v, needle, path ? `${path}.${k}` : k, out);
  }
  return out;
}
function checkCartTag(source, type, payload) {
  if (!cartTag.value) return "";
  const cartPaths = findPaths(payload, cartTag.value);
  const refPaths = fscInvoice.reference ? findPaths(payload, fscInvoice.reference) : [];
  cartTag.sources.push({ source, type, cartPaths, refPaths });
  renderSummary();
  return ` · cart id ${cartPaths.length ? `at ${cartPaths.join(", ")}` : "missing"}` +
    (fscInvoice.reference ? ` · reference ${refPaths.length ? `at ${refPaths.join(", ")}` : "missing"}` : "");
}

const timelineEl = document.getElementById("timeline");
const summaryEl = document.getElementById("summary");
const errorBanner = document.getElementById("error-banner");
const productSelect = document.getElementById("product");
const autoLookup = document.getElementById("auto-lookup");
const showData = document.getElementById("show-data");

const entries = [];
const orders = new Map(); // id -> { reference, callbacks:Set, lookups:[], webhooks:[] }
let lastDataHash = "";

function order(id) {
  if (!orders.has(id)) orders.set(id, { reference: null, callbacks: new Set(), lookups: [], webhooks: [] });
  return orders.get(id);
}

function add(kind, title, meta, payload, extra = {}) {
  const entry = { at: new Date().toISOString(), kind, title, meta, payload, ...extra };
  entries.unshift(entry);
  render();
  return entry;
}

function render() {
  if (!entries.length) {
    timelineEl.innerHTML = '<div class="wh-empty">Nothing yet. Load the checkout.</div>';
  } else {
    timelineEl.innerHTML = "";
    for (const e of entries) {
      const row = document.createElement("div");
      row.className = `it-row ${e.kind}${e.missed ? " missed" : ""}`;
      const badge = e.badge ? `<span class="it-badge ${e.badge[0]}">${esc(e.badge[1])}</span>` : "";
      row.innerHTML =
        `<div class="it-row-head"><span><strong>${esc(e.title)}</strong>${badge}</span>` +
        `<span>${esc(e.at.slice(11, 19))}</span></div>` +
        `<div class="it-row-meta">${esc(e.meta || "")}</div>`;
      const pre = document.createElement("pre");
      pre.textContent = JSON.stringify(e.payload, null, 2);
      pre.hidden = true;
      row.append(pre);
      row.addEventListener("click", () => (pre.hidden = !pre.hidden));
      timelineEl.append(row);
    }
  }
  renderSummary();
}

function renderSummary() {
  const wa = fscInvoice.steps.length
    ? "<div><strong>IBM workaround</strong><br>" +
      fscInvoice.steps
        .map((st) => `<span class="it-badge ${st.ok ? "ok" : "miss"}">${st.ok ? "ok" : "fail"}</span> ${esc(st.name)}: ${esc(st.detail)}`)
        .join("<br>") +
      "</div><hr>"
    : "";
  const opt1 = cartTag.value
    ? `<div><strong>Option 1: IBM cart id</strong> <code>${esc(cartTag.value)}</code><br>` +
      (cartTag.sources.length
        ? cartTag.sources
            .map((x) => `<span class="it-badge ${x.cartPaths.length ? "ok" : "miss"}">${x.cartPaths.length ? "has cart id" : "no cart id"}</span> ` +
              `${esc(x.source)} ${esc(x.type)}${x.cartPaths.length ? ` (${esc(x.cartPaths.join(", "))})` : ""}` +
              `${x.refPaths.length ? ` · reference at ${esc(x.refPaths.join(", "))}` : ""}`)
            .join("<br>")
        : "Nothing checked yet.") +
      "</div><hr>"
    : "";
  if (!orders.size) {
    summaryEl.innerHTML = opt1 + wa;
    return;
  }
  summaryEl.innerHTML = opt1 + wa + [...orders.entries()]
    .map(([id, o]) => {
      const last = o.lookups[o.lookups.length - 1];
      const types = o.webhooks.map((w) => w.type);
      const ibmGets = types.filter((t) => IBM_CONSUMES.has(t));
      const ibmMisses = types.filter((t) => !IBM_CONSUMES.has(t));
      const fulfil =
        last?.summary?.completed === true || types.includes("order.completed")
          ? '<span class="it-badge ok">IBM would fulfil</span>'
          : '<span class="it-badge warn">IBM has no completed signal</span>';
      return (
        `<div><strong>${esc(o.reference || id)}</strong> ${fulfil}<br>` +
        `Callbacks: ${esc([...o.callbacks].join(", ") || "none")}<br>` +
        `Last GET /orders: ${last ? `${last.httpStatus}, completed=${last.summary?.completed}, payment=${last.summary?.paymentType ?? "n/a"}` : "not called"}<br>` +
        `Webhooks IBM gets: ${esc(ibmGets.join(", ") || "none")}<br>` +
        `Webhooks IBM misses: ${esc(ibmMisses.join(", ") || "none")}</div>`
      );
    })
    .join("<hr>");
}

async function lookup(id, reason) {
  try {
    const res = await storeFetch(`/api/ibm-test/order/${encodeURIComponent(id)}`);
    const d = await res.json();
    order(id).lookups.push(d);
    const tagNote = checkCartTag("lookup", "GET /orders", d.body);
    const s = d.summary;
    add(
      d.httpStatus === 200 ? "lookup" : "lookup error",
      `GET /orders/${id}`,
      `${reason} · HTTP ${d.httpStatus} · ${d.ms}ms` +
        (s ? ` · completed=${s.completed} · payment=${s.paymentType ?? "n/a"} · subs=${s.subscriptions.map((x) => x.subscription).join(",") || "none"}` : "") + tagNote,
      d,
      { badge: s?.completed ? ["ok", "completed"] : ["warn", s ? "not completed" : `HTTP ${d.httpStatus}`] },
    );
    if (s?.reference) order(id).reference = s.reference;
  } catch (err) {
    add("error", `GET /orders/${id} failed`, err.message, {});
  }
}

function orderIdFrom(data) {
  const o = Array.isArray(data) ? data[0] : data;
  return { id: o?.id || o?.order || null, reference: o?.reference || null };
}

function onCallback(name, data) {
  const { id, reference } = orderIdFrom(data);
  if (id) {
    const o = order(id);
    o.callbacks.add(name);
    if (reference) o.reference = reference;
  }
  add("callback", name, (id ? `order id ${id}${reference ? ` · ${reference}` : ""}` : "no order id in payload") + checkCartTag("callback", name, data), data ?? null);
  if (id && autoLookup.checked) lookup(id, `after ${name}`);
}

// SBL callbacks. Exposed on window because SBL looks them up by name.
window.ibmOrderReceived = (data) => onCallback("data-popup-webhook-received", data);
window.ibmPopupClosed = (data) => onCallback("data-popup-closed", data);
window.ibmEventReceived = (e) => {
  const evName = e?.event || (e?.ecommerce?.purchase ? "unnamed purchase event" : "");
  add("callback", "data-popup-event-received", evName + checkCartTag("callback", evName || "event", e), e ?? null);
  if (!e) return;

  if (e.event === "FSC-checkoutStep5") {
    fscInvoice.method = e["fsc-paymentMethod"];
    step("FSC-checkoutStep5", true, `fsc-paymentMethod = "${fscInvoice.method}"`);
    return;
  }

  if (e.ecommerce && e.ecommerce.purchase) {
    fscInvoice.reference = e["fsc-order-id"];
    step("purchase event", Boolean(fscInvoice.reference), `fsc-order-id = ${fscInvoice.reference} (reference, not order id)`);
    return;
  }

  if (e.event === "FSC-purchaseComplete") {
    if (fscInvoice.redirected) return;
    // Adam's code: purchaseorder = invoice, blank = wire
    if (fscInvoice.method !== "purchaseorder" && fscInvoice.method !== "") {
      step("FSC-purchaseComplete", true, `method "${fscInvoice.method}", not invoice or wire, IBM would use data-popup-webhook-received instead`);
      return;
    }
    fscInvoice.redirected = true;
    if (cartTag.value) {
      step("Option 1 redirect", true, `would go to /invoice-created?cart=${cartTag.value} using IBM's own id, no FS call needed`);
    }
    runWorkaround(e["fsc-url"]);
  }
};

function sessionIdFromUrl(url) {
  const m = /\/session\/([^/?#]+)/.exec(url || "");
  return m ? m[1] : null;
}

async function runWorkaround(fscUrl) {
  fscInvoice.sessionId = sessionIdFromUrl(fscUrl);
  step("session id from fsc-url", Boolean(fscInvoice.sessionId), fscInvoice.sessionId || `couldn't parse ${fscUrl}`);
  if (!fscInvoice.sessionId) return;

  const orderId = await lookupSession(fscInvoice.sessionId, "workaround");
  if (!orderId) return;
  fscInvoice.orderId = orderId;
  order(orderId).reference = fscInvoice.reference;
  order(orderId).callbacks.add("workaround (sessions v2)");

  await lookup(orderId, "workaround: GET /orders/{orderId}");
  const redirect = `/invoice-created?order=${encodeURIComponent(orderId)}`;
  step("redirect", true, `would go to ${redirect} (not navigating)`);
  add("callback", "workaround redirect", redirect, { orderId, reference: fscInvoice.reference, method: fscInvoice.method });
}

async function lookupSession(sessionId, reason) {
  try {
    const res = await storeFetch(`/api/ibm-test/session/${STOREFRONT}/${encodeURIComponent(sessionId)}`);
    const d = await res.json();
    const ok = d.httpStatus === 200 && Boolean(d.orderId);
    const tagNote = checkCartTag("lookup", "GET sessions v2", d.body);
    add(
      ok ? "lookup" : "lookup error",
      `GET sessions v2 /${sessionId}`,
      `${reason} · HTTP ${d.httpStatus ?? "?"} · ${d.ms ?? "?"}ms · orderId=${d.orderId} · reference=${d.orderReference} · status=${JSON.stringify(d.checkoutStatus)} · payment=${d.paymentMethodType}` + tagNote,
      d,
      { badge: ok ? ["ok", "order id found"] : ["miss", d.error || `HTTP ${d.httpStatus}`] },
    );
    step("GET sessions v2", ok, ok ? `orderId ${d.orderId}, reference ${d.orderReference}, matches event: ${d.orderReference === fscInvoice.reference}` : `HTTP ${d.httpStatus}, ${d.error || "no order on session"}`);
    return ok ? d.orderId : null;
  } catch (err) {
    step("GET sessions v2", false, err.message);
    return null;
  }
}
window.ibmDataCallback = (data) => {
  if (!showData.checked) return;
  const hash = JSON.stringify([data?.groups?.length, data?.total, data?.currency, data?.country]);
  if (hash === lastDataHash) return;
  lastDataHash = hash;
  add("callback", "data-data-callback", `total ${data?.total ?? ""} ${data?.currency ?? ""}`, data);
};
window.ibmSblError = (code, message) => {
  add("error", "data-error-callback", `${code}: ${message}`, { code, message });
  errorBanner.textContent = `Checkout error ${code}: ${message}`;
  errorBanner.style.display = "block";
};

// Server webhooks (whole account feed, so tie them back to orders we've seen).
const seenEventIds = new Set();

async function backfillWebhooks() {
  try {
    const res = await fetch("/api/webhooks/recent");
    const d = await res.json();
    const s = d.stats || {};
    add(
      s.rejected ? "error" : "webhook",
      "webhook delivery stats",
      `received ${s.received} · rejected ${s.rejected}${s.lastRejectAt ? ` · last reject ${s.lastRejectAt} (${s.lastRejectReason})` : ""}`,
      s,
      { badge: s.rejected ? ["miss", "check HMAC secret"] : ["ok", "no rejects"] },
    );
    [...(d.events || [])].reverse().forEach(({ event }) => handleWebhook(event, true));
  } catch (err) {
    add("error", "webhook backfill failed", err.message, {});
  }
}

function connectWebhooks() {
  const dot = document.getElementById("sse-dot");
  const src = new EventSource("/api/webhooks/stream");
  src.onopen = () => (dot.dataset.state = "connected");
  src.onerror = () => (dot.dataset.state = "error");
  src.onmessage = (msg) => {
    let event;
    try {
      event = JSON.parse(msg.data);
    } catch {
      return;
    }
    handleWebhook(event, false);
  };
}

function handleWebhook(event, backfilled) {
    if (event.id && seenEventIds.has(event.id)) return;
    if (event.id) seenEventIds.add(event.id);
    const d = event.data || {};
    const orderId = typeof d.order === "string" ? d.order : d.order?.id || (event.type.startsWith("order.") ? d.id : null);
    if (orderId) order(orderId).webhooks.push(event);
    const consumed = IBM_CONSUMES.has(event.type);
    const planned = IBM_PLANNED.has(event.type);
    // Check every webhook created since this checkout loaded, so a webhook
    // for this order that lacks the cart id still shows as "no cart id".
    const created = Number(event.created) || (backfilled ? 0 : Date.now());
    const tagNote = cartTag.value && created >= cartTag.startedAt ? checkCartTag("webhook", event.type, event) : "";
    add(
      "webhook",
      event.type,
      [orderId && `order ${orderId}`, d.reference, d.subscription && `sub ${typeof d.subscription === "string" ? d.subscription : d.subscription.id}`, d.invoiceUrl || d.url]
        .filter(Boolean)
        .join(" · ") + tagNote,
      event,
      {
        missed: !consumed,
        badge: consumed ? ["ok", "IBM consumes"] : planned ? ["warn", "planned"] : ["miss", "IBM misses"],
        backfilled,
      },
    );
}

async function loadProducts() {
  try {
    const products = await getManagedProducts();
    productSelect.innerHTML = products
      .map((p) => `<option value="${esc(p.product)}">${esc(p.display || p.product)}${p.price?.USD ? ` ($${p.price.USD})` : ""}</option>`)
      .join("");
  } catch (err) {
    productSelect.innerHTML = "";
    errorBanner.textContent = `Couldn't load products: ${err.message}`;
    errorBanner.style.display = "block";
  }
}

document.getElementById("start-btn").addEventListener("click", () => {
  errorBanner.style.display = "none";
  const fs = window.fastspring?.builder;
  if (!fs) {
    errorBanner.textContent = "Storefront hasn't loaded yet, try again in a second.";
    errorBanner.style.display = "block";
    return;
  }
  const email = document.getElementById("email").value.trim();
  fs.reset();
  resetWorkaround();
  if (email) {
    fs.recognize({
      email,
      firstName: document.getElementById("fname").value.trim(),
      lastName: document.getElementById("lname").value.trim(),
    });
  }
  cartTag.value = null;
  cartTag.sources = [];
  cartTag.startedAt = Date.now();
  if (document.getElementById("use-cart-tag").checked) {
    cartTag.value = newCartId();
    fs.tag({ [CART_TAG_KEY]: cartTag.value });
  }
  fs.add(productSelect.value);
  fs.checkout();
  add("callback", "checkout loaded", `product ${productSelect.value}${cartTag.value ? ` · tagged ${CART_TAG_KEY}=${cartTag.value}` : ""}`, {
    email,
    product: productSelect.value,
    tags: cartTag.value ? { [CART_TAG_KEY]: cartTag.value } : null,
  });
});

document.getElementById("recheck-btn").addEventListener("click", () => {
  const id = document.getElementById("recheck-id").value.trim();
  if (id) lookup(id, "manual re-check");
});
document.getElementById("session-btn").addEventListener("click", () => {
  const id = document.getElementById("session-id").value.trim();
  if (id) lookupSession(id, "manual");
});
document.getElementById("refresh-wh-btn").addEventListener("click", backfillWebhooks);
document.getElementById("clear-btn").addEventListener("click", () => {
  entries.length = 0;
  orders.clear();
  render();
});
document.getElementById("copy-btn").addEventListener("click", async () => {
  const dump = { entries: [...entries].reverse(), orders: Object.fromEntries([...orders].map(([k, v]) => [k, { ...v, callbacks: [...v.callbacks] }])) };
  await navigator.clipboard.writeText(JSON.stringify(dump, null, 2));
});

connectWebhooks();
backfillWebhooks();
loadProducts();
