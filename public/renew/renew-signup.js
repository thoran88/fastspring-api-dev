import { storeFetch, getManagedProducts, DEFAULT_PRODUCT, esc } from "./renew-api.js";

// Signup page for the popup-renew and embedded-renew storefronts. Same
// flow either way: pick the managed product, open checkout, and when the
// order comes back show the subscription it created. The admin page then
// renews it with POST /subscriptions/renew instead of /subscriptions/charge.

const MODE = document.body.dataset.mode; // "popup" | "embedded"
const productSelect = document.getElementById("product");
const startBtn = document.getElementById("start-btn");
const errorBanner = document.getElementById("error-banner");
const successBox = document.getElementById("signup-success");
const successDetail = document.getElementById("signup-success-detail");
const seenOrders = new Set();

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.style.display = "block";
}

async function loadProducts() {
  try {
    const products = await getManagedProducts();
    productSelect.innerHTML = products
      .map((p) => {
        const usd = p.price?.USD;
        const label = `${p.display || p.product}${usd ? ` ($${usd})` : " ($0)"}`;
        return `<option value="${esc(p.product)}">${esc(label)}</option>`;
      })
      .join("");
    if (products.some((p) => p.product === DEFAULT_PRODUCT)) {
      productSelect.value = DEFAULT_PRODUCT;
    }
  } catch (err) {
    productSelect.innerHTML = `<option value="${DEFAULT_PRODUCT}">${DEFAULT_PRODUCT}</option>`;
    showError(`Couldn't load products: ${err.message}`);
  }
}

function startCheckout() {
  errorBanner.style.display = "none";
  if (!window.fastspring?.builder) {
    showError("Storefront hasn't loaded yet, try again in a second.");
    return;
  }
  const email = document.getElementById("email").value.trim();
  const firstName = document.getElementById("fname").value.trim();
  const lastName = document.getElementById("lname").value.trim();

  const fs = window.fastspring.builder;
  fs.reset();
  if (email) fs.recognize({ email, firstName, lastName });
  fs.add(productSelect.value);
  fs.checkout();

  if (MODE === "embedded") {
    startBtn.style.display = "none";
  }
}

async function showOrder(orderId, fallbackRef) {
  if (!orderId || seenOrders.has(orderId)) return;
  seenOrders.add(orderId);
  successBox.style.display = "block";
  successDetail.innerHTML = `Order <code>${esc(fallbackRef || orderId)}</code>, looking up the subscription…`;

  try {
    const res = await storeFetch(`/api/renew/order/${encodeURIComponent(orderId)}`);
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || "Order lookup failed");
    const subs = d.subscriptions || [];
    successDetail.innerHTML =
      `Order <code>${esc(d.reference)}</code> · ${esc(d.total || "")} · paid with <code>${esc(d.paymentType || "unknown")}</code> · ` +
      `${d.completed ? "completed" : "awaiting payment"}<br>` +
      (subs.length
        ? `Subscription <code>${subs.map((s) => esc(s.subscription)).join(", ")}</code>. ` +
          `Renew it from the <a href="renew-admin.html">staff admin</a>.`
        : "No subscription on the order yet. If it's awaiting payment it shows up once paid.");
  } catch (err) {
    successDetail.textContent = `Order ${fallbackRef || orderId}: ${err.message}`;
  }
}

// Popup: fires when the popup closes. null if closed without an order.
window.renewPopupClosed = (ref) => {
  if (ref?.id) showOrder(ref.id, ref.reference);
};

// Popup and embedded: fires when the order completes in the checkout.
window.renewOrderReceived = (data) => {
  const order = Array.isArray(data) ? data[0] : data;
  const id = order?.id || order?.order;
  if (id) showOrder(id, order?.reference);
};

window.renewSblError = (code, message) => showError(`Checkout error ${code}: ${message}`);

startBtn.addEventListener("click", startCheckout);
loadProducts();
