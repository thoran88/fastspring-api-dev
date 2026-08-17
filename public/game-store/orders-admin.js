const statusFilter = document.getElementById("status-filter");
const productFilter = document.getElementById("product-filter");
const refreshOrdersBtn = document.getElementById("refresh-orders-btn");
const ordersList = document.getElementById("orders-list");
const ordersPageInfo = document.getElementById("orders-page-info");
const prevPageBtn = document.getElementById("prev-page-btn");
const nextPageBtn = document.getElementById("next-page-btn");

const queueCard = document.getElementById("queue-card");
const queueList = document.getElementById("queue-list");
const processBtn = document.getElementById("process-btn");
const processError = document.getElementById("process-error");

const resultsCard = document.getElementById("results-card");
const resultsList = document.getElementById("results-list");

const historyList = document.getElementById("history-list");
const refreshHistoryBtn = document.getElementById("refresh-history-btn");

const REASONS = [
  "OTHER",
  "COMPATIBILITY_ISSUE",
  "DISCOUNT",
  "DUPLICATE_ORDER",
  "FRAUDULENT",
  "ORDER_ERROR",
  "PRODUCT_DIFFERENCE",
  "PRODUCT_NOT_RECEIVED",
  "TAX_REFUND",
  "NONE",
];

let page = 1;
let lastPageFetched = 1; // whether "Next" should be enabled
const PAGE_SIZE = 25;

// Keyed by order ID - checking a box adds an entry here, unchecking removes
// it. The order list and the queue panel both read/write the same Map so
// they always agree on what's selected.
const queue = new Map();

function alreadyRefunded(order) {
  return (order.returns || []).reduce((sum, r) => sum + r.amount, 0);
}

function renderLoading(el) {
  el.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "grid-loading";
  const spinner = document.createElement("div");
  spinner.className = "spinner";
  wrap.appendChild(spinner);
  el.appendChild(wrap);
}

function renderMessage(el, message) {
  el.innerHTML = "";
  const p = document.createElement("p");
  p.className = "empty-state";
  p.textContent = message;
  el.appendChild(p);
}

