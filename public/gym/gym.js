import { sdk } from "./fs-sdk-gym.js";

const PRODUCT_PATH = "gym-as-you-go";
const CHECKOUT_PATH = "components-gym";

const authorizeView = document.getElementById("authorize-view");
const authorizeSuccess = document.getElementById("authorize-success");
const authorizeSuccessDetail = document.getElementById(
  "authorize-success-detail",
);
const errorBanner = document.getElementById("error-banner");
const componentsWrap = document.getElementById("components-wrap");
const continueBtn = document.getElementById("continue-btn");
const emailInput = document.getElementById("email");

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.style.display = "block";
}

async function startAuthorization() {
  errorBanner.style.display = "none";

  const email = emailInput.value.trim();
  if (!email) {
    showError("Enter an email address to continue.");
    return;
  }

  continueBtn.disabled = true;
  continueBtn.textContent = "Loading…";
  componentsWrap.style.display = "block";

  try {
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: document.getElementById("fname").value,
        lastName: document.getElementById("lname").value,
        email,
        productPath: PRODUCT_PATH,
        checkoutPath: CHECKOUT_PATH,
      }),
    });
    const data = await res.json();

    if (!data.id) {
      throw new Error(data.error || "Failed to create session");
    }

    sdk.checkout(data.id, {
      onSuccess: () => {
        console.log("Session attached — checkout ready");
        componentsWrap.classList.remove("is-loading");
        continueBtn.style.display = "none";
      },
      onError: (err) => showError(err?.message || "Checkout failed to load"),
    });
  } catch (err) {
    showError(err.message);
    componentsWrap.style.display = "none";
    continueBtn.disabled = false;
    continueBtn.textContent = "Continue to payment";
  }
}

continueBtn.addEventListener("click", startAuthorization);
emailInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") startAuthorization();
});

// FastSpring's order.completed payload (what onOrderCompleted mirrors)
// doesn't document a subscription ID field - it's only reliably available
// server-side via the subscription.activated webhook (payload.id). So this
// just points at where to actually find it, rather than guessing a field
// that isn't documented to exist.
window.addEventListener("fs:order-completed", (e) => {
  console.log("Order completed - raw payload for reference:", e.detail);

  authorizeView.style.display = "none";
  authorizeSuccess.style.display = "block";
  authorizeSuccessDetail.innerHTML =
    'You\'re all set. Staff can find and charge this membership from the <a href="gym-admin.html">admin panel</a>.';
});

window.addEventListener("fs:payment-failed", (e) => {
  showError(e.detail?.message || "Payment failed — please try again.");
});
