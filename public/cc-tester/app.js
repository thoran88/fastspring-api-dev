import { sdk } from "./fs-sdk.js";

const setupView = document.getElementById("setup-view");
const componentsWrap = document.getElementById("components-wrap");
const successView = document.getElementById("success-view");
const errorBanner = document.getElementById("error-banner");
const createSessionBtn = document.getElementById("create-session-btn");

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.style.display = "block";
}

createSessionBtn.addEventListener("click", async () => {
  errorBanner.style.display = "none";
  createSessionBtn.disabled = true;
  createSessionBtn.textContent = "Loading…";

  try {
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: document.getElementById("fname").value,
        lastName: document.getElementById("lname").value,
        productPath: document.getElementById("product-path").value,
        checkoutPath: "components-cctester",
        // no email - intentionally left out, see fs-components.js
      }),
    });
    const data = await res.json();

    if (!data.id) {
      throw new Error(data.error || "Failed to create session");
    }

    sdk.checkout(data.id, {
      onSuccess: () => {
        console.log("Session attached — components ready");
        setupView.style.display = "none";
        componentsWrap.style.display = "block";
      },
      onError: (err) => showError(err?.message || "Checkout failed to load"),
    });
  } catch (err) {
    showError(err.message);
    createSessionBtn.disabled = false;
    createSessionBtn.textContent = "Create session";
  }
});

window.addEventListener("fs:order-completed", (e) => {
  componentsWrap.style.display = "none";
  successView.style.display = "block";
  document.getElementById("success-detail").textContent = JSON.stringify(
    e.detail,
    null,
    2,
  );
});

window.addEventListener("fs:payment-failed", (e) => {
  showError(e.detail?.message || "Payment failed — please try again.");
});
