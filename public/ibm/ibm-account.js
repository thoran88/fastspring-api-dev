const PRODUCT_PATH = "ibm-sub";

const lookupEmail = document.getElementById("lookup-email");
const lookupBtn = document.getElementById("lookup-btn");
const lookupError = document.getElementById("lookup-error");

const accountCard = document.getElementById("account-card");
const accountName = document.getElementById("account-name");
const accountMeta = document.getElementById("account-meta");
const updatePaymentBtn = document.getElementById("update-payment-btn");
const cancelBtn = document.getElementById("cancel-btn");
const viewHistoryLink = document.getElementById("view-history-link");
const accountActionResult = document.getElementById("account-action-result");

const historyCard = document.getElementById("history-card");
const historyList = document.getElementById("history-list");

let member = null;

function statusClass(state) {
  if (state === "active") return "success";
  if (state === "overdue" || state === "deactivated") return "error";
  return "";
}

function renderMember() {
  accountName.textContent = member.name || member.email;
  accountMeta.innerHTML = "";
  accountMeta.append(member.email, " · ", member.price || "no price set", " · ");
  const badge = document.createElement("span");
  badge.className = `member-badge ${statusClass(member.state)}`;
  badge.textContent = member.state || "unknown";
  accountMeta.appendChild(badge);
  if (member.nextChargeDate) {
    accountMeta.append(` · next charge ${member.nextChargeDate}`);
  }

  const isDead = member.state === "deactivated" || member.state === "canceled";
  updatePaymentBtn.disabled = isDead;
  cancelBtn.disabled = isDead;
}

async function loadHistory(accountId) {
  historyCard.style.display = "block";
  historyList.innerHTML = "";
  const loading = document.createElement("p");
  loading.className = "empty-state";
  loading.textContent = "Loading statements…";
  historyList.appendChild(loading);

  try {
    const res = await fetch(
      `/api/accounts/${encodeURIComponent(accountId)}/history`,
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load statements");
    renderHistory(data.orders || []);
  } catch (err) {
    historyList.innerHTML = "";
    const el = document.createElement("p");
    el.className = "empty-state";
    el.textContent = err.message;
    historyList.appendChild(el);
  }
}

function renderHistory(orders) {
  historyList.innerHTML = "";

  if (orders.length === 0) {
    const el = document.createElement("p");
    el.className = "empty-state";
    el.textContent = "No charges yet.";
    historyList.appendChild(el);
    return;
  }

  orders.forEach((order) => {
    const row = document.createElement("div");
    row.className = "member-row";

    const info = document.createElement("div");
    const nameEl = document.createElement("div");
    nameEl.className = "member-name";
    nameEl.textContent = order.items.map((i) => i.display).join(", ") || order.reference;

    const metaEl = document.createElement("div");
    metaEl.className = "member-meta";
    metaEl.append(order.date, " · ", order.total);
    if (order.reference) metaEl.append(" · ", order.reference);

    info.append(nameEl, metaEl);

    const actions = document.createElement("div");
    if (order.invoiceUrl) {
      const link = document.createElement("a");
      link.href = order.invoiceUrl;
      link.target = "_blank";
      link.rel = "noopener";
      link.className = "admin-link";
      link.textContent = "Receipt →";
      actions.appendChild(link);
    }

    row.append(info, actions);
    historyList.appendChild(row);
  });
}

async function findAccount() {
  lookupError.style.display = "none";
  const email = lookupEmail.value.trim();
  if (!email) {
    lookupError.textContent = "Enter an email address.";
    lookupError.style.display = "block";
    return;
  }

  lookupBtn.disabled = true;
  lookupBtn.textContent = "Looking up…";

  try {
    const res = await fetch(
      `/api/my-account?email=${encodeURIComponent(email)}&product=${PRODUCT_PATH}`,
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Account not found");

    member = data.member;
    renderMember();

    const authRes = await fetch(
      `/api/accounts/${encodeURIComponent(member.accountId)}/authenticate`,
    );
    const authData = await authRes.json();
    if (!authRes.ok) throw new Error(authData.error || "Failed to authenticate account");

    viewHistoryLink.href = authData.url;
    fastspring.epml.init(authData.url);

    accountCard.style.display = "block";
    loadHistory(member.accountId);
  } catch (err) {
    lookupError.textContent = err.message;
    lookupError.style.display = "block";
    accountCard.style.display = "none";
    historyCard.style.display = "none";
  } finally {
    lookupBtn.disabled = false;
    lookupBtn.textContent = "Find my account";
  }
}

function showAccountResult(message, isError) {
  accountActionResult.textContent = message;
  accountActionResult.className = `charge-result ${isError ? "error" : "success"}`;
}

async function cancelMembership() {
  if (!confirm("Cancel this subscription?")) return;

  cancelBtn.disabled = true;
  const originalText = cancelBtn.textContent;
  cancelBtn.textContent = "Canceling…";

  try {
    const res = await fetch(
      `/api/subscriptions/${encodeURIComponent(member.id)}/cancel`,
      { method: "POST" },
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Cancel failed");

    member.state = "canceled";
    renderMember();
    showAccountResult("Subscription canceled.", false);
    cancelBtn.textContent = "Canceled ✓";
  } catch (err) {
    showAccountResult(err.message, true);
    cancelBtn.disabled = false;
    cancelBtn.textContent = originalText;
  }
}

lookupBtn.addEventListener("click", findAccount);
lookupEmail.addEventListener("keydown", (e) => {
  if (e.key === "Enter") findAccount();
});

updatePaymentBtn.addEventListener("click", () => {
  fastspring.epml.paymentManagementComponent(member.id);
});

cancelBtn.addEventListener("click", cancelMembership);
