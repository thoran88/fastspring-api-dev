// Plan change tester (PS-1246). Every /api call goes to the tariqh store via
// the X-FS-Store header, see storeMiddleware in server.js.
//
// Flow: buy a sub on Plan A, upgrade to B with prorate:true, then downgrade
// with one of the scenarios. Each change returns the sub as it was before
// and after the call, and the page flags when the response says error but
// the plan changed anyway (the bug), or the response says success.

const STORE = "tariqh";
const WEBHOOK_WAIT_MS = 20000;

const storeFetch = (url, options = {}) =>
  fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), "Content-Type": "application/json", "X-FS-Store": STORE },
  });

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const $ = (id) => document.getElementById(id);
const subInput = $("sub-id");
const resultsEl = $("results");
let plans = [];
const runs = [];

const planByRole = (role) => plans.find((p) => p.role === role);
const roleOf = (product) => plans.find((p) => p.product === product)?.role;
const planLabel = (product) => (roleOf(product) ? `Plan ${roleOf(product)} (${product})` : product || "unknown");

// ---------- Plans ----------

async function loadPlans() {
  const el = $("plans");
  el.innerHTML = '<div class="grid-loading"><div class="spinner"></div></div>';
  try {
    const res = await storeFetch("/api/plan-change/plans");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load plans");
    plans = data.plans;
    el.innerHTML = plans
      .map((p) => {
        const usd = p.price?.USD;
        const okInterval = p.interval === "month" && Number(p.intervalLength) === 1;
        const warn = !p.exists
          ? "Not found on tariqh, create it first"
          : !okInterval
            ? `Interval is ${p.interval}/${p.intervalLength}, expected month/1`
            : Number(p.trial) > 0
              ? `Has a ${p.trial} day trial, remove it`
              : "";
        return `
          <div class="pc-plan ${warn ? "pc-plan-warn" : ""}">
            <div class="pc-plan-role">${esc(p.role)}</div>
            <div>
              <div class="member-name">${esc(p.label)}</div>
              <div class="member-meta"><code>${esc(p.product)}</code>${usd != null ? ` · $${esc(usd)}/month` : ""}</div>
              ${warn ? `<div class="charge-result error">${esc(warn)}</div>` : ""}
            </div>
          </div>`;
      })
      .join("");
    $("custom-target").innerHTML = plans
      .map((p) => `<option value="${esc(p.product)}">Plan ${esc(p.role)} · ${esc(p.product)}</option>`)
      .join("");
  } catch (err) {
    el.innerHTML = `<p class="charge-result error">${esc(err.message)}</p>`;
  }
}

// ---------- Checkout ----------

const seenOrders = new Set();

function buyPlanA() {
  $("checkout-error").style.display = "none";
  const fs = window.fastspring?.builder;
  if (!fs) {
    $("checkout-error").textContent = "Storefront hasn't loaded yet, try again in a second.";
    $("checkout-error").style.display = "block";
    return;
  }
  fs.reset();
  fs.add(planByRole("A")?.product || "prorate-test-plan-a");
  fs.checkout();
}

async function showOrder(orderId, ref) {
  if (!orderId || seenOrders.has(orderId)) return;
  seenOrders.add(orderId);
  const box = $("checkout-success");
  box.style.display = "block";
  box.innerHTML = `Order <code>${esc(ref || orderId)}</code>, looking up the subscription…`;
  try {
    // Reuses the renew demo's order lookup, it just returns the order's subs.
    const res = await storeFetch(`/api/renew/order/${encodeURIComponent(orderId)}`);
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || "Order lookup failed");
    const sub = d.subscriptions?.[0]?.subscription;
    box.innerHTML = sub
      ? `Order <code>${esc(d.reference)}</code> created subscription <code>${esc(sub)}</code>. Loaded below.`
      : `Order <code>${esc(d.reference)}</code> has no subscription yet, refresh in a moment.`;
    if (sub) {
      subInput.value = sub;
      loadSub();
    }
  } catch (err) {
    box.textContent = `Order ${ref || orderId}: ${err.message}`;
  }
}

