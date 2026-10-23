import {
  storeFetch,
  getManagedProducts,
  renewAndPoll,
  describeItem,
  DEFAULT_PRODUCT,
  esc,
} from "../renew/renew-api.js";

// Renewal walkthrough: one subscription followed through sign up, renewal,
// outcome and the next renewal, with the seller's side and the buyer's side
// next to each other. Runs for real on the tariqh test storefront.

const $ = (id) => document.getElementById(id);
const STAGES = [
  { n: 1, label: "Sign up" },
  { n: 2, label: "Live" },
  { n: 3, label: "Renew" },
  { n: 4, label: "Outcome" },
  { n: 5, label: "Next renewal" },
];

const state = {
  stage: 1,
  product: DEFAULT_PRODUCT,
  email: "",
  sub: null, // subscription details
  member: null, // account info for the buyer
  order: null,
  lastResult: null,
};

// ---------- stage navigation ----------
function renderSteps() {
  $("steps").innerHTML = STAGES.map(
    (s) =>
      `<span class="wt-step ${s.n < state.stage ? "done" : ""} ${s.n === state.stage ? "current" : ""}">
        <b>${s.n}</b> ${s.label}
      </span>`,
  ).join("");
  document.querySelectorAll(".wt-stage").forEach((el) => {
    const n = Number(el.dataset.stage);
    el.hidden = n > state.stage;
    el.classList.toggle("done", n < state.stage);
  });
}

