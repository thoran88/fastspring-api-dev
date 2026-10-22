import {
  storeFetch,
  getManagedProducts,
  renewAndPoll,
  describeItem,
  esc,
} from "./renew-api.js";

// Gym-style admin, but renewing goes through POST /subscriptions/renew
// (one async call, idempotency key, polling) instead of POST /subscriptions
// then POST /subscriptions/charge.

const listEl = document.getElementById("members-list");
const productFilter = document.getElementById("product-filter");
const netTermsInput = document.getElementById("net-terms");
const simulateSelect = document.getElementById("simulate");
const bulkResult = document.getElementById("bulk-result");
let products = [];
let members = [];

function renderLoading() {
  listEl.innerHTML = '<div class="grid-loading"><div class="spinner"></div></div>';
}

function renderMessage(message) {
  listEl.innerHTML = `<p class="empty-state">${esc(message)}</p>`;
}

function statusClass(state) {
  if (state === "active") return "success";
  if (state === "overdue" || state === "deactivated") return "error";
  return "";
}

// Options shared by single and bulk renew: batch net terms and simulate.
function batchOptions() {
  const out = {};
  if (netTermsInput.value.trim() !== "") out.netTerms = Number(netTermsInput.value);
  return out;
}

function itemFor(id, price) {
  const item = { subscription: id };
  if (price !== "" && price != null) item.pricing = { price: Number(price) };
  if (simulateSelect.value) item.simulate = simulateSelect.value;
  return item;
}

async function loadProducts() {
  products = await getManagedProducts();
  productFilter.innerHTML =
    '<option value="">All managed</option>' +
    products.map((p) => `<option value="${esc(p.product)}">${esc(p.display || p.product)}</option>`).join("");
}

