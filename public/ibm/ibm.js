// Pure SBL Embedded Checkout - no backend session call involved, unlike the
// FlexFit/Payment Components integration. Loads immediately on page load
// (matching a real "Add payment method" settings screen) rather than sitting
// behind a click, since there's nothing to configure first: ibm-sub is a $0
// Managed Subscription, so this just authorizes billing.
fastspring.builder.reset();
fastspring.builder.add("ibm-sub");
fastspring.builder.checkout();

// This file loads as a module, so a plain function declaration stays
// module-scoped - SBL looks up data-data-callback as a window global, so it
// has to be assigned explicitly.
window.dataCallback = function (data) {
  console.log(JSON.stringify(data, null, 4));
};
