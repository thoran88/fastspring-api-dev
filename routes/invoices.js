import express from "express";
import { FASTSPRING_API_BASE, authHeader } from "../lib/fastspring.js";

const router = express.Router();

// Builds a payable invoice from a quote's own recipient/items rather than
// requiring the caller to re-type them - the two endpoints just happen to
// take compatible shapes, there's no server-side quote->invoice link.
router.post("/api/invoices", async (req, res) => {
  const {
    currencyCode,
    email,
    firstName,
    lastName,
    country,
    postalCode,
    invoiceItems,
    paymentMethod,
    mode,
  } = req.body ?? {};
  if (
    !currencyCode ||
    !email ||
    !firstName ||
    !lastName ||
    !country ||
    !postalCode ||
    !invoiceItems?.length
  ) {
    return res.status(400).json({
      error:
        "currencyCode, email, firstName, lastName, country, postalCode, and invoiceItems are required",
    });
  }

  const contact = { email, firstName, lastName };
  const address = { country, postalCode };

  try {
    const response = await fetch(
      `${FASTSPRING_API_BASE}/invoices/paymentInvoice`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({
          currencyCode,
          // FastSpring silently 500s with an empty response body if only
          // one contact type is sent - both billTo and deliverTo are
          // required even when it's the same person for both, and this
          // isn't mentioned anywhere in the docs. Confirmed by testing.
          contacts: [
            { contactType: "billTo", contact, address },
            { contactType: "deliverTo", contact, address },
          ],
          invoiceItems,
          paymentMethod: paymentMethod || "CARD",
          mode: mode || "TEST",
        }),
      },
    );

    // FastSpring returns a genuinely empty body on some failures (no JSON
    // at all), which throws if you call response.json() directly.
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      console.error("Invoice creation failed", response.status, data);
      return res.status(502).json({
        error:
          data?.message ||
          `Failed to create invoice (FastSpring returned ${response.status} with no details)`,
        details: data,
      });
    }
    res.json(data);
  } catch (err) {
    console.error("Invoice creation error", err);
    res.status(500).json({ error: "Failed to create invoice" });
  }
});

router.get("/api/invoices/:id", async (req, res) => {
  try {
    const response = await fetch(
      `${FASTSPRING_API_BASE}/invoices/${req.params.id}`,
      { headers: { Authorization: authHeader } },
    );
    const data = await response.json();
    if (!response.ok) {
      console.error("Invoice fetch failed", data);
      return res
        .status(502)
        .json({ error: "Failed to load invoice", details: data });
    }
    res.json(data);
  } catch (err) {
    console.error("Invoice fetch error", err);
    res.status(500).json({ error: "Failed to load invoice" });
  }
});

export default router;
