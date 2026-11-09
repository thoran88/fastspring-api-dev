import express from "express";

const router = express.Router();

// The handful of products the navbar "Sample products" panel shows, for when
// someone needs to type a product path in by hand. Names and prices are
// read live from the store, so only the paths live here - if a path gets
// deleted in the dashboard it just drops out of the panel.
//
// Grouped by what you'd test with them, not by product type. The "managed"
// ones (interval "adhoc") are subscriptions the seller charges via the API
// rather than on a fixed schedule.
const GROUPS = [
  { title: "One-time", paths: ["prod-1", "prod-2", "prod-3"] },
  {
    title: "Subscriptions",
    paths: ["basic-newsletter", "premium-newsletter", "tnp-test-base-annual"],
  },
  { title: "Zero amount", paths: ["ibm-sub", "gym-as-you-go"] },
  {
    title: "High amount",
    paths: ["dreamtonics", "thrift-ticket", "archicad-solo-1m-monthly"],
  },
];

function displayName(product) {
  const d = product.display;
  return (typeof d === "string" ? d : d?.en) || product.product;
}

function shape(product) {
  const pricing = product.pricing || {};
  const price = pricing.price?.USD;
  const interval = pricing.interval || null;
  return {
    path: product.product,
    name: displayName(product),
    price: price != null ? Number(price) : null,
    // "adhoc" is an API-managed subscription with no fixed interval.
    interval,
    intervalLength: pricing.intervalLength || 1,
    trialDays: pricing.trial || null,
  };
}

router.get("/api/dev/sample-products", async (req, res) => {
  const wanted = [...new Set(GROUPS.flatMap((g) => g.paths))];
  try {
    const response = await fetch(`${req.fs.apiBase}/products/${wanted.join(",")}`, {
      headers: { Authorization: req.fs.auth },
    });
    const data = await response.json();
    if (!response.ok) {
      console.error("Sample products fetch failed", data);
      return res
        .status(502)
        .json({ error: "Failed to load sample products", details: data });
    }

    const byPath = new Map(
      (Array.isArray(data.products) ? data.products : [])
        .filter((p) => p && p.product)
        .map((p) => [p.product, shape(p)]),
    );
    res.json({
      store: req.fs.name,
      groups: GROUPS.map((g) => ({
        title: g.title,
        items: g.paths.map((p) => byPath.get(p)).filter(Boolean),
      })).filter((g) => g.items.length),
    });
  } catch (err) {
    console.error("Sample products error", err);
    res.status(500).json({ error: "Failed to load sample products" });
  }
});

export default router;