function goTo(n) {
  state.stage = Math.max(state.stage, n);
  renderSteps();
  document.querySelector(`.wt-stage[data-stage="${n}"]`)?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

function freshEmail() {
  const t = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return `thoran+walk${t}@fastspring.com`;
}

function money(sub) {
  return sub?.price != null ? `${sub.price}` : "";
}

// ---------- stage 1: sign up ----------
async function loadProducts() {
  try {
    const products = await getManagedProducts();
    $("product").innerHTML = products
      .map((p) => {
        const usd = p.price?.USD;
        return `<option value="${esc(p.product)}">${esc(p.display || p.product)}${usd ? ` ($${usd})` : ""}</option>`;
      })
      .join("");
    if (products.some((p) => p.product === DEFAULT_PRODUCT)) $("product").value = DEFAULT_PRODUCT;
  } catch {
    $("product").innerHTML = `<option value="${DEFAULT_PRODUCT}">${DEFAULT_PRODUCT}</option>`;
  }
}

$("start-checkout").addEventListener("click", () => {
  if (!window.fastspring?.builder) return alert("Checkout is still loading, try again in a second.");
  state.product = $("product").value;
  state.email = $("email").value.trim() || freshEmail();
  $("email").value = state.email;

  const fs = window.fastspring.builder;
  fs.reset();
  fs.recognize({ email: state.email, firstName: "Test", lastName: "Customer" });
  fs.add(state.product);
  fs.checkout();

  $("start-checkout").hidden = true;
  $("find-wrap").hidden = false;
});

// Fires when the order completes in the embedded checkout.
window.wtOrderReceived = async (data) => {
  const order = Array.isArray(data) ? data[0] : data;
  const orderId = order?.id || order?.order;
  if (!orderId) return;
  try {
    const res = await storeFetch(`/api/renew/order/${encodeURIComponent(orderId)}`);
    const d = await res.json();
    if (!res.ok) throw new Error(d.error);
    state.order = d;
    const subId = d.subscriptions?.[0]?.subscription;
    $("signup-event").hidden = false;
    $("signup-event").innerHTML =
      `<b>Order ${esc(d.reference)}</b> · ${esc(d.total || "")} · paid with ${esc(paymentLabel(d.paymentType))}`;
    if (subId) await loadSubscription(subId);
  } catch (err) {
    $("signup-event").hidden = false;
    $("signup-event").textContent = `Couldn't read the order: ${err.message}`;
  }
};

window.wtSblError = (code, message) => {
  $("signup-event").hidden = false;
  $("signup-event").textContent = `Checkout error ${code}: ${message}`;
};

// Fallback for invoice/wire orders, where the checkout may not hand back the
// order: look the customer up by email.
$("find-sub").addEventListener("click", async () => {
  const btn = $("find-sub");
  btn.disabled = true;
  btn.textContent = "Looking…";
  try {
    const res = await storeFetch(
      `/api/my-account?product=${encodeURIComponent(state.product)}&email=${encodeURIComponent(state.email)}`,
    );
    const d = await res.json();
    if (!res.ok) throw new Error(d.error);
    await loadSubscription(d.member.id);
  } catch (err) {
    btn.textContent = `Not found yet: ${err.message}. Try again`;
    btn.disabled = false;
    return;
  }
  btn.textContent = "Found";
});

function paymentLabel(type) {
  if (!type) return "unknown";
  const t = String(type).toLowerCase();
  if (t.includes("card") || t === "test" || t === "cc") return "card";
  if (t.includes("wire")) return "wire transfer";
  if (t.includes("invoice") || t.includes("purchase")) return "invoice";
  return type;
}

// ---------- stage 2: live ----------
async function fetchSub(id) {
  const res = await storeFetch(`/api/renew/subscription/${encodeURIComponent(id)}`);
  const d = await res.json();
  if (!res.ok) throw new Error(d.error);
  return d;
}

// Reading the sub straight after a Track A renew can still return the old
// price for a few seconds, so re-check until it changes (or give up).
async function fetchSubAfterChange(id, beforePrice, priceSent) {
  let sub = await fetchSub(id);
  if (!priceSent) return { sub, settled: true };
  for (let i = 0; i < 6 && sub.price === beforePrice; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    sub = await fetchSub(id);
  }
  return { sub, settled: sub.price !== beforePrice };
}

async function loadSubscription(id) {
  state.sub = await fetchSub(id);
  try {
    const res = await storeFetch(
      `/api/my-account?product=${encodeURIComponent(state.sub.product)}&email=${encodeURIComponent(state.email)}`,
    );
    const d = await res.json();
    if (res.ok) state.member = d.member;
  } catch {
    /* account link is optional */
  }

  $("sub-details").innerHTML = kv([
    ["Subscription ID", `<code>${esc(state.sub.id)}</code>`],
    ["Plan", esc(state.sub.product)],
    ["Status", esc(state.sub.state)],
    ["Current price", esc(money(state.sub))],
    ["Billing", "Managed by you (no fixed schedule)"],
  ]);
  $("buyer-signup").innerHTML = kv([
    ...(state.email ? [["Email", esc(state.email)]] : []),
    ...(state.order ? [["Paid with", esc(paymentLabel(state.order.paymentType))]] : []),
    ["Has access", state.order ? "Yes, from today" : "Yes"],
  ]);
  goTo(2);
  goTo(3);
}

$("open-portal").addEventListener("click", async () => {
  const accountId = state.member?.accountId || state.sub?.account;
  if (!accountId) return;
  const res = await storeFetch(`/api/accounts/${encodeURIComponent(accountId)}/authenticate`);
  const d = await res.json();
  const url = d.url || d.accounts?.[0]?.url;
  if (url) window.open(url, "_blank", "noopener");
  else alert(d.error || "Couldn't get the account page link.");
});

// ---------- stage 3: renew ----------
function buildPayload() {
  const item = { subscription: state.sub.id };
  const price = $("renew-price").value.trim();
  if (price !== "") item.pricing = { price: Number(price) };
  state.priceSent = price !== "";
  const payload = {};
  if ($("renew-net").value.trim() !== "") payload.netTerms = Number($("renew-net").value);
  payload.subscriptions = [item];
  return payload;
}

async function runRenew(timelineEl, buttonEl) {
  const payload = buildPayload();
  if (timelineEl === $("renew-timeline")) {
    $("renew-request").textContent =
      `POST /subscriptions/renew\nIdempotency-Key: <new key for each renewal>\n\n${JSON.stringify(payload, null, 2)}`;
  }
  timelineEl.innerHTML = "";
  buttonEl.disabled = true;
  const add = (text, cls = "") => {
    const li = document.createElement("li");
    li.className = cls;
    li.innerHTML = text;
    timelineEl.appendChild(li);
  };

  try {
    let last = "";
    const result = await renewAndPoll(payload, ({ phase, httpStatus, status, polls }) => {
      const line =
        phase === "start"
          ? `<b>${httpStatus} Accepted.</b> FastSpring has the renewal and is working on it.`
          : `Checked again (${polls}): ${esc(status || "pending")}`;
      if (line !== last) add(line);
      last = line;
    });
    const item = result.items.find((i) => i.subscription === state.sub.id) || result.items[0];
    const d = describeItem(item);
    add(
      d.track === "B"
        ? `<b>Done.</b> No saved payment method, so a renewal invoice was sent.`
        : d.ok
          ? `<b>Done.</b> Saved payment method charged.`
          : `<b>Done, with a problem.</b> ${esc(d.text)}`,
      d.ok ? "ok" : "err",
    );
    state.lastResult = { item, d };
    return { item, d };
  } catch (err) {
    add(esc(err.message), "err");
    return null;
  } finally {
    buttonEl.disabled = false;
  }
}

$("renew-btn").addEventListener("click", async () => {
  $("renew-buyer").innerHTML = '<p class="wt-hint">Waiting for FastSpring…</p>';
  const r = await runRenew($("renew-timeline"), $("renew-btn"));
  if (!r) {
    $("renew-buyer").innerHTML = '<p class="wt-hint">Nothing reached the customer.</p>';
    return;
  }
  $("renew-buyer").innerHTML =
    r.d.track === "B"
      ? `<div class="wt-email"><div class="wt-email-head">Email: Your renewal invoice</div>
          <p>Your subscription is due for renewal. Pay by the due date to keep it active.</p>
          ${r.item.renewalInvoiceUrl ? `<a class="buy-btn wt-btn" href="${esc(r.item.renewalInvoiceUrl)}" target="_blank" rel="noopener">Pay Now</a>` : ""}
        </div>`
      : r.d.ok
        ? `<div class="wt-email"><div class="wt-email-head">Email: Your receipt</div>
            <p>Your card was charged for this period. Nothing for you to do.</p></div>`
        : '<p class="wt-hint">The charge didn\'t go through, so the customer wasn\'t billed.</p>';
  await showOutcome(r);
});

// ---------- stage 4: outcome ----------
async function showOutcome({ item, d }) {
  const before = state.sub;
  let after = before;
  let settled = true;
  try {
    if (d.track !== "B" && d.ok) {
      $("outcome-seller").innerHTML = '<p class="wt-hint">Reading the updated subscription…</p>';
      goTo(4);
      ({ sub: after, settled } = await fetchSubAfterChange(state.sub.id, before.price, state.priceSent));
    } else {
      after = await fetchSub(state.sub.id);
    }
  } catch {
    /* keep before */
  }

  if (d.track === "B") {
    $("outcome-title").textContent = "A renewal invoice was sent";
    $("outcome-sub").textContent =
      "Your customer has no saved payment method, so nothing was charged. They pay the invoice in their own time.";
    $("outcome-seller").innerHTML =
      kv([
        ["Result", "Renewal invoice created"],
        ["Invoice", `<code>${esc(item.renewalInvoiceId || "")}</code>`],
        ["Due", esc(item.paymentDueDate || "")],
        ["Reminder", esc(item.reminderDate || "none set")],
        ["Subscription price now", `${esc(money(after))} (changes when the invoice is paid)`],
      ]) +
      `<p class="wt-hint">You also get a <code>renewal.invoice.created</code> webhook. When the customer pays, the order and subscription webhooks tell you, and the subscription updates then.</p>`;
    $("outcome-buyer").innerHTML =
      `<p>They got an email with a Pay Now link. They can pay by card, wire or any method offered for their country.</p>` +
      (item.renewalInvoiceUrl
        ? `<a class="admin-refresh-btn" href="${esc(item.renewalInvoiceUrl)}" target="_blank" rel="noopener">Open the invoice as the customer</a>`
        : "");
    $("next-explain").innerHTML =
      "If you renew again while the invoice is still unpaid, FastSpring updates the same invoice instead of sending a second one. Change the amount above first to see it.";
  } else if (d.ok) {
    $("outcome-title").textContent = "The saved payment method was charged";
    $("outcome-sub").textContent = "Charging and updating the subscription happened in the same call.";
    $("outcome-seller").innerHTML =
      kv([
        ["Result", "Charged"],
        ["Price before", esc(money(before))],
        ["Price now", `<span id="price-now">${esc(money(after))}</span>`],
      ]) +
      (settled
        ? ""
        : `<p class="wt-hint">Still showing the old price. It can take a few seconds to update. <button class="admin-refresh-btn" id="refresh-price">Refresh</button></p>`) +
      `<p class="wt-hint">You also get a <code>subscription.charge.completed</code> webhook.</p>`;
    $("outcome-buyer").innerHTML = "<p>Charged automatically and sent a receipt. Nothing for them to do.</p>";
    $("next-explain").innerHTML = "The card stays on file, so every renewal charges it the same way.";
  } else {
    $("outcome-title").textContent = "The renewal didn't go through";
    $("outcome-sub").textContent = d.text;
    $("outcome-seller").innerHTML =
      "<p>If the price was changed, it's kept. Nothing was paid. Renew again when you're ready, with a new idempotency key.</p>";
    $("outcome-buyer").innerHTML = "<p>Nothing was charged.</p>";
    $("next-explain").textContent = "Try renewing again.";
  }
  state.sub = after;
  $("refresh-price")?.addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    try {
      state.sub = await fetchSub(state.sub.id);
      $("price-now").textContent = money(state.sub);
    } finally {
      e.currentTarget.disabled = false;
    }
  });
  goTo(4);
  goTo(5);
}