async function loadMembers() {
  renderLoading();
  try {
    if (!products.length) await loadProducts();
    const wanted = productFilter.value ? [productFilter.value] : products.map((p) => p.product);
    const lists = await Promise.all(
      wanted.map(async (product) => {
        const res = await storeFetch(`/api/members?product=${encodeURIComponent(product)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load subscribers");
        return (data.members || []).map((m) => ({ ...m, product }));
      }),
    );
    members = lists.flat();
    renderMembers();
  } catch (err) {
    renderMessage(err.message);
  }
}

function renderMembers() {
  if (members.length === 0) {
    renderMessage("No test subscribers yet. Sign up on the popup or embedded page first.");
    return;
  }

  listEl.innerHTML = "";
  members.forEach((m) => {
    const row = document.createElement("div");
    row.className = "member-row";
    const isDead = m.state === "deactivated" || m.state === "canceled";
    row.innerHTML = `
      <div class="member-info">
        <div class="member-name">${esc(m.name || m.email || m.id)}</div>
        <div class="member-meta">
          <span>${esc(m.email || "")}</span>
          · <code>${esc(m.id)}</code>
          · ${esc(m.product)}
          ${m.price ? `· ${esc(m.price)}` : ""}
          · <span class="member-badge ${statusClass(m.state)}">${esc(m.state || "unknown")}</span>
        </div>
      </div>
      <div class="member-actions">
        <input type="number" min="0" step="0.01" placeholder="Price" class="member-amount-input" ${isDead ? "disabled" : ""} />
        <button class="buy-btn member-action-btn" data-a="renew" ${isDead ? "disabled" : ""}>Renew</button>
        <button class="continue-btn member-action-btn" data-a="cancel" ${isDead ? "disabled" : ""}>Cancel</button>
      </div>
      <div class="charge-result member-result"></div>`;
    const priceInput = row.querySelector("input");
    const resultEl = row.querySelector(".member-result");
    row.querySelector('[data-a="renew"]').addEventListener("click", (e) =>
      renewOne(m.id, priceInput.value, e.currentTarget, resultEl),
    );
    row.querySelector('[data-a="cancel"]').addEventListener("click", (e) =>
      cancelMember(m.id, e.currentTarget, resultEl),
    );
    listEl.appendChild(row);
  });
}

function showItemResult(resultEl, item) {
  const d = describeItem(item);
  resultEl.className = `charge-result member-result ${d.ok ? "success" : "error"}`;
  resultEl.innerHTML =
    `${d.track ? `<strong>Track ${d.track}.</strong> ` : ""}${esc(d.text)}` +
    (d.url ? ` <a href="${esc(d.url)}" target="_blank" rel="noopener">Open invoice ${esc(d.invoiceId || "")}</a>` : "");
}

async function renewOne(id, price, button, resultEl) {
  resultEl.className = "charge-result member-result";
  resultEl.textContent = "";
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = "Renewing…";

  try {
    const result = await renewAndPoll(
      { ...batchOptions(), subscriptions: [itemFor(id, price)] },
      ({ phase, httpStatus, status, polls }) => {
        resultEl.textContent =
          phase === "start"
            ? `Accepted (HTTP ${httpStatus}), waiting for FastSpring…`
            : `Poll ${polls}: HTTP ${httpStatus} ${status || ""}`;
      },
    );
    const item = result.items.find((i) => i.subscription === id) || result.items[0];
    showItemResult(resultEl, item);
    button.textContent = "Renew";
    button.disabled = false;
    // Price and state change on Track A, so refresh the row data. Keep the
    // result line visible on the re-rendered row.
    const keep = resultEl.innerHTML;
    const keepClass = resultEl.className;
    await loadMembers();
    const rowIndex = members.findIndex((m) => m.id === id);
    const newRow = listEl.querySelectorAll(".member-row")[rowIndex];
    if (newRow) {
      const el = newRow.querySelector(".member-result");
      el.innerHTML = keep;
      el.className = keepClass;
    }
  } catch (err) {
    resultEl.className = "charge-result member-result error";
    resultEl.textContent = err.message;
    button.disabled = false;
    button.textContent = originalText;
  }
}

// One renew call for every active sub in the list (max 50 per batch).
document.getElementById("renew-all-btn").addEventListener("click", async (e) => {
  const active = members.filter((m) => m.state === "active");
  if (!active.length) {
    bulkResult.className = "charge-result error";
    bulkResult.textContent = "No active subscribers to renew.";
    return;
  }
  const batch = active.slice(0, 50);
  if (!confirm(`Renew ${batch.length} active test subscription(s) at their current price?`)) return;

  const btn = e.currentTarget;
  btn.disabled = true;
  bulkResult.className = "charge-result";
  bulkResult.textContent = `Renewing ${batch.length}…`;

  try {
    const result = await renewAndPoll(
      { ...batchOptions(), subscriptions: batch.map((m) => itemFor(m.id, "")) },
      ({ httpStatus, status, polls }) => {
        bulkResult.textContent = `Batch of ${batch.length}: HTTP ${httpStatus} ${status || ""}${polls ? ` (poll ${polls})` : ""}`;
      },
    );
    const described = result.items.map(describeItem);
    const charged = described.filter((d) => d.ok && d.track === "A").length;
    const invoiced = described.filter((d) => d.ok && d.track === "B").length;
    const failed = described.filter((d) => !d.ok).length;
    bulkResult.className = `charge-result ${failed ? "error" : "success"}`;
    bulkResult.textContent = `Batch ${result.status || "done"}: ${charged} charged, ${invoiced} invoiced, ${failed} failed.`;

    // Put each result on its row.
    [...listEl.querySelectorAll(".member-row")].forEach((row, i) => {
      const item = result.items.find((it) => it.subscription === members[i]?.id);
      if (item) showItemResult(row.querySelector(".member-result"), item);
    });
  } catch (err) {
    bulkResult.className = "charge-result error";
    bulkResult.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

async function cancelMember(id, button, resultEl) {
  if (!confirm("Cancel this subscription?")) return;
  button.disabled = true;
  button.textContent = "Canceling…";
  try {
    const res = await storeFetch(`/api/subscriptions/${encodeURIComponent(id)}/cancel`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Cancel failed");
    resultEl.className = "charge-result member-result success";
    resultEl.textContent = "Canceled.";
    setTimeout(loadMembers, 1400);
  } catch (err) {
    resultEl.className = "charge-result member-result error";
    resultEl.textContent = err.message;
    button.disabled = false;
    button.textContent = "Cancel";
  }
}

productFilter.addEventListener("change", loadMembers);
document.getElementById("refresh-btn").addEventListener("click", loadMembers);
loadMembers();
