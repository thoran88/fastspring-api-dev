// Pure SBL Embedded Checkout - no backend session call involved. Clicking
// the button loads the real payment iframe into
// #fsc-embedded-checkout-container; FastSpring's own iframe shows the order
// confirmation inline once payment completes.
document.getElementById("reserve-btn").addEventListener("click", function () {
  this.disabled = true;
  this.textContent = "Loading…";
  fastspring.builder.reset();
  fastspring.builder.add("thrift-ticket");
  fastspring.builder.checkout();
});