window.planPopupClosed = (ref) => ref?.id && showOrder(ref.id, ref.reference);
window.planOrderReceived = (data) => {
  const order = Array.isArray(data) ? data[0] : data;
  const id = order?.id || order?.order;
  if (id) showOrder(id, order?.reference);
};
window.planSblError = (code, message) => {
  $("checkout-error").textContent = `Checkout error ${code}: ${message}`;
  $("checkout-error").style.display = "block";
};

// ---------- Subscription snapshot ----------

function snapshotHtml(s) {
  if (!s) return '<p class="empty-state">Not found.</p>';
  const entries = (s.entries || [])
    .map((e) => `<li><code>${esc(e.reference || "-")}</code> · ${esc(e.total ?? "")} · ${esc(e.date || "")}</li>`)
    .join("");
  return `
    <div class="pc-kv">
      <span>Plan</span><strong>${esc(planLabel(s.product))}</strong>
      <span>State</span><span class="member-badge ${s.state === "active" ? "success" : "error"}">${esc(s.state)}</span>
      <span>Mode</span><span>${s.live ? "LIVE" : "test"}</span>
      <span>Price</span><span>${esc(s.price)}${s.discount ? ` · discount ${esc(s.discount)}` : ""}</span>
      <span>Next charge</span><span>${esc(s.next)}${s.nextChargeTotal ? ` · ${esc(s.nextChargeTotal)}` : ""}</span>
      <span>Billing entries</span><span>${esc(s.entryCount)}</span>
    </div>
    ${entries ? `<ul class="pc-entries">${entries}</ul>` : ""}`;
}

