const qName = document.getElementById("q-name");
const qFirst = document.getElementById("q-first");
const qLast = document.getElementById("q-last");
const qEmail = document.getElementById("q-email");
const qCountry = document.getElementById("q-country");
const qPostal = document.getElementById("q-postal");
const qProduct = document.getElementById("q-product");
const qQuantity = document.getElementById("q-quantity");
const qNotes = document.getElementById("q-notes");

const createQuoteBtn = document.getElementById("create-quote-btn");
const quoteError = document.getElementById("quote-error");
const quoteResult = document.getElementById("quote-result");
const quoteResultSummary = document.getElementById("quote-result-summary");
const quoteUrlLink = document.getElementById("quote-url-link");

const iFirst = document.getElementById("i-first");
const iLast = document.getElementById("i-last");
const iEmail = document.getElementById("i-email");
const iCountry = document.getElementById("i-country");
const iPostal = document.getElementById("i-postal");
const iProduct = document.getElementById("i-product");
const iQuantity = document.getElementById("i-quantity");
const iCurrency = document.getElementById("i-currency");
const iPaymentMethod = document.getElementById("i-payment-method");
const iMode = document.getElementById("i-mode");

const createInvoiceBtn = document.getElementById("create-invoice-btn");
const invoiceError = document.getElementById("invoice-error");
const invoiceResult = document.getElementById("invoice-result");
const invoiceResultSummary = document.getElementById("invoice-result-summary");
const invoicePayLink = document.getElementById("invoice-pay-link");
const invoiceWebLink = document.getElementById("invoice-web-link");
const invoicePdfLink = document.getElementById("invoice-pdf-link");

function showError(el, message) {
  el.textContent = message;
  el.style.display = "block";
}

async function createQuote() {
  quoteError.style.display = "none";

  const name = qName.value.trim();
  const first = qFirst.value.trim();
  const last = qLast.value.trim();
  const email = qEmail.value.trim();
  const country = qCountry.value.trim().toUpperCase();
  const postalCode = qPostal.value.trim();
  const product = qProduct.value.trim();
  const quantity = Number(qQuantity.value) || 1;

  if (!name || !first || !last || !email || !country || !postalCode || !product) {
    showError(quoteError, "Fill in the quote name, customer details, and product path.");
    return;
  }

  createQuoteBtn.disabled = true;
  createQuoteBtn.textContent = "Creating…";

  try {
    const res = await fetch("/api/quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        items: [{ product, quantity }],
        recipient: { email, first, last },
        recipientAddress: { country, postalCode },
        notes: qNotes.value.trim() || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to create quote");

    quoteResultSummary.textContent = `"${data.name}" - ${data.totalDisplay} - status ${data.status}`;
    quoteUrlLink.href = data.quoteUrl;
    quoteResult.style.display = "block";
  } catch (err) {
    showError(quoteError, err.message);
  } finally {
    createQuoteBtn.disabled = false;
    createQuoteBtn.textContent = "Create quote";
  }
}

async function createInvoice() {
  invoiceError.style.display = "none";

  const first = iFirst.value.trim();
  const last = iLast.value.trim();
  const email = iEmail.value.trim();
  const country = iCountry.value.trim().toUpperCase();
  const postalCode = iPostal.value.trim();
  const product = iProduct.value.trim();
  const quantity = Number(iQuantity.value) || 1;

  if (!first || !last || !email || !country || !postalCode || !product) {
    showError(invoiceError, "Fill in the customer details and product path.");
    return;
  }

  createInvoiceBtn.disabled = true;
  createInvoiceBtn.textContent = "Creating…";

  try {
    const res = await fetch("/api/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currencyCode: iCurrency.value,
        email,
        firstName: first,
        lastName: last,
        country,
        postalCode,
        invoiceItems: [
          { productPath: product, quantity, useCatalogPricing: true },
        ],
        paymentMethod: iPaymentMethod.value,
        mode: iMode.value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to create invoice");

    invoiceResultSummary.textContent = `Invoice ${data.id} - status ${data.status}`;
    invoicePayLink.href = data.paymentInvoiceWebPayLink;
    invoiceWebLink.href = data.paymentInvoiceWebLink;
    invoicePdfLink.href = data.paymentInvoicePdfLink;
    invoiceResult.style.display = "block";
  } catch (err) {
    showError(invoiceError, err.message);
  } finally {
    createInvoiceBtn.disabled = false;
    createInvoiceBtn.textContent = "Create invoice";
  }
}

createQuoteBtn.addEventListener("click", createQuote);
createInvoiceBtn.addEventListener("click", createInvoice);