// ---------- stage 5: next renewal ----------
$("renew-again").addEventListener("click", async () => {
  $("next-buyer").innerHTML = '<p class="wt-hint">Waiting for FastSpring…</p>';
  const prevInvoice = state.lastResult?.item?.renewalInvoiceId;
  const r = await runRenew($("next-timeline"), $("renew-again"));
  if (!r) {
    $("next-buyer").innerHTML = '<p class="wt-hint">Nothing reached the customer.</p>';
    return;
  }
  const sameInvoice = prevInvoice && r.item.renewalInvoiceId === prevInvoice;
  $("next-buyer").innerHTML =
    r.d.track === "B"
      ? sameInvoice
        ? `<p>Same invoice, updated. No new email.</p>
           <a class="admin-refresh-btn" href="${esc(r.item.renewalInvoiceUrl || "#")}" target="_blank" rel="noopener">See the updated invoice</a>`
        : `<div class="wt-email"><div class="wt-email-head">Email: Your renewal invoice</div>
            <p>A new renewal invoice for this period.</p>
            ${r.item.renewalInvoiceUrl ? `<a class="buy-btn wt-btn" href="${esc(r.item.renewalInvoiceUrl)}" target="_blank" rel="noopener">Pay Now</a>` : ""}
          </div>`
      : r.d.ok
        ? `<div class="wt-email"><div class="wt-email-head">Email: Your receipt</div><p>Charged automatically.</p></div>`
        : '<p class="wt-hint">Nothing was charged.</p>';
  try {
    if (r.d.track !== "B" && r.d.ok) {
      const before = state.sub.price;
      const { sub } = await fetchSubAfterChange(state.sub.id, before, state.priceSent);
      state.sub = sub;
      $("next-timeline").insertAdjacentHTML(
        "beforeend",
        `<li>Subscription price now ${esc(money(sub))}</li>`,
      );
    } else {
      state.sub = await fetchSub(state.sub.id);
    }
  } catch {
    /* ignore */
  }
});

// ---------- helpers ----------
function kv(rows) {
  return `<dl class="wt-dl">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
}

$("restart").addEventListener("click", () => window.location.reload());

// Start from an existing test subscription, e.g. ?sub=ID&email=a@b.com,
// to skip sign up in a demo.
async function startFromExisting() {
  const params = new URLSearchParams(window.location.search);
  const subId = params.get("sub");
  if (!subId) return;
  try {
    const sub = await fetchSub(subId);
    if (sub.live) throw new Error("That is a live subscription. Use a test one.");
    state.product = sub.product;
    state.email = params.get("email") || "";
    $("email").value = state.email;
    $("signup-event").hidden = false;
    $("signup-event").textContent = "Starting from an existing subscription.";
    $("start-checkout").hidden = true;
    await loadSubscription(subId);
  } catch (err) {
    $("signup-event").hidden = false;
    $("signup-event").textContent = `Couldn't load ${subId}: ${err.message}`;
  }
}

$("email").value = freshEmail();
loadProducts();
renderSteps();
startFromExisting();
