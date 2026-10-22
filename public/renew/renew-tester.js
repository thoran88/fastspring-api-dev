// Managed subscription renewals test page (tariqh store).
// 1. Checkout: SBL popup, so the buyer sees every payment method the
//    managed sub allows (card saves the method, wire/invoice methods don't).
// 2. Renew: POST /api/renew -> FastSpring POST /subscriptions/renew, then
//    poll with the same idempotency key and the same body until it finishes.

const STORE = "tariqh";
const PREFS_KEY = "renew-demo-prefs";
const POLL_DELAYS = [2, 5, 10, 30]; // seconds, last one repeats
const MAX_POLLS = 20;

const $ = (id) => document.getElementById(id);

function storeFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      "Content-Type": "application/json",
      "X-FS-Store": STORE,
    },
  });
}

// ---------- small prefs store (storefront / product) ----------
function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}
function savePrefs(patch) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...patch }));
  } catch {
    /* storage blocked, not important */
  }
}

// ---------- 1. Checkout ----------
const prefs = loadPrefs();
$("storefront").value = prefs.storefront || "tariqh.test.onfastspring.com/popup-renew";
$("product").value = prefs.product || "archicad-solo-1m-monthly";

function setSblStatus(text, cls = "") {
  $("sbl-status").textContent = text;
  $("sbl-status").className = `rn-status ${cls}`;
}

