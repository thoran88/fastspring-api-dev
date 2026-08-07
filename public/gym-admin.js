const listEl = document.getElementById("members-list");
const refreshBtn = document.getElementById("refresh-btn");

function renderLoading() {
  listEl.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "grid-loading";
  const spinner = document.createElement("div");
  spinner.className = "spinner";
  wrap.appendChild(spinner);
  listEl.appendChild(wrap);
}

function renderMessage(message) {
  listEl.innerHTML = "";
  const el = document.createElement("p");
  el.className = "empty-state";
  el.textContent = message;
  listEl.appendChild(el);
}

function statusClass(state) {
  if (state === "active") return "success";
  if (state === "overdue" || state === "deactivated") return "error";
  return "";
}

async function loadMembers() {
  renderLoading();
  try {
    const res = await fetch("/api/gym/members");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load members");
    renderMembers(data.members || []);
  } catch (err) {
    renderMessage(err.message);
  }
}

function renderMembers(members) {
  if (members.length === 0) {
    renderMessage(
      "No gym members yet - sign up on the customer page to create one.",
    );
    return;
  }

  listEl.innerHTML = "";
  members.forEach((m) => {
    const row = document.createElement("div");
    row.className = "member-row";

    const info = document.createElement("div");
    info.className = "member-info";

    const nameEl = document.createElement("div");
    nameEl.className = "member-name";
    nameEl.textContent = m.name || m.email || m.id;

    const metaEl = document.createElement("div");
    metaEl.className = "member-meta";

    const emailSpan = document.createElement("span");
    emailSpan.textContent = m.email || m.id;
    metaEl.appendChild(emailSpan);

    if (m.price) {
      metaEl.append(" · ", m.price);
    }

    const badge = document.createElement("span");
    badge.className = `member-badge ${statusClass(m.state)}`;
    badge.textContent = m.state || "unknown";
    metaEl.append(" · ");
    metaEl.appendChild(badge);

    info.append(nameEl, metaEl);

    const actions = document.createElement("div");
    actions.className = "member-actions";

    const amountInput = document.createElement("input");
    amountInput.type = "number";
    amountInput.min = "0";
    amountInput.step = "0.01";
    amountInput.placeholder = "Amount";
    amountInput.className = "member-amount-input";

    const chargeBtn = document.createElement("button");
    chargeBtn.className = "buy-btn member-action-btn";
    chargeBtn.textContent = "Charge";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "continue-btn member-action-btn";
    cancelBtn.textContent = "Cancel";

    const isDead = m.state === "deactivated" || m.state === "canceled";
    if (isDead) {
      amountInput.disabled = true;
      chargeBtn.disabled = true;
      cancelBtn.disabled = true;
    }

    actions.append(amountInput, chargeBtn, cancelBtn);

    const resultEl = document.createElement("div");
    resultEl.className = "charge-result member-result";

    row.append(info, actions, resultEl);
    listEl.appendChild(row);

    chargeBtn.addEventListener("click", () =>
      chargeMember(m.id, amountInput.value, chargeBtn, resultEl),
    );
    cancelBtn.addEventListener("click", () =>
      cancelMember(m.id, cancelBtn, resultEl),
    );
  });
}

async function chargeMember(id, amount, button, resultEl) {
  resultEl.textContent = "";
  resultEl.className = "charge-result member-result";

  if (!amount || Number(amount) <= 0) {
    resultEl.textContent = "Enter an amount greater than 0.";
    resultEl.classList.add("error");
    return;
  }

  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = "Charging…";

  try {
    const res = await fetch(
      `/api/subscriptions/${encodeURIComponent(id)}/charge`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(amount) }),
      },
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Charge failed");

    resultEl.textContent = `Charged $${Number(amount).toFixed(2)}.`;
    resultEl.classList.add("success");
    // Give the confirmation a moment on screen before the list refresh
    // (which re-renders this whole row) replaces it.
    button.textContent = "Charged ✓";
    setTimeout(loadMembers, 1400);
  } catch (err) {
    resultEl.textContent = err.message;
    resultEl.classList.add("error");
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function cancelMember(id, button, resultEl) {
  if (!confirm("Cancel this member's subscription?")) return;

  resultEl.textContent = "";
  resultEl.className = "charge-result member-result";
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = "Canceling…";

  try {
    const res = await fetch(
      `/api/subscriptions/${encodeURIComponent(id)}/cancel`,
      { method: "POST" },
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Cancel failed");

    resultEl.textContent = "Subscription canceled.";
    resultEl.classList.add("success");
    button.textContent = "Canceled ✓";
    setTimeout(loadMembers, 1400);
  } catch (err) {
    resultEl.textContent = err.message;
    resultEl.classList.add("error");
    button.disabled = false;
    button.textContent = originalText;
  }
}

refreshBtn.addEventListener("click", loadMembers);
loadMembers();
