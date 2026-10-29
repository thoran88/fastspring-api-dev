import { storeFetch, getManagedProducts, esc } from "../renew/renew-api.js";

// IBM invoice at checkout demo. Compares:
// Option 1  - IBM cart id in the secure payload tags, IBM backend matches
//             order.payment.pending / order.completed on that tag, front end
//             polls IBM's backend. No FastSpring client events used.
// Option 1a - Adam's workaround: fsc-paymentMethod + session id from
//             data-popup-event-received, then Sessions v2 for the order id.

const STOREFRONT = "embedded-ibm-ds";
const TAG_KEY = "ibmCartId";
const POLL_MS = 2000;
const POLL_MAX_MS = 20 * 60 * 1000;
// Webhooks IBM Digital Sales consumes today.
const IBM_CONSUMES = new Set([
  "order.completed",
  "subscription.updated",
  "subscription.charge.completed",
  "subscription.charge.failed",
  "return.created",
]);
// Events worth showing in the webhook table.
const RELEVANT = new Set([
  "order.payment.pending",
  "invoice.created",
  "order.completed",
  "subscription.activated",
  "order.canceled",
  "order.failed",
  "renewal.invoice.created",
]);

const $ = (id) => document.getElementById(id);
const raw = [];
const seen = new Set();
let run = null;

function newRun() {
  return {
    cartId: `IBMCART-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    startedAt: Date.now(),
    orderIds: new Set(),
    webhooks: [],
    opt1: { status: "waiting", data: null, polls: 0 },
    opt1a: { steps: [] },
    pollTimer: null,
    method: null,
    reference: null,
    done1a: false,
  };
}

// ---------- raw log ----------
function log(title, detail, payload) {
  raw.unshift({ at: new Date().toISOString(), title, detail, payload });
  const el = $("raw-log");
  const row = document.createElement("div");
  row.className = "it-row";
  row.innerHTML = `<div class="it-row-head"><strong>${esc(title)}</strong><span>${new Date().toISOString().slice(11, 19)}</span></div><div class="it-muted">${esc(detail || "")}</div>`;
  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify(payload, null, 2);
  pre.hidden = true;
  row.append(pre);
  row.addEventListener("click", () => (pre.hidden = !pre.hidden));
  el.prepend(row);
}

// ---------- option 1 ----------
function renderOpt1() {
  const s = run?.opt1;
  const steps = [
    {
      label: `Cart id sent in secure payload tags`,
      detail: run ? run.cartId : "",
      state: run ? "done" : "",
    },
    {
      label: "Invoice created: backend has order.payment.pending",
      detail: s?.data?.status === "invoice_pending" || s?.data?.status === "paid"
        ? `order ${s.data.orderId} · ${s.data.reference}`
        : run ? `polling IBM backend (${s.polls} polls)` : "",
      state: s?.data?.status === "invoice_pending" || s?.data?.status === "paid" ? "done" : run ? "active" : "",
    },
    {
      label: "Paid: backend has order.completed",
      detail: s?.data?.status === "paid" ? `order ${s.data.orderId}` : "",
      state: s?.data?.status === "paid" ? "done" : s?.data?.status === "invoice_pending" ? "active" : "",
    },
  ];
  $("opt1-steps").innerHTML = steps
    .map((st, i) => `<li class="${st.state}"><span class="it-dot">${st.state === "done" ? "✓" : i + 1}</span><div>${esc(st.label)}<div class="it-detail">${esc(st.detail)}</div></div></li>`)
    .join("");

  const d = s?.data;
  if (d?.status === "invoice_pending") {
    $("opt1-result").innerHTML =
      `<div class="it-label">What IBM's page could show</div><div class="it-screen">` +
      `<strong>Invoice created</strong><br>Order ${esc(d.reference)} · ${esc(d.total || "")}<br>` +
      `Due ${esc(d.paymentDueDate || "n/a")}<br>` +
      (d.payUrl ? `<a href="${esc(d.payUrl)}" target="_blank" rel="noopener">Pay now link</a><br>` : "") +
      `Subscription ${esc(d.subscription || "")}</div>`;
  } else if (d?.status === "paid") {
    $("opt1-result").innerHTML =
      `<div class="it-label">What IBM's page could show</div><div class="it-screen">` +
      `<strong>Order complete</strong><br>Order ${esc(d.reference)} · ${esc(d.total || "")}<br>` +
      `Subscription ${esc(d.subscription || "")}</div>`;
  } else {
    $("opt1-result").innerHTML = "";
  }
}

