const listEl = document.getElementById("products-list");
const refreshBtn = document.getElementById("refresh-btn");
const newOnetimeBtn = document.getElementById("new-onetime-btn");
const newSubscriptionBtn = document.getElementById("new-subscription-btn");

const modalBackdrop = document.getElementById("product-modal-backdrop");
const modal = modalBackdrop.querySelector(".product-modal");
const modalTitle = document.getElementById("product-modal-title");
const modalClose = document.getElementById("product-modal-close");
const form = document.getElementById("product-form");
const formError = document.getElementById("product-form-error");
const submitBtn = document.getElementById("product-form-submit");

const fields = {
  product: document.getElementById("f-product"),
  display: document.getElementById("f-display"),
  price: document.getElementById("f-price"),
  interval: document.getElementById("f-interval"),
  intervalLength: document.getElementById("f-interval-length"),
  sku: document.getElementById("f-sku"),
  badge: document.getElementById("f-badge"),
  rank: document.getElementById("f-rank"),
  image: document.getElementById("f-image"),
  format: document.getElementById("f-format"),
  taxcode: document.getElementById("f-taxcode"),
  descSummary: document.getElementById("f-desc-summary"),
  descAction: document.getElementById("f-desc-action"),
  descFull: document.getElementById("f-desc-full"),
  fulfillment: document.getElementById("f-fulfillment"),
  attributes: document.getElementById("f-attributes"),
  trial: document.getElementById("f-trial"),
  trialPrice: document.getElementById("f-trial-price"),
  paidTrial: document.getElementById("f-paid-trial"),
  qtyBehavior: document.getElementById("f-qty-behavior"),
  qtyDefault: document.getElementById("f-qty-default"),
  qtyDiscounts: document.getElementById("f-qty-discounts"),
  discountReason: document.getElementById("f-discount-reason"),
  discountDuration: document.getElementById("f-discount-duration"),
  reminderEnabled: document.getElementById("f-reminder-enabled"),
  reminderInterval: document.getElementById("f-reminder-interval"),
  reminderLength: document.getElementById("f-reminder-length"),
  overdueEnabled: document.getElementById("f-overdue-enabled"),
  overdueInterval: document.getElementById("f-overdue-interval"),
  overdueLength: document.getElementById("f-overdue-length"),
  cancellationInterval: document.getElementById("f-cancellation-interval"),
  cancellationLength: document.getElementById("f-cancellation-length"),
};

let editingPath = null; // null = creating

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

async function loadProducts() {
  renderLoading();
  try {
    const res = await fetch("/api/admin/products");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load products");
    renderProducts(data.products || []);
  } catch (err) {
    renderMessage(err.message);
  }
}

function priceText(p) {
  const usd = p.pricing?.price?.USD;
  return usd != null ? `$${Number(usd).toFixed(2)}` : "no price set";
}

function isSubscription(p) {
  return Boolean(p.pricing?.interval);
}

function renderProducts(products) {
  if (products.length === 0) {
    renderMessage("No products yet - create one above.");
    return;
  }

  listEl.innerHTML = "";
  products
    .slice()
    .sort((a, b) => a.product.localeCompare(b.product))
    .forEach((p) => {
      const row = document.createElement("div");
      row.className = "product-row";

      const info = document.createElement("div");
      const nameEl = document.createElement("div");
      nameEl.className = "product-name";
      const displayName =
        typeof p.display === "string" ? p.display : p.display?.en;
      nameEl.textContent = displayName || p.product;

      const metaEl = document.createElement("div");
      metaEl.className = "product-meta";
      const sub = isSubscription(p);
      metaEl.append(
        p.product,
        " · ",
        priceText(p),
        sub
          ? ` / ${p.pricing.intervalLength || 1} ${p.pricing.interval}`
          : "",
        " · ",
      );
      const badge = document.createElement("span");
      badge.className = "member-badge";
      badge.textContent = sub ? "subscription" : "one-time";
      metaEl.appendChild(badge);

      info.append(nameEl, metaEl);

      const actions = document.createElement("div");
      actions.className = "product-actions";

      const editBtn = document.createElement("button");
      editBtn.className = "buy-btn member-action-btn";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => openEditModal(p));

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "continue-btn member-action-btn";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", () => deleteProduct(p.product));

      actions.append(editBtn, deleteBtn);
      row.append(info, actions);
      listEl.appendChild(row);
    });
}

