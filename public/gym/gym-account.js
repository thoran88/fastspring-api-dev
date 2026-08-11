const PRODUCT_PATH = "gym-as-you-go";
const COURT_BOOKING_AMOUNT = 15;

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

const bookingCard = document.getElementById("booking-card");
const bookCourtBtn = document.getElementById("book-court-btn");
const bookingError = document.getElementById("booking-error");
const bookingSuccess = document.getElementById("booking-success");

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
  bookCourtBtn.disabled = isDead;
}

async function loadHistory(accountId) {
  historyCard.style.display = "block";
  historyList.innerHTML = "";
  const loading = document.createElement("p");
  loading.className = "empty-state";
  loading.textContent = "Loading order history…";
  historyList.appendChild(loading);

  try {
    const res = await fetch(
      `/api/accounts/${encodeURIComponent(accountId)}/history`,
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load order history");
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
    el.textContent = "No orders yet.";
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
      // FastSpring's field is literally named invoiceUrl, but the page it
      // points to is titled "RECEIPT" / "Paid In Full" - label it as what
      // it actually shows, not what the field happens to be called.
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
    bookingCard.style.display = "block";
    loadHistory(member.accountId);
  } catch (err) {
    lookupError.textContent = err.message;
    lookupError.style.display = "block";
    accountCard.style.display = "none";
    bookingCard.style.display = "none";
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
  if (!confirm("Cancel this membership?")) return;

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
    showAccountResult("Membership canceled.", false);
    cancelBtn.textContent = "Canceled ✓";
  } catch (err) {
    showAccountResult(err.message, true);
    cancelBtn.disabled = false;
    cancelBtn.textContent = originalText;
  }
}

// No checkout at all - the member already has a chargeable payment method
// on file from their Managed Subscription, so this reuses the same
// set-price-then-charge API the staff admin panel uses instead of running
// a second checkout. Tradeoff (accepted): this shows up in order history as
// a "Gym as you go" subscription charge, not a distinct "Tennis Court
// Booking" line item, since it doesn't go through that product at all.
async function bookCourt() {
  bookingError.style.display = "none";
  bookCourtBtn.disabled = true;
  bookCourtBtn.textContent = "Booking…";

  try {
    const res = await fetch(
      `/api/subscriptions/${encodeURIComponent(member.id)}/charge`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: COURT_BOOKING_AMOUNT }),
      },
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Charge failed");

    bookCourtBtn.style.display = "none";
    bookingSuccess.style.display = "block";
    loadHistory(member.accountId);
  } catch (err) {
    bookingError.textContent = err.message;
    bookingError.style.display = "block";
    bookCourtBtn.disabled = false;
    bookCourtBtn.textContent = "Book now - $15.00";
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
bookCourtBtn.addEventListener("click", bookCourt);