// SBL reads its config from its own <script id="fsc-api"> tag, so changing
// storefront means a page reload with the new value saved first.
$("load-sbl").addEventListener("click", () => {
  const storefront = $("storefront").value.trim().replace(/^https?:\/\//, "");
  const product = $("product").value.trim();
  if (!storefront) return setSblStatus("Enter a storefront first", "err");
  const loadedAlready = document.getElementById("fsc-api");
  savePrefs({ storefront, product });
  if (loadedAlready && loadedAlready.dataset.storefront !== storefront) {
    window.location.reload();
    return;
  }
  if (!loadedAlready) loadSbl(storefront);
});

$("product").addEventListener("change", () =>
  savePrefs({ product: $("product").value.trim() }),
);

function loadSbl(storefront) {
  setSblStatus("Loading storefront…");
  const s = document.createElement("script");
  s.id = "fsc-api";
  s.src = "https://sbl.onfastspring.com/sbl/1.0.9/fastspring-builder.min.js";
  s.type = "text/javascript";
  s.dataset.storefront = storefront;
  s.setAttribute("data-popup-closed", "renewDemoPopupClosed");
  s.setAttribute("data-error-callback", "renewDemoSblError");
  s.onload = () => {
    setSblStatus(`Loaded ${storefront}`, "ok");
    $("buy-btn").disabled = false;
  };
  s.onerror = () => setSblStatus("Could not load SBL", "err");
  document.body.appendChild(s);
}

loadSbl($("storefront").value);

window.renewDemoSblError = (code, message) => {
  setSblStatus(`SBL error ${code}: ${message}`, "err");
};

$("buy-btn").addEventListener("click", () => {
  const product = $("product").value.trim();
  if (!product) return setSblStatus("Enter a product path", "err");
  savePrefs({ product });
  window.fastspring.builder.reset();
  window.fastspring.builder.add(product);
  window.fastspring.builder.checkout();
});

// Fires when the popup closes. orderReference is null if the buyer closed
// it without completing. For wire/invoice methods the order can still be
// pending payment, which is expected for Track B.
window.renewDemoPopupClosed = async (orderReference) => {
  const box = $("checkout-result");
  if (!orderReference) {
    box.hidden = false;
    box.textContent = "Checkout closed without an order.";
    return;
  }
  box.hidden = false;
  box.innerHTML = `Order <code>${esc(orderReference.reference || orderReference.id)}</code>, looking up the subscription…`;

  try {
    const res = await storeFetch(`/api/renew/order/${encodeURIComponent(orderReference.id)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Order lookup failed");
    const subs = data.subscriptions || [];
    box.innerHTML =
      `Order <code>${esc(data.reference)}</code> · ${esc(data.total || "")} · ` +
      `payment <code>${esc(data.paymentType || "unknown")}</code> · ` +
      `${data.completed ? "completed" : "not completed yet (pending payment)"} · ` +
      `${data.live ? "LIVE" : "test"}<br>` +
      (subs.length
        ? `Subscription <code>${subs.map((s) => esc(s.subscription)).join(", ")}</code> added to the renew list.`
        : "No subscription on this order yet. If it's pending payment, check again once it's paid.");
    subs.forEach((s) => addRow({ subscription: s.subscription }, true));
  } catch (err) {
    box.textContent = `Order lookup failed: ${err.message}`;
  }
};

// ---------- 2. Renew rows ----------
function addRow(values = {}, lookup = false) {
  const existing = [...$("rows").querySelectorAll('[data-f="subscription"]')].find(
    (i) => i.value === values.subscription && values.subscription,
  );
  if (existing) return;
  const tr = $("row-tpl").content.firstElementChild.cloneNode(true);
  for (const [k, v] of Object.entries(values)) {
    const el = tr.querySelector(`[data-f="${k}"]`);
    if (el) el.value = v;
  }
  tr.querySelector('[data-a="remove"]').addEventListener("click", () => tr.remove());
  tr.querySelector('[data-a="lookup"]').addEventListener("click", () => lookupRow(tr));
  $("rows").appendChild(tr);
  if (lookup) lookupRow(tr);
}

async function lookupRow(tr) {
  const id = tr.querySelector('[data-f="subscription"]').value.trim();
  const info = tr.querySelector('[data-f="info"]');
  if (!id) return;
  info.textContent = "Checking…";
  try {
    const res = await storeFetch(`/api/renew/subscription/${encodeURIComponent(id)}`);
    const d = await res.json();
    if (!res.ok) throw new Error(d.error);
    info.textContent =
      `${d.product} · ${d.state} · ${d.live ? "LIVE" : "test"} · ` +
      `${d.adhoc ? "managed" : "not managed"} · ${d.price ?? ""} ${d.currency ?? ""} · qty ${d.quantity ?? "-"}`;
    info.style.color = d.live || !d.adhoc ? "var(--danger)" : "";
  } catch (err) {
    info.textContent = err.message;
    info.style.color = "var(--danger)";
  }
}

$("add-row").addEventListener("click", () => addRow());
addRow();

function readRows() {
  return [...$("rows").querySelectorAll("tr")]
    .map((tr) => {
      const get = (f) => tr.querySelector(`[data-f="${f}"]`).value.trim();
      const item = { subscription: get("subscription") };
      if (!item.subscription) return null;
      if (get("price") !== "") item.pricing = { price: Number(get("price")) };
      if (get("quantity") !== "") item.quantity = Number(get("quantity"));
      if (get("netTerms") !== "") item.netTerms = Number(get("netTerms"));
      if (get("simulate")) item.simulate = get("simulate");
      if (get("reasonCode")) item.reasonCode = get("reasonCode");
      return item;
    })
    .filter(Boolean);
}

// ---------- 2. Send + poll ----------
let current = null; // { key, payload, polls, timer }

function setRenewStatus(text, cls = "") {
  $("renew-status").textContent = text;
  $("renew-status").className = `rn-status ${cls}`;
}

$("send-btn").addEventListener("click", async () => {
  stopPolling();
  const subscriptions = readRows();
  if (!subscriptions.length) return setRenewStatus("Add at least one subscription", "err");
  const payload = { subscriptions };
  const batchNet = $("batch-net").value.trim();
  if (batchNet !== "") payload.netTerms = Number(batchNet);

  $("send-btn").disabled = true;
  setRenewStatus("Sending…");
  const result = await callRenew(payload, null);
  $("send-btn").disabled = false;
  if (!result) return;

  current = { key: result.idempotencyKey, payload: result.sent, polls: 0, timer: null };
  $("key").value = current.key;
  $("poll-btn").disabled = false;
  handleResult(result);
});

$("poll-btn").addEventListener("click", () => current && poll());
$("stop-btn").addEventListener("click", stopPolling);

async function poll() {
  if (!current) return;
  clearTimeout(current.timer);
  current.polls += 1;
  setRenewStatus(`Polling (${current.polls})…`);
  const result = await callRenew(current.payload, current.key);
  if (result) handleResult(result);
}

function stopPolling() {
  if (current?.timer) clearTimeout(current.timer);
  if (current) current.timer = null;
  $("stop-btn").disabled = true;
}

async function callRenew(payload, idempotencyKey) {
  try {
    const res = await storeFetch("/api/renew", {
      method: "POST",
      body: JSON.stringify({ payload, idempotencyKey }),
    });
    const data = await res.json();
    if (!res.ok) {
      logEntry(idempotencyKey ? "poll" : "send", res.status, data);
      setRenewStatus(data.error || `Error ${res.status}`, "err");
      return null;
    }
    logEntry(idempotencyKey ? "poll" : "send", data.httpStatus, data);
    return data;
  } catch (err) {
    setRenewStatus(err.message, "err");
    return null;
  }
}

function handleResult({ httpStatus, response }) {
  const status = response?.status;
  renderResults(response);

  if (httpStatus === 409) {
    stopPolling();
    return setRenewStatus("409: same key, different body. Send again for a new key.", "err");
  }
  if (httpStatus >= 400) {
    stopPolling();
    return setRenewStatus(`HTTP ${httpStatus}: nothing was processed`, "err");
  }

  const finished = httpStatus === 200 || status === "completed" || status === "failed";
  if (finished) {
    stopPolling();
    return setRenewStatus(
      `Finished: ${status || "done"}`,
      status === "failed" ? "err" : "ok",
    );
  }

  if (current.polls >= MAX_POLLS) {
    stopPolling();
    return setRenewStatus(`Still ${status || "pending"} after ${MAX_POLLS} polls. Use Poll again.`, "err");
  }

  const delay = POLL_DELAYS[Math.min(current.polls, POLL_DELAYS.length - 1)];
  setRenewStatus(`HTTP ${httpStatus} ${status || "pending"}, polling again in ${delay}s`);
  $("stop-btn").disabled = false;
  current.timer = setTimeout(poll, delay * 1000);
}

// The docs show the per-item shape but not the wrapper key, so take the
// first array of objects that look like results.
function findItems(response) {
  if (!response || typeof response !== "object") return [];
  for (const key of ["results", "subscriptions", "items"]) {
    if (Array.isArray(response[key])) return response[key];
  }
  const arr = Object.values(response).find(
    (v) => Array.isArray(v) && v.some((x) => x && typeof x === "object" && "subscription" in x),
  );
  return arr || [];
}

function renderResults(response) {
  const items = findItems(response).filter((x) => x && typeof x === "object");
  $("results").hidden = items.length === 0;
  $("result-rows").innerHTML = items
    .map((r) => {
      const trackB = Boolean(r.renewalInvoiceId) || /invoice/i.test(r.action || "");
      const track = r.action ? (trackB ? "B" : "A") : "-";
      const ok = r.result === "success";
      const detail = r.error ? JSON.stringify(r.error) : "";
      return `<tr>
        <td><code>${esc(r.subscription)}</code></td>
        <td>${track === "-" ? "-" : `<span class="rn-tag ${track.toLowerCase()}">Track ${track}</span>`}</td>
        <td><code>${esc(r.action || "")}</code></td>
        <td>${r.result ? `<span class="rn-tag ${ok ? "ok" : "err"}">${esc(r.result)}</span>` : ""}</td>
        <td>${r.renewalInvoiceUrl ? `<a href="${esc(r.renewalInvoiceUrl)}" target="_blank" rel="noopener">${esc(r.renewalInvoiceId || "open")}</a>` : ""}</td>
        <td>${esc(r.paymentDueDate || "")}${r.reminderDate ? `<br><span class="rn-sub-info">reminder ${esc(r.reminderDate)}</span>` : ""}</td>
        <td class="rn-sub-info">${esc(detail)}</td>
      </tr>`;
    })
    .join("");
}

function logEntry(kind, httpStatus, data) {
  const div = document.createElement("div");
  div.className = "rn-log-entry";
  const time = new Date().toLocaleTimeString();
  div.innerHTML = `<div class="rn-log-head"><span>${time} · ${kind} · HTTP ${esc(String(httpStatus))}</span><span>${esc(data.idempotencyKey || "")}</span></div><pre></pre>`;
  div.querySelector("pre").textContent = JSON.stringify(
    kind === "send" ? { sent: data.sent, response: data.response ?? data } : data.response ?? data,
    null,
    2,
  );
  $("log").prepend(div);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}