async function deleteProduct(path) {
  if (!confirm(`Delete product "${path}"? This can't be undone.`)) return;
  try {
    const res = await fetch(`/api/admin/products/${encodeURIComponent(path)}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Delete failed");
    loadProducts();
  } catch (err) {
    alert(err.message);
  }
}

function resetForm() {
  form.reset();
  formError.style.display = "none";
  formError.textContent = "";
  fields.product.disabled = false;
}

function setSubscriptionMode(isSub) {
  modal.classList.toggle("is-subscription", isSub);
}

function openCreateModal(type) {
  resetForm();
  editingPath = null;
  modalTitle.textContent =
    type === "subscription" ? "New subscription product" : "New one-time product";
  submitBtn.textContent = "Create product";
  setSubscriptionMode(type === "subscription");
  modalBackdrop.classList.add("open");
}

function jsonFieldToObject(field) {
  const val = field.value.trim();
  return val ? JSON.parse(val) : undefined;
}

function objectToJsonField(field, obj) {
  field.value = obj ? JSON.stringify(obj) : "";
}

function openEditModal(p) {
  resetForm();
  editingPath = p.product;
  const sub = isSubscription(p);
  modalTitle.textContent = `Edit ${p.product}`;
  submitBtn.textContent = "Save changes";
  setSubscriptionMode(sub);

  fields.product.value = p.product;
  fields.product.disabled = true;
  fields.display.value =
    typeof p.display === "string" ? p.display : p.display?.en || "";
  fields.price.value = p.pricing?.price?.USD ?? "";
  fields.interval.value = p.pricing?.interval || "month";
  fields.intervalLength.value = p.pricing?.intervalLength ?? 1;

  fields.sku.value = p.sku || "";
  fields.badge.value =
    typeof p.badge === "string" ? p.badge : p.badge?.en || "";
  fields.rank.value = p.rank ?? "";
  fields.image.value = p.image || "";
  fields.format.value = p.format || "";
  fields.taxcode.value = p.taxcode || "";

  fields.descSummary.value = p.description?.summary?.en || "";
  fields.descAction.value = p.description?.action?.en || "";
  fields.descFull.value = p.description?.full?.en || "";
  fields.fulfillment.value = p.fulfillment?.instructions?.en || "";
  objectToJsonField(fields.attributes, p.attributes);

  if (sub) {
    fields.trial.value = p.pricing?.trial ?? "";
    fields.trialPrice.value = p.pricing?.trialPrice?.USD ?? "";
    fields.paidTrial.checked = Boolean(p.pricing?.paidTrial);
    fields.qtyBehavior.value = p.pricing?.quantityBehavior || "";
    fields.qtyDefault.value = p.pricing?.quantityDefault ?? "";
    objectToJsonField(fields.qtyDiscounts, p.pricing?.quantityDiscounts);
    fields.discountReason.value = p.pricing?.discountReason?.en || "";
    fields.discountDuration.value = p.pricing?.discountDuration ?? "";

    const reminder = p.pricing?.reminderNotification;
    fields.reminderEnabled.checked = Boolean(reminder?.enabled);
    fields.reminderInterval.value = reminder?.interval || "";
    fields.reminderLength.value = reminder?.intervalLength ?? "";

    const overdue = p.pricing?.overdueNotification;
    fields.overdueEnabled.checked = Boolean(overdue?.enabled);
    fields.overdueInterval.value = overdue?.interval || "";
    fields.overdueLength.value = overdue?.intervalLength ?? "";

    const cancellation = p.pricing?.cancellation;
    fields.cancellationInterval.value = cancellation?.interval || "";
    fields.cancellationLength.value = cancellation?.intervalLength ?? "";
  }

  modalBackdrop.classList.add("open");
}

function closeModal() {
  modalBackdrop.classList.remove("open");
}

function buildProductPayload() {
  const isSub = modal.classList.contains("is-subscription");

  const product = {
    product: fields.product.value.trim(),
    display: { en: fields.display.value.trim() },
    pricing: {
      price: { USD: Number(fields.price.value) },
    },
  };

  if (fields.sku.value.trim()) product.sku = fields.sku.value.trim();
  if (fields.badge.value.trim())
    product.badge = { en: fields.badge.value.trim() };
  if (fields.rank.value.trim()) product.rank = Number(fields.rank.value);
  if (fields.image.value.trim()) product.image = fields.image.value.trim();
  if (fields.format.value.trim()) product.format = fields.format.value.trim();
  if (fields.taxcode.value) product.taxcode = fields.taxcode.value;

  const description = {};
  if (fields.descSummary.value.trim())
    description.summary = { en: fields.descSummary.value.trim() };
  if (fields.descAction.value.trim())
    description.action = { en: fields.descAction.value.trim() };
  if (fields.descFull.value.trim())
    description.full = { en: fields.descFull.value.trim() };
  if (Object.keys(description).length) product.description = description;

  if (fields.fulfillment.value.trim()) {
    product.fulfillment = {
      instructions: { en: fields.fulfillment.value.trim() },
    };
  }

  const attributes = jsonFieldToObject(fields.attributes);
  if (attributes) product.attributes = attributes;

  if (isSub) {
    product.pricing.interval = fields.interval.value;
    product.pricing.intervalLength = Number(fields.intervalLength.value) || 1;

    if (fields.trial.value.trim())
      product.pricing.trial = Number(fields.trial.value);
    if (fields.trialPrice.value.trim())
      product.pricing.trialPrice = { USD: Number(fields.trialPrice.value) };
    if (fields.paidTrial.checked) product.pricing.paidTrial = true;

    if (fields.qtyBehavior.value)
      product.pricing.quantityBehavior = fields.qtyBehavior.value;
    if (fields.qtyDefault.value.trim())
      product.pricing.quantityDefault = Number(fields.qtyDefault.value);

    const qtyDiscounts = jsonFieldToObject(fields.qtyDiscounts);
    if (qtyDiscounts) product.pricing.quantityDiscounts = qtyDiscounts;

    if (fields.discountReason.value.trim())
      product.pricing.discountReason = { en: fields.discountReason.value.trim() };
    if (fields.discountDuration.value.trim())
      product.pricing.discountDuration = Number(fields.discountDuration.value);

    if (fields.reminderEnabled.checked || fields.reminderInterval.value) {
      product.pricing.reminderNotification = {
        enabled: fields.reminderEnabled.checked,
        ...(fields.reminderInterval.value && {
          interval: fields.reminderInterval.value,
        }),
        ...(fields.reminderLength.value.trim() && {
          intervalLength: Number(fields.reminderLength.value),
        }),
      };
    }

    if (fields.overdueEnabled.checked || fields.overdueInterval.value) {
      product.pricing.overdueNotification = {
        enabled: fields.overdueEnabled.checked,
        ...(fields.overdueInterval.value && {
          interval: fields.overdueInterval.value,
        }),
        ...(fields.overdueLength.value.trim() && {
          intervalLength: Number(fields.overdueLength.value),
        }),
      };
    }

    if (fields.cancellationInterval.value) {
      product.pricing.cancellation = {
        interval: fields.cancellationInterval.value,
        ...(fields.cancellationLength.value.trim() && {
          intervalLength: Number(fields.cancellationLength.value),
        }),
      };
    }
  }

  return product;
}

async function submitForm(e) {
  e.preventDefault();
  formError.style.display = "none";
  formError.textContent = "";

  let product;
  try {
    product = buildProductPayload();
  } catch (err) {
    formError.textContent = `Invalid JSON in an advanced field: ${err.message}`;
    formError.style.display = "block";
    return;
  }

  submitBtn.disabled = true;
  const originalText = submitBtn.textContent;
  submitBtn.textContent = "Saving…";

  try {
    const res = await fetch("/api/admin/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Save failed");
    closeModal();
    loadProducts();
  } catch (err) {
    formError.textContent = err.message;
    formError.style.display = "block";
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

newOnetimeBtn.addEventListener("click", () => openCreateModal("onetime"));
newSubscriptionBtn.addEventListener("click", () => openCreateModal("subscription"));
modalClose.addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", (e) => {
  if (e.target === modalBackdrop) closeModal();
});
form.addEventListener("submit", submitForm);
refreshBtn.addEventListener("click", loadProducts);

loadProducts();