async function pollCart() {
  if (!run) return;
  const r = run;
  try {
    const res = await storeFetch(`/api/ibm-test/cart/${encodeURIComponent(r.cartId)}`);
    const d = await res.json();
    if (r !== run) return;
    r.opt1.polls += 1;
    const changed = d.status !== r.opt1.data?.status;
    r.opt1.data = d;
    if (d.orderId) r.orderIds.add(d.orderId);
    if (changed && d.status !== "waiting") {
      log(`option 1 backend: ${d.status}`, `cart ${r.cartId}`, d);
      // Now we know the order id, pick up webhooks without the tag (invoice.created).
      refreshWebhooks();
    }
    renderOpt1();
    if (d.status === "paid" || Date.now() - r.startedAt > POLL_MAX_MS) {
      clearInterval(r.pollTimer);
    }
  } catch (err) {
    log("option 1 poll failed", err.message, {});
  }
}

// ---------- option 1a ----------
function step1a(label, ok, detail) {
  if (!run) return;
  run.opt1a.steps.push({ label, ok, detail });
  render1a();
}
function render1a() {
  const card = $("opt1a-card");
  card.hidden = !$("run-1a").checked;
  const steps = run?.opt1a.steps || [];
  $("opt1a-steps").innerHTML = steps.length
    ? steps
        .map((st) => `<li class="${st.ok ? "done" : "fail"}"><span class="it-dot">${st.ok ? "✓" : "!"}</span><div>${esc(st.label)}<div class="it-detail">${esc(st.detail)}</div></div></li>`)
        .join("")
    : `<li><span class="it-dot">·</span><div class="it-muted">Runs after the buyer clicks Generate Invoice.</div></li>`;
}

