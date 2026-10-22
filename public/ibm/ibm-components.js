import { ibmFetch } from "./ibm-store.js";
import { sdk } from "./fs-sdk-ibm.js";

// Checkout Components on the tariqh store (product hcp-pay-as-you-go).
// This is an "add your payment method" screen inside a logged-in app, so
// there's no form or Continue button: the session is created on page load
// with what the app already knows about the user, and the components render
// straight away.
const PRODUCT_PATH = "hcp-pay-as-you-go";
const CHECKOUT_PATH = "components-ibm";
// Buyer country for the session. IE means the checkout prices in EUR.
const COUNTRY = "IE";

// Stand-in for the logged-in IBM user. In a real integration this comes
// from IBM's own session server-side. Override per test with query params,
// e.g. ibm-components.html?email=jane@example.com&first=Jane&last=Doe
// With no email, fs-email is left editable so the buyer types it in.
const params = new URLSearchParams(window.location.search);
const currentUser = {
  firstName: params.get("first") || "Test",
  lastName: params.get("last") || "Buyer",
  email: params.get("email") || undefined,
};

const authorizeView = document.getElementById("authorize-view");
const authorizeSuccess = document.getElementById("authorize-success");
const authorizeSuccessDetail = document.getElementById(
  "authorize-success-detail",
);
const errorBanner = document.getElementById("error-banner");
const componentsWrap = document.getElementById("components-wrap");

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.style.display = "block";
}

async function startCheckout() {
  errorBanner.style.display = "none";

  try {
    const res = await ibmFetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...currentUser,
        productPath: PRODUCT_PATH,
        checkoutPath: CHECKOUT_PATH,
        country: COUNTRY,
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
      },
      onError: (err) => {
        componentsWrap.style.display = "none";
        showError(err?.message || "Checkout failed to load. Refresh to try again.");
      },
    });
  } catch (err) {
    componentsWrap.style.display = "none";
    showError(`${err.message}. Refresh to try again.`);
  }
}

startCheckout();

window.addEventListener("fs:order-completed", (e) => {
  console.log("Order completed - raw payload for reference:", e.detail);

  authorizeView.style.display = "none";
  authorizeSuccess.style.display = "block";
  authorizeSuccessDetail.textContent =
    "Your card is saved. You'll be billed on the 1st of each month for the prior month's usage.";
});

window.addEventListener("fs:payment-failed", (e) => {
  showError(e.detail?.message || "Payment failed - please try again.");
});
