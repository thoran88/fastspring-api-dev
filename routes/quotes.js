import express from "express";
import { FASTSPRING_API_BASE, authHeader } from "../lib/fastspring.js";

const router = express.Router();

// Quotes & Invoices - a standalone B2B flow, unrelated to the storefront
// demos above. A quote is just a proposal (no payment mechanism of its
// own); turning it into something a customer can actually pay means
// separately creating an invoice from the quote's own recipient/items,
// since POST /invoices doesn't take a quoteId - it's a fully independent
// endpoint that happens to accept the same shape of data.
router.post("/api/quotes", async (req, res) => {
  const { name, items, recipient, recipientAddress, notes } = req.body ?? {};
  if (!name || !items?.length || !recipient || !recipientAddress) {
    return res.status(400).json({
      error: "name, items, recipient, and recipientAddress are required",
    });
  }

  try {
    const response = await fetch(`${FASTSPRING_API_BASE}/quotes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ name, items, recipient, recipientAddress, notes }),
    });
    const data = await response.json();
    if (!response.ok) {
      console.error("Quote creation failed", data);
      return res
        .status(502)
        .json({ error: "Failed to create quote", details: data });
    }
    res.json(data);
  } catch (err) {
    console.error("Quote creation error", err);
    res.status(500).json({ error: "Failed to create quote" });
  }
});

router.get("/api/quotes", async (req, res) => {
  try {
    const response = await fetch(`${FASTSPRING_API_BASE}/quotes`, {
      headers: { Authorization: authHeader },
    });
    const data = await response.json();
    if (!response.ok) {
      console.error("Quote list failed", data);
      return res
        .status(502)
        .json({ error: "Failed to list quotes", details: data });
    }
    res.json(data);
  } catch (err) {
    console.error("Quote list error", err);
    res.status(500).json({ error: "Failed to list quotes" });
  }
});

router.get("/api/quotes/:id", async (req, res) => {
  try {
    const response = await fetch(
      `${FASTSPRING_API_BASE}/quotes/${req.params.id}`,
      { headers: { Authorization: authHeader } },
    );
    const data = await response.json();
    if (!response.ok) {
      console.error("Quote fetch failed", data);
      return res
        .status(502)
        .json({ error: "Failed to load quote", details: data });
    }
    res.json(data);
  } catch (err) {
    console.error("Quote fetch error", err);
    res.status(500).json({ error: "Failed to load quote" });
  }
});

export default router;
