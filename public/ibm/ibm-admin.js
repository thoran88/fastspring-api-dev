const listEl = document.getElementById("members-list");
const refreshBtn = document.getElementById("refresh-btn");
const bulkBtn = document.getElementById("bulk-rebill-btn");
const bulkResultEl = document.getElementById("bulk-rebill-result");

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
    const res = await fetch("/api/members?product=ibm-sub");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load subscribers");
    renderMembers(data.members || []);
  } catch (err) {
    renderMessage(err.message);
  }
}

function renderMembers(members) {
  if (members.length === 0) {
    renderMessage(
      "No subscribers yet - sign up on the customer page to create one.",
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

    if (m.nextChargeDate) {
      metaEl.append(` · next charge ${m.nextChargeDate}`);
    }

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

  window.webhookLog?.expect(
    (event) =>
      (event.type === "subscription.charge.completed" ||
        event.type === "subscription.charge.failed") &&
      (event.data?.id === id || event.data?.subscription === id),
    `charge on ${id}`,
  );

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
  if (!confirm("Cancel this subscriber's subscription?")) return;

  resultEl.textContent = "";
  resultEl.className = "charge-result member-result";
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = "Canceling…";

  window.webhookLog?.expect(
    (event) =>
      event.type === "subscription.canceled" &&
      (event.data?.id === id || event.data?.subscription === id),
    `cancellation of ${id}`,
  );

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

// Simulates the 1st-of-the-month usage rebill in one click - real usage
// metering isn't part of this demo, so the server picks a random amount per
// active subscriber (mostly low, occasionally a deliberate high-amount test
// case) rather than this admin panel asking for one amount per person.
async function runBulkRebill() {
  if (!confirm("Charge every active IBM-sub subscriber a random amount now?")) {
    return;
  }

  bulkBtn.disabled = true;
  const originalText = bulkBtn.textContent;
  bulkBtn.textContent = "Charging all subscribers…";
  bulkResultEl.innerHTML = "";

  try {
    const res = await fetch("/api/subscriptions/bulk-charge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product: "ibm-sub" }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Bulk charge failed");

    const summary = document.createElement("p");
    summary.className = `charge-result ${data.failed > 0 ? "error" : "success"}`;
    summary.textContent = `Charged ${data.charged} subscriber(s), ${data.failed} failed.`;
    bulkResultEl.appendChild(summary);

    data.results.forEach((r) => {
      const row = document.createElement("div");
      row.className = "member-meta";
      row.textContent = `${r.subscription} — $${Number(r.amount).toFixed(2)} — ${r.result}${
        r.error ? ` (${r.error})` : ""
      }`;
      bulkResultEl.appendChild(row);
    });

    setTimeout(loadMembers, 1500);
  } catch (err) {
    const errorEl = document.createElement("p");
    errorEl.className = "charge-result error";
    errorEl.textContent = err.message;
    bulkResultEl.appendChild(errorEl);
  } finally {
    bulkBtn.disabled = false;
    bulkBtn.textContent = originalText;
  }
}

bulkBtn.addEventListener("click", runBulkRebill);
refreshBtn.addEventListener("click", loadMembers);
loadMembers();
