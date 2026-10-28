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
  if (!orders.size) {
    summaryEl.innerHTML = "";
    return;
  }
  summaryEl.innerHTML = [...orders.entries()]
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
    const s = d.summary;
    add(
      d.httpStatus === 200 ? "lookup" : "lookup error",
      `GET /orders/${id}`,
      `${reason} · HTTP ${d.httpStatus} · ${d.ms}ms` +
        (s ? ` · completed=${s.completed} · payment=${s.paymentType ?? "n/a"} · subs=${s.subscriptions.map((x) => x.subscription).join(",") || "none"}` : ""),
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
  add("callback", name, id ? `order id ${id}${reference ? ` · ${reference}` : ""}` : "no order id in payload", data ?? null);
  if (id && autoLookup.checked) lookup(id, `after ${name}`);
}

// SBL callbacks. Exposed on window because SBL looks them up by name.
window.ibmOrderReceived = (data) => onCallback("data-popup-webhook-received", data);
window.ibmPopupClosed = (data) => onCallback("data-popup-closed", data);
window.ibmEventReceived = (data) => add("callback", "data-popup-event-received", data?.event || data?.fsc_event || "", data ?? null);
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
    const d = event.data || {};
    const orderId = typeof d.order === "string" ? d.order : d.order?.id || (event.type.startsWith("order.") ? d.id : null);
    if (orderId) order(orderId).webhooks.push(event);
    const consumed = IBM_CONSUMES.has(event.type);
    const planned = IBM_PLANNED.has(event.type);
    add(
      "webhook",
      event.type,
      [orderId && `order ${orderId}`, d.reference, d.subscription && `sub ${typeof d.subscription === "string" ? d.subscription : d.subscription.id}`, d.invoiceUrl || d.url]
        .filter(Boolean)
        .join(" · "),
      event,
      {
        missed: !consumed,
        badge: consumed ? ["ok", "IBM consumes"] : planned ? ["warn", "planned"] : ["miss", "IBM misses"],
      },
    );
  };
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
  if (email) {
    fs.recognize({
      email,
      firstName: document.getElementById("fname").value.trim(),
      lastName: document.getElementById("lname").value.trim(),
    });
  }
  fs.add(productSelect.value);
  fs.checkout();
  add("callback", "checkout loaded", `product ${productSelect.value}`, { email, product: productSelect.value });
});

document.getElementById("recheck-btn").addEventListener("click", () => {
  const id = document.getElementById("recheck-id").value.trim();
  if (id) lookup(id, "manual re-check");
});
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
loadProducts();
