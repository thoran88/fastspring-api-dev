export const sdk = FastSpring.init({
  checkoutUrl: "https://thoran.test.qa2.onfastspring.com/components-gym",
  env: "qa2",

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