async function loadOrders() {
  renderLoading(ordersList);

  const params = new URLSearchParams({
    status: statusFilter.value,
    page: String(page),
    limit: String(PAGE_SIZE),
  });
  if (productFilter.value.trim()) {
    params.set("products", productFilter.value.trim());
  }

  try {
    const res = await fetch(`/api/orders?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load orders");
    renderOrders(data.orders || [], data.total ?? 0);
  } catch (err) {
    renderMessage(ordersList, err.message);
  }
}

// Cached so the queue panel's "Remove" button can re-render the checkbox
// list's checked state without an extra fetch.
let currentOrdersCache = [];
let currentTotalCache = 0;

function renderOrders(orders, total) {
  currentOrdersCache = orders;
  currentTotalCache = total;
  ordersPageInfo.textContent = `Page ${page} - ${total} order${total === 1 ? "" : "s"} total`;
  prevPageBtn.disabled = page <= 1;
  nextPageBtn.disabled = orders.length < PAGE_SIZE;

  if (orders.length === 0) {
    renderMessage(ordersList, "No orders match this filter.");
    return;
  }

  ordersList.innerHTML = "";
  orders.forEach((order) => {
    const refunded = alreadyRefunded(order);
    const remaining = order.total - refunded;

    const row = document.createElement("div");
    row.className = "member-row";

    const checkboxWrap = document.createElement("div");
    checkboxWrap.style.display = "flex";
    checkboxWrap.style.alignItems = "flex-start";
    checkboxWrap.style.gap = "0.8rem";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = queue.has(order.order);
    checkbox.disabled = remaining <= 0;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        queue.set(order.order, {
          order,
          refundType: "FULL",
          reason: "OTHER",
          note: "",
          notification: "NONE",
          itemAmounts: Object.fromEntries(
            (order.items || []).map((item) => [item.product, item.subtotal]),
          ),
        });
      } else {
        queue.delete(order.order);
      }
      renderQueue();
    });

    const info = document.createElement("div");
    const nameEl = document.createElement("div");
    nameEl.className = "member-name";
    nameEl.textContent = `${order.reference} - ${(order.items || []).map((i) => i.display).join(", ")}`;

    const metaEl = document.createElement("div");
    metaEl.className = "member-meta";
    metaEl.append(`${order.changedDisplay} · ${order.totalDisplay}`);
    if (refunded > 0) {
      const badge = document.createElement("span");
      badge.className = `member-badge ${remaining <= 0 ? "error" : ""}`;
      badge.textContent = remaining <= 0 ? "fully refunded" : "partially refunded";
      metaEl.append(" · ");
      metaEl.appendChild(badge);
    }

    info.append(nameEl, metaEl);
    checkboxWrap.append(checkbox, info);
    row.appendChild(checkboxWrap);
    ordersList.appendChild(row);
  });
}

function renderQueue() {
  queueList.innerHTML = "";
  queueCard.style.display = queue.size > 0 ? "block" : "none";

  for (const [id, entry] of queue) {
    const { order } = entry;
    const refunded = alreadyRefunded(order);
    const remaining = order.total - refunded;

    const row = document.createElement("div");
    row.className = "member-row";
    row.style.gridTemplateColumns = "1fr";

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "baseline";

    const nameEl = document.createElement("div");
    nameEl.className = "member-name";
    nameEl.textContent = `${order.reference} - ${(order.items || []).map((i) => i.display).join(", ")}`;

    const removeBtn = document.createElement("button");
    removeBtn.className = "continue-btn member-action-btn";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      queue.delete(id);
      renderQueue();
      renderOrders(currentOrdersCache, currentTotalCache);
    });

    header.append(nameEl, removeBtn);

    const metaEl = document.createElement("div");
    metaEl.className = "member-meta";
    metaEl.append(
      `Total ${order.totalDisplay} · Remaining refundable ${remaining.toFixed(2)} ${order.currency}`,
    );
    if (refunded > 0) {
      metaEl.append(` (already refunded ${refunded.toFixed(2)} ${order.currency})`);
    }

    const controls = document.createElement("div");
    controls.style.marginTop = "0.8rem";
    controls.style.display = "flex";
    controls.style.flexDirection = "column";
    controls.style.gap = "0.6rem";

    const controlsRow = document.createElement("div");
    controlsRow.className = "field-row";

    const reasonField = document.createElement("div");
    reasonField.className = "field";
    const reasonLabel = document.createElement("label");
    reasonLabel.textContent = "Reason";
    const reasonSelect = document.createElement("select");
    REASONS.forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r;
      opt.textContent = r.replace(/_/g, " ");
      if (r === entry.reason) opt.selected = true;
      reasonSelect.appendChild(opt);
    });
    reasonSelect.addEventListener("change", () => {
      entry.reason = reasonSelect.value;
    });
    reasonField.append(reasonLabel, reasonSelect);

    const typeField = document.createElement("div");
    typeField.className = "field";
    const typeLabel = document.createElement("label");
    typeLabel.textContent = "Refund type";
    const typeSelect = document.createElement("select");
    ["FULL", "PARTIAL"].forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t === "FULL" ? "Full refund" : "Partial refund";
      if (t === entry.refundType) opt.selected = true;
      typeSelect.appendChild(opt);
    });
    typeSelect.addEventListener("change", () => {
      entry.refundType = typeSelect.value;
      renderQueue();
    });
    typeField.append(typeLabel, typeSelect);

    const notifyField = document.createElement("div");
    notifyField.className = "field";
    const notifyLabel = document.createElement("label");
    notifyLabel.textContent = "Email customer";
    const notifySelect = document.createElement("select");
    [["NONE", "No"], ["ORIGINAL", "Yes"]].forEach(([value, label]) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      if (value === entry.notification) opt.selected = true;
      notifySelect.appendChild(opt);
    });
    notifySelect.addEventListener("change", () => {
      entry.notification = notifySelect.value;
    });
    notifyField.append(notifyLabel, notifySelect);

    controlsRow.append(reasonField, typeField, notifyField);
    controls.appendChild(controlsRow);

    if (entry.refundType === "PARTIAL") {
      const itemsWrap = document.createElement("div");
      itemsWrap.className = "field-row";
      (order.items || []).forEach((item) => {
        const itemField = document.createElement("div");
        itemField.className = "field";
        const itemLabel = document.createElement("label");
        itemLabel.textContent = `${item.display} (max ${item.subtotal})`;
        const itemInput = document.createElement("input");
        itemInput.type = "number";
        itemInput.min = "0";
        itemInput.max = String(item.subtotal);
        itemInput.step = "0.01";
        itemInput.value = entry.itemAmounts[item.product];
        itemInput.addEventListener("input", () => {
          entry.itemAmounts[item.product] = Number(itemInput.value) || 0;
        });
        itemField.append(itemLabel, itemInput);
        itemsWrap.appendChild(itemField);
      });
      controls.appendChild(itemsWrap);
    }

    const noteField = document.createElement("div");
    noteField.className = "field";
    const noteLabel = document.createElement("label");
    noteLabel.textContent = "Note (optional, customer-visible)";
    const noteInput = document.createElement("textarea");
    noteInput.rows = 2;
    noteInput.value = entry.note;
    noteInput.addEventListener("input", () => {
      entry.note = noteInput.value;
    });
    noteField.append(noteLabel, noteInput);
    controls.appendChild(noteField);

    row.append(header, metaEl, controls);
    queueList.appendChild(row);
  }
}

function buildReturnsPayload() {
  return [...queue.values()].map((entry) => {
    const base = {
      order: entry.order.order,
      reason: entry.reason,
      notification: entry.notification,
      refundType: entry.refundType,
    };
    if (entry.note.trim()) base.note = entry.note.trim();
    if (entry.refundType === "PARTIAL") {
      base.items = Object.entries(entry.itemAmounts)
        .filter(([, amount]) => amount > 0)
        .map(([product, amount]) => ({ product, amount }));
    }
    return base;
  });
}

async function processQueue() {
  processError.style.display = "none";
  const returns = buildReturnsPayload();
  if (returns.length === 0) return;

  const invalidPartial = returns.find(
    (r) => r.refundType === "PARTIAL" && (!r.items || r.items.length === 0),
  );
  if (invalidPartial) {
    processError.textContent = "Set at least one item amount above 0 for each partial refund.";
    processError.style.display = "block";
    return;
  }

  processBtn.disabled = true;
  processBtn.textContent = "Processing…";

  try {
    const res = await fetch("/api/refunds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ returns }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Refund request failed");

    renderResults(data.returns || []);
    queue.clear();
    renderQueue();
    loadOrders();
    loadHistory();
  } catch (err) {
    processError.textContent = err.message;
    processError.style.display = "block";
  } finally {
    processBtn.disabled = false;
    processBtn.textContent = "Process refund queue";
  }
}

function renderResults(results) {
  resultsCard.style.display = "block";
  resultsList.innerHTML = "";

  results.forEach((r) => {
    const row = document.createElement("div");
    row.className = "member-row";

    const info = document.createElement("div");
    const nameEl = document.createElement("div");
    nameEl.className = "member-name";
    nameEl.textContent = r.original?.reference || r.original?.order || "Unknown order";

    const metaEl = document.createElement("div");
    metaEl.className = "member-meta";
    if (r.result === "success") {
      metaEl.append(`Refunded ${r.totalReturnDisplay}`);
    } else {
      metaEl.append(r.error?.order || r.error?.message || "Failed");
    }

    info.append(nameEl, metaEl);

    const badge = document.createElement("span");
    badge.className = `member-badge ${r.result === "success" ? "success" : "error"}`;
    badge.textContent = r.result === "success" ? "refunded" : "failed";

    row.append(info, badge);
    resultsList.appendChild(row);
  });
}

async function loadHistory() {
  renderLoading(historyList);
  try {
    const res = await fetch("/api/refunds");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load refund history");
    renderHistory(data.refunds || []);
  } catch (err) {
    renderMessage(historyList, err.message);
  }
}

function renderHistory(refunds) {
  if (refunds.length === 0) {
    renderMessage(historyList, "No refunds have been made yet.");
    return;
  }

  historyList.innerHTML = "";
  refunds.forEach((r) => {
    const row = document.createElement("div");
    row.className = "member-row";

    const info = document.createElement("div");
    const nameEl = document.createElement("div");
    nameEl.className = "member-name";
    nameEl.textContent = `${r.orderReference} - ${r.items}`;

    const metaEl = document.createElement("div");
    metaEl.className = "member-meta";
    metaEl.append(`${r.date} · ${r.amount} · ${r.reason || "No reason given"}`);
    if (r.note) metaEl.append(` · "${r.note}"`);

    info.append(nameEl, metaEl);
    row.appendChild(info);
    historyList.appendChild(row);
  });
}

refreshOrdersBtn.addEventListener("click", () => {
  page = 1;
  loadOrders();
});
statusFilter.addEventListener("change", () => {
  page = 1;
  loadOrders();
});
productFilter.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    page = 1;
    loadOrders();
  }
});
prevPageBtn.addEventListener("click", () => {
  if (page > 1) {
    page -= 1;
    loadOrders();
  }
});
nextPageBtn.addEventListener("click", () => {
  page += 1;
  loadOrders();
});
processBtn.addEventListener("click", processQueue);
refreshHistoryBtn.addEventListener("click", loadHistory);

loadOrders();
loadHistory();