async function loadSub() {
  const id = subInput.value.trim();
  const el = $("sub-snapshot");
  if (!id) return;
  el.innerHTML = '<div class="grid-loading"><div class="spinner"></div></div>';
  try {
    const res = await storeFetch(`/api/plan-change/subscription/${encodeURIComponent(id)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Lookup failed");
    el.innerHTML = snapshotHtml(data);
  } catch (err) {
    el.innerHTML = `<p class="charge-result error">${esc(err.message)}</p>`;
  }
}

// ---------- Changes ----------

// What the change actually did, judged from the response and the re-fetched sub.
function verdict(run) {
  const { ok, before, after, target } = run;
  const changed = after && before && after.product !== before.product;
  const onTarget = after?.product === target;
  if (before?.product === target)
    return { cls: "warn", text: "Not a valid test: sub was already on the target plan" };
  if (!ok && onTarget && changed)
    return { cls: "danger", text: "OUT OF SYNC: API returned an error but the plan was changed" };
  if (!ok && !changed) return { cls: "neutral", text: "Rejected cleanly, plan not changed" };
  if (ok && onTarget) return { cls: "success", text: "Success, plan changed" };
  if (ok && !onTarget) return { cls: "warn", text: "API returned success but the plan had not changed after 20s" };
  return { cls: "warn", text: "Unexpected, check the response" };
}

// The estimate returns 200 even when proration is blocked. The answer is
// in isProratable / prorationStatus, not the HTTP status.
function estimateSummary(est) {
  if (!est) return "";
  const item = est.response?.subscriptions?.[0] ?? est.response;
  const err = item?.error ? (typeof item.error === "string" ? item.error : Object.values(item.error).join("; ")) : null;
  if (est.httpStatus !== 200 || err) return `Estimate: HTTP ${est.httpStatus}${err ? ` · ${err}` : ""}`;
  if (item?.isProratable === false) return `Estimate: 200 but isProratable false · ${item.prorationStatus || "no reason given"}`;
  if (item?.isProratable === true) return `Estimate: 200, isProratable true · ${item.prorationStatus || ""}`;
  return "Estimate: 200, no isProratable field";
}

function renderResults() {
  if (!runs.length) {
    resultsEl.innerHTML = '<p class="empty-state">Nothing run yet.</p>';
    return;
  }
  resultsEl.innerHTML = runs
    .slice()
    .reverse()
    .map((r) => {
      if (r.pending) return `<div class="pc-run"><div class="member-name">${esc(r.title)}</div><div class="grid-loading"><div class="spinner"></div></div></div>`;
      if (r.failed) return `<div class="pc-run pc-run-warn"><div class="member-name">${esc(r.title)}</div><p class="charge-result error">${esc(r.failed)}</p></div>`;
      const v = r.kind === "change" ? verdict(r) : null;
      const entryDiff = r.before && r.after ? r.after.entryCount - r.before.entryCount : null;
      return `
        <div class="pc-run pc-run-${v?.cls || "neutral"}">
          <div class="pc-run-head">
            <div class="member-name">${esc(r.title)}</div>
            <div class="member-meta">${esc(new Date(r.at).toLocaleTimeString())} · <code>${esc(r.subscription)}</code></div>
          </div>
          ${v ? `<div class="pc-verdict pc-v-${v.cls}">${esc(v.text)}</div>` : ""}
          <ul class="pc-facts">
            ${r.estimate ? `<li>${esc(estimateSummary(r.estimate))}</li>` : ""}
            ${r.kind === "change" ? `<li>Change: HTTP ${esc(r.httpStatus)} · ${r.ok ? "success" : esc(r.error || "error")}</li>` : ""}
            ${r.before ? `<li>Plan: ${esc(planLabel(r.before.product))} → ${esc(planLabel(r.after?.product))}${r.kind === "change" ? (r.settledMs != null ? ` (showed after ${(r.settledMs / 1000).toFixed(1)}s)` : " (not on target after 20s)") : ""}</li>` : ""}
            ${r.after ? `<li>Next charge: ${esc(r.before?.nextChargeTotal ?? "-")} → ${esc(r.after.nextChargeTotal ?? "-")} on ${esc(r.after.next)}</li>` : ""}
            ${entryDiff != null ? `<li>New billing entries: ${entryDiff}${entryDiff ? " (proration charge or credit)" : " (no charge or credit)"}</li>` : ""}
            ${r.kind === "change" ? `<li>subscription.updated webhook: ${esc(r.webhook || "waiting…")}</li>` : ""}
          </ul>
          <details><summary>Request and response</summary><pre>${esc(JSON.stringify(
            { estimate: r.estimate, change: r.kind === "change" ? { sent: r.sent, httpStatus: r.httpStatus, response: r.response } : undefined, before: r.before, after: r.after },
            null,
            2,
          ))}</pre></details>
        </div>`;
    })
    .join("");
}

async function runEstimate(subscription, target, prorate) {
  const res = await storeFetch("/api/plan-change/estimate", {
    method: "POST",
    body: JSON.stringify({ subscription, product: target, prorate }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Estimate failed");
  return data;
}

// Checks the local webhook receiver for a subscription.updated on this sub
// since the change was sent. Only works if tariqh's webhook points at this
// server (same as the other demos).
async function waitForWebhook(run, since) {
  const deadline = Date.now() + WEBHOOK_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const data = await fetch("/api/webhooks/recent").then((r) => r.json());
      const hit = (data.events || []).find(
        ({ receivedAt, event }) =>
          new Date(receivedAt).getTime() >= since &&
          event.type === "subscription.updated" &&
          (event.data?.id === run.subscription || event.data?.subscription === run.subscription),
      );
      if (hit) {
        run.webhook = `received (${hit.event.data?.product || "?"})`;
        return renderResults();
      }
    } catch {
      /* receiver not reachable, keep trying until the deadline */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  run.webhook = `not received within ${WEBHOOK_WAIT_MS / 1000}s`;
  renderResults();
}

async function run({ target, prorate, title, from, estimateOnly = false }) {
  const subscription = subInput.value.trim();
  if (!subscription) {
    subInput.focus();
    return;
  }
  // Scenarios only mean something from the right starting plan, so block
  // e.g. a "B -> C" downgrade on a sub that is already on C.
  if (from) {
    const res = await storeFetch(`/api/plan-change/subscription/${encodeURIComponent(subscription)}`);
    const current = await res.json();
    if (!res.ok || current.product !== from) {
      runs.push({
        title,
        subscription,
        at: Date.now(),
        failed: res.ok
          ? `Sub is on ${planLabel(current.product)}, this scenario needs ${planLabel(from)}. Use a fresh sub (or run the upgrade first).`
          : current.error || "Lookup failed",
      });
      return renderResults();
    }
  }
  const entry = { title, subscription, target, prorate, at: Date.now(), pending: true, kind: estimateOnly ? "estimate" : "change" };
  runs.push(entry);
  renderResults();
  setButtons(true);

  try {
    if (estimateOnly || $("estimate-first").checked) {
      entry.estimate = await runEstimate(subscription, target, prorate);
    }
    if (!estimateOnly) {
      const since = Date.now();
      window.webhookLog?.expect(
        (ev) => ev.type === "subscription.updated" && (ev.data?.id === subscription || ev.data?.subscription === subscription),
        `plan change on ${subscription}`,
      );
      const res = await storeFetch("/api/plan-change/change", {
        method: "POST",
        body: JSON.stringify({ subscription, product: target, prorate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Change failed");
      Object.assign(entry, data);
      waitForWebhook(entry, since);
      $("sub-snapshot").innerHTML = snapshotHtml(data.after);
    }
    entry.pending = false;
  } catch (err) {
    entry.pending = false;
    entry.failed = err.message;
  } finally {
    setButtons(false);
    renderResults();
  }
}

function setButtons(disabled) {
  document.querySelectorAll(".pc-scenarios button, #custom-estimate, #custom-change").forEach((b) => (b.disabled = disabled));
}

// Plain text for pasting into Slack or the ticket.
function summaryText() {
  return runs
    .filter((r) => !r.pending)
    .map((r) => {
      const lines = [`${new Date(r.at).toISOString()}  ${r.title}  sub ${r.subscription}`];
      if (r.failed) lines.push(`  failed: ${r.failed}`);
      if (r.estimate) {
        lines.push(`  ${estimateSummary(r.estimate)}`);
        lines.push(`  estimate sent ${JSON.stringify(r.estimate.sent)}`);
        const est = r.estimate.response || {};
        lines.push(`  estimate isProratable ${est.isProratable} · prorationStatus ${est.prorationStatus}`);
      }
      if (r.kind === "change" && !r.failed) {
        lines.push(`  ${verdict(r).text}`);
        lines.push(`  change HTTP ${r.httpStatus} ${r.ok ? "success" : r.error || "error"}`);
        lines.push(`  plan ${r.before?.product} -> ${r.after?.product}${r.settledMs != null ? ` after ${(r.settledMs / 1000).toFixed(1)}s` : " (not on target after 20s)"}`);
        lines.push(`  new billing entries ${r.after.entryCount - r.before.entryCount}`);
        lines.push(`  subscription.updated webhook ${r.webhook || "pending"}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

// ---------- Wiring ----------

document.querySelectorAll(".pc-scenarios button").forEach((btn) =>
  btn.addEventListener("click", () => {
    const target = planByRole(btn.dataset.target)?.product;
    if (!target) return;
    const from = planByRole(btn.dataset.from)?.product;
    run({ target, from, prorate: btn.dataset.prorate === "true", title: btn.textContent.replace(/\s+/g, " ").trim() });
  }),
);

$("custom-estimate").addEventListener("click", () => {
  const prorate = $("custom-prorate").value === "true";
  run({ target: $("custom-target").value, prorate, estimateOnly: true, title: `Estimate → ${$("custom-target").value} prorate:${prorate}` });
});
$("custom-change").addEventListener("click", () => {
  const prorate = $("custom-prorate").value === "true";
  run({ target: $("custom-target").value, prorate, title: `Change → ${$("custom-target").value} prorate:${prorate}` });
});

$("buy-btn").addEventListener("click", buyPlanA);
$("sub-load").addEventListener("click", loadSub);
subInput.addEventListener("keydown", (e) => e.key === "Enter" && loadSub());
$("plans-refresh").addEventListener("click", loadPlans);
$("clear-results").addEventListener("click", () => {
  runs.length = 0;
  renderResults();
});
$("copy-results").addEventListener("click", async (e) => {
  await navigator.clipboard.writeText(summaryText());
  e.currentTarget.textContent = "Copied ✓";
  setTimeout(() => ($("copy-results").textContent = "Copy summary"), 1500);
});

loadPlans();
