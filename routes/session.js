import express from "express";
import { FASTSPRING_API_BASE, authHeader } from "../lib/fastspring.js";

const router = express.Router();

// Checkout Components sessions have to be created against this
// checkout-scoped v2 endpoint (not the generic /sessions one) - confirmed
// from a working reference implementation. Account/checkout match the
// checkoutUrl the frontend initializes the SDK with. Different checkouts
// have their own renewal/domain-whitelisting config, so each frontend flow
// (game store vs gym) passes its own checkoutPath rather than sharing one.
const FASTSPRING_ACCOUNT = "thoran";
const DEFAULT_CHECKOUT_PATH = "components-gaming";

// Session creation has to happen server-side - it's the one step that
// needs the store's API credentials, which must never reach the browser.
// The client only ever sees the resulting session id.
router.post("/api/session", async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    productPath,
    checkoutPath = DEFAULT_CHECKOUT_PATH,
    accountId,
  } = req.body ?? {};
  // email is intentionally optional - the cc-tester page creates sessions
  // with no email at all so fs-email can be the thing that actually
  // collects it (that only works when the session doesn't already have one
  // locked in - see public/cc-tester).
  if (!productPath) {
    return res.status(400).json({ error: "productPath is required" });
  }

  try {
    const response = await fetch(
      `${FASTSPRING_API_BASE}/v2/checkouts/${FASTSPRING_ACCOUNT}/${checkoutPath}/sessions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({
          locale: "en",
          country: "US",
          live: true,
          customer: {
            // Passing accountId attaches this new order to the buyer's
            // existing account (self-service add-on purchases) instead of
            // creating a second account for the same person.
            ...(accountId && { accountId }),
            billToContact: {
              ...(email && { email }),
              firstName,
              lastName,
            },
          },
          cart: {
            lineItems: [{ productPath, quantity: 1 }],
          },
        }),
      },
    );

    const data = await response.json();
    if (!response.ok) {
      console.error("Session creation failed", data);
      return res
        .status(502)
        .json({ error: "Failed to create session", details: data });
    }

    res.json(data);
  } catch (err) {
    console.error("Session creation error", err);
    res.status(500).json({ error: "Failed to create session" });
  }
});

export default router;
