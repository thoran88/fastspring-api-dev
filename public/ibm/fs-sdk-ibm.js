// Checkout Components SDK for the IBM demo. Points at the tariqh store's
// components-ibm checkout on production, so no `env` override here (the
// other demos pass env: "qa2" because they run against the QA2 thoran store).
export const sdk = FastSpring.init({
  checkoutUrl: "https://tariqh.test.onfastspring.com/components-ibm",

  onSessionLoaded: (data) => {
    console.log("Session loaded:", data);
  },

  onOrderCompleted: (data) => {
    console.log("Order completed!", data);
    window.dispatchEvent(
      new CustomEvent("fs:order-completed", { detail: data }),
    );
  },

  onPaymentFailed: (error) => {
    console.error("Payment failed:", error);
    window.dispatchEvent(
      new CustomEvent("fs:payment-failed", { detail: error }),
    );
  },
});