async function runOpt1a(fscUrl) {
  const m = /\/session\/([^/?#]+)/.exec(fscUrl || "");
  const sessionId = m ? m[1] : null;
  step1a("Session id from fsc-url", Boolean(sessionId), sessionId || "couldn't parse fsc-url");
  if (!sessionId) return;

  const sres = await storeFetch(`/api/ibm-test/session/${STOREFRONT}/${encodeURIComponent(sessionId)}`);
  const s = await sres.json();
  log("option 1a: GET sessions v2", `HTTP ${s.httpStatus} · orderId ${s.orderId}`, s);
  step1a("GET Sessions v2", Boolean(s.orderId), s.orderId ? `order id ${s.orderId} (${s.ms}ms)` : `HTTP ${s.httpStatus}`);
  if (!s.orderId) return;
  run.orderIds.add(s.orderId);

  const ores = await storeFetch(`/api/ibm-test/order/${encodeURIComponent(s.orderId)}`);
  const o = await ores.json();
  log("option 1a: GET /orders", `HTTP ${o.httpStatus} · completed ${o.summary?.completed}`, o);
  step1a("GET /orders/{id}", o.httpStatus === 200, o.summary ? `completed=${o.summary.completed} · ${o.summary.reference}` : `HTTP ${o.httpStatus}`);
}

// ---------- webhooks ----------
function belongsToRun(event) {
  if (!run) return false;
  const d = event.data || {};
  if (d.tags?.[TAG_KEY] === run.cartId) return true;
  const ids = [d.id, d.order, d.initialOrderId].filter((x) => typeof x === "string");
  return ids.some((x) => run.orderIds.has(x));
}

function handleWebhook(event) {
  if (!event?.id || seen.has(event.id)) return;
  seen.add(event.id);
  if (!run || Number(event.created) < run.startedAt - 5000) return;
  if (!belongsToRun(event)) return;
  const d = event.data || {};
  if (d.id && event.type.startsWith("order.")) run.orderIds.add(d.id);
  if (run.webhooks.some((w) => w.id === event.id)) return;
  run.webhooks.push(event);
  log(`webhook ${event.type}`, d.tags?.[TAG_KEY] ? `has ${TAG_KEY}` : `no ${TAG_KEY}`, event);
  renderWebhooks();
}

function renderWebhooks() {
  const rows = (run?.webhooks || [])
    .filter((e) => RELEVANT.has(e.type))
    .sort((a, b) => a.created - b.created);
  $("wh-rows").innerHTML = rows.length
    ? rows
        .map((e) => {
          const has = e.data?.tags?.[TAG_KEY] === run.cartId;
          const consumed = IBM_CONSUMES.has(e.type);
          return `<tr><td>${new Date(e.created).toISOString().slice(11, 19)}</td><td>${esc(e.type)}</td>` +
            `<td><span class="it-badge ${has ? "ok" : "miss"}">${has ? "yes" : "no"}</span></td>` +
            `<td><span class="it-badge ${consumed ? "ok" : "warn"}">${consumed ? "yes" : "no, needs adding"}</span></td></tr>`;
        })
        .join("")
    : `<tr><td colspan="4" class="it-muted">${run ? "Waiting for webhooks…" : "Load the checkout to start."}</td></tr>`;
}

async function refreshWebhooks() {
  try {
    const d = await (await fetch("/api/webhooks/recent")).json();
    const st = d.stats || {};
    $("wh-stats").textContent = `Server has received ${st.received} webhooks, rejected ${st.rejected}${st.lastRejectReason ? ` (${st.lastRejectReason})` : ""}.`;
    [...(d.events || [])].reverse().forEach(({ event }) => {
      seen.delete(event.id);
      handleWebhook(event);
    });
  } catch (err) {
    $("wh-stats").textContent = `Couldn't load webhooks: ${err.message}`;
  }
}

function connectWebhooks() {
  const dot = $("sse-dot");
  const src = new EventSource("/api/webhooks/stream");
  src.onopen = () => (dot.dataset.state = "connected");
  src.onerror = () => (dot.dataset.state = "error");
  src.onmessage = (msg) => {
    try {
      handleWebhook(JSON.parse(msg.data));
    } catch {
      /* ignore */
    }
  };
}

// ---------- SBL callbacks ----------
let cartReady = null;
window.ibmDataCallback = (data) => {
  const hasItems = (data?.groups || []).some((g) => (g.items || []).some((i) => i.selected !== false));
  if (cartReady && hasItems) cartReady();
};

window.ibmOrderReceived = (data) => {
  const o = Array.isArray(data) ? data[0] : data;
  log("data-popup-webhook-received", `order ${o?.id} · fires for paid orders only`, data);
  if (o?.id && run) run.orderIds.add(o.id);
};

window.ibmEventReceived = (e) => {
  if (!e) return;
  const name = e.event || (e.ecommerce?.purchase ? "purchase event (unnamed)" : "event");
  log(`data-popup-event-received: ${name}`, e["fsc-paymentMethod"] ? `fsc-paymentMethod ${e["fsc-paymentMethod"]}` : "", e);
  if (!run || !$("run-1a").checked) return;

  if (e.event === "FSC-checkoutStep5") {
    run.method = e["fsc-paymentMethod"];
    step1a("FSC-checkoutStep5 gives fsc-paymentMethod", true, `"${run.method}" (field not in FS docs)`);
  } else if (e.ecommerce?.purchase) {
    run.reference = e["fsc-order-id"];
    step1a("Purchase event gives fsc-order-id", true, `${run.reference} (this is the reference, not the order id)`);
  } else if (e.event === "FSC-purchaseComplete" && !run.done1a) {
    run.done1a = true;
    if (run.method === "purchaseorder" || run.method === "") runOpt1a(e["fsc-url"]);
    else step1a("Not an invoice", true, `method ${run.method}, IBM would use data-popup-webhook-received`);
  }
};

window.ibmSblError = (code, message) => {
  log("data-error-callback", `${code}: ${message}`, { code, message });
  $("error-banner").textContent = `Checkout error ${code}: ${message}`;
  $("error-banner").style.display = "block";
};

// ---------- checkout ----------
async function startCheckout() {
  $("error-banner").style.display = "none";
  const fs = window.fastspring?.builder;
  if (!fs) {
    $("error-banner").textContent = "Storefront hasn't loaded yet, try again in a second.";
    $("error-banner").style.display = "block";
    return;
  }
  if (run?.pollTimer) clearInterval(run.pollTimer);
  run = newRun();
  renderOpt1();
  render1a();
  renderWebhooks();

  const email = $("email").value.trim();
  const firstName = $("fname").value.trim();
  const lastName = $("lname").value.trim();
  const product = $("product").value;
  const price = $("price-override").value.trim();
  fs.reset();

  let sent;
  if ($("use-secure").checked) {
    const item = { product, quantity: 1 };
    if (price !== "") item.pricing = { price: { USD: Number(price) } };
    const payload = { items: [item], tags: { [TAG_KEY]: run.cartId } };
    if (email) payload.contact = { email, firstName, lastName };
    const ready = new Promise((resolve) => {
      const t = setTimeout(() => { cartReady = null; resolve(false); }, 5000);
      cartReady = () => { clearTimeout(t); cartReady = null; resolve(true); };
    });
    fs.secure(payload, "");
    sent = payload;
    if (!(await ready)) {
      log("secure payload not applied", "cart still empty after 5s", payload);
      $("error-banner").textContent = "Secure payload wasn't applied (cart still empty). See the raw log.";
      $("error-banner").style.display = "block";
      return;
    }
  } else {
    if (email) fs.recognize({ email, firstName, lastName });
    fs.tag({ [TAG_KEY]: run.cartId });
    fs.add(product);
    sent = { mode: "builder.tag + add", product, tags: { [TAG_KEY]: run.cartId } };
  }

  $("payload-box").hidden = false;
  $("payload-pre").textContent = JSON.stringify(sent, null, 2);
  log("checkout loaded", `cart ${run.cartId}`, sent);
  fs.checkout();

  run.pollTimer = setInterval(pollCart, POLL_MS);
  renderOpt1();
}

async function loadProducts() {
  try {
    const products = await getManagedProducts();
    $("product").innerHTML = products
      .map((p) => `<option value="${esc(p.product)}">${esc(p.display || p.product)}</option>`)
      .join("");
  } catch (err) {
    $("product").innerHTML = "";
    $("error-banner").textContent = `Couldn't load products: ${err.message}`;
    $("error-banner").style.display = "block";
  }
}

$("start-btn").addEventListener("click", startCheckout);
$("refresh-wh-btn").addEventListener("click", refreshWebhooks);
$("run-1a").addEventListener("change", render1a);
$("clear-btn").addEventListener("click", () => {
  raw.length = 0;
  $("raw-log").innerHTML = "";
});
$("copy-btn").addEventListener("click", async () => {
  await navigator.clipboard.writeText(
    JSON.stringify(
      {
        cartId: run?.cartId,
        option1: run?.opt1.data,
        option1a: run?.opt1a.steps,
        webhooks: run?.webhooks.map((e) => ({ type: e.type, created: e.created, tags: e.data?.tags })),
        log: [...raw].reverse(),
      },
      null,
      2,
    ),
  );
});

renderOpt1();
render1a();
connectWebhooks();
refreshWebhooks();
loadProducts();
