import express from "express";
import { FASTSPRING_API_BASE, authHeader, chunk } from "../lib/fastspring.js";

const router = express.Router();

// Any product tagged with this sku (case-sensitive, set in the dashboard)
// is treated as part of the storefront catalog - no path list to maintain.
const CATALOG_SKU = "GAME";

// Discovers the storefront catalog dynamically: list every product on the
// account, then keep only the ones tagged sku === "GAME" in the dashboard.
router.get("/api/products", async (req, res) => {
  try {
    const listResponse = await fetch(`${FASTSPRING_API_BASE}/products`, {
      headers: { Authorization: authHeader },
    });
    const listData = await listResponse.json();
    if (!listResponse.ok) {
      console.error("Product list fetch failed", listData);
      return res
        .status(502)
        .json({ error: "Failed to list products", details: listData });
    }

    const allPaths = Array.isArray(listData.products) ? listData.products : [];
    if (allPaths.length === 0) {
      return res.json({ products: [] });
    }

    const rawProducts = [];
    for (const batch of chunk(allPaths, 50)) {
      const detailResponse = await fetch(
        `${FASTSPRING_API_BASE}/products/${batch.join(",")}`,
        { headers: { Authorization: authHeader } },
      );
      const detailData = await detailResponse.json();
      if (!detailResponse.ok) {
        console.error("Product detail fetch failed", detailData);
        continue;
      }
      const items = Array.isArray(detailData.products)
        ? detailData.products
        : [detailData];
      rawProducts.push(...items);
    }

    const products = rawProducts
      .filter((p) => p && p.product && p.sku === CATALOG_SKU)
      .map((p) => ({
        productPath: p.product,
        display: typeof p.display === "string" ? p.display : p.display?.en,
        price:
          p.pricing?.price?.USD != null
            ? `$${Number(p.pricing.price.USD).toFixed(2)}`
            : null,
        image: p.image || null,
      }));

    res.json({ products });
  } catch (err) {
    console.error("Products fetch error", err);
    res.status(500).json({ error: "Failed to load products" });
  }
});

// Products CRUD admin tool - a separate, standalone piece from the
// storefront demos above. Wraps FastSpring's real /products endpoints
// directly (no SKU filtering, no catalog concept) so the admin UI can
// create, list, view, update, and delete any product on the account.
router.get("/api/admin/products", async (req, res) => {
  try {
    const listResponse = await fetch(`${FASTSPRING_API_BASE}/products`, {
      headers: { Authorization: authHeader },
    });
    const listData = await listResponse.json();
    if (!listResponse.ok) {
      console.error("Product list fetch failed", listData);
      return res
        .status(502)
        .json({ error: "Failed to list products", details: listData });
    }

    const allPaths = Array.isArray(listData.products) ? listData.products : [];
    if (allPaths.length === 0) {
      return res.json({ products: [] });
    }

    const products = [];
    for (const batch of chunk(allPaths, 50)) {
      const detailResponse = await fetch(
        `${FASTSPRING_API_BASE}/products/${batch.join(",")}`,
        { headers: { Authorization: authHeader } },
      );
      const detailData = await detailResponse.json();
      if (!detailResponse.ok) {
        console.error("Product detail fetch failed", detailData);
        continue;
      }
      const items = Array.isArray(detailData.products)
        ? detailData.products
        : [detailData];
      products.push(...items.filter((p) => p && p.product));
    }

    res.json({ products });
  } catch (err) {
    console.error("Admin products fetch error", err);
    res.status(500).json({ error: "Failed to load products" });
  }
});

router.get("/api/admin/products/:path", async (req, res) => {
  try {
    const response = await fetch(
      `${FASTSPRING_API_BASE}/products/${req.params.path}`,
      { headers: { Authorization: authHeader } },
    );
    const data = await response.json();
    if (!response.ok) {
      console.error("Product fetch failed", data);
      return res
        .status(502)
        .json({ error: "Failed to load product", details: data });
    }
    res.json(data);
  } catch (err) {
    console.error("Admin product fetch error", err);
    res.status(500).json({ error: "Failed to load product" });
  }
});

// Create and update share one endpoint on FastSpring's side - a product
// path that doesn't exist yet gets created, an existing one gets updated.
router.post("/api/admin/products", async (req, res) => {
  const product = req.body?.product;
  if (!product || !product.product) {
    return res
      .status(400)
      .json({ error: "product.product (the product path) is required" });
  }

  try {
    const response = await fetch(`${FASTSPRING_API_BASE}/products`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ products: [product] }),
    });
    const data = await response.json();
    const result = data.products?.[0];
    if (!response.ok || result?.result !== "success") {
      console.error("Product create/update failed", data);
      return res.status(502).json({
        error: "Failed to save product",
        details: result || data,
      });
    }
    res.json(result);
  } catch (err) {
    console.error("Admin product save error", err);
    res.status(500).json({ error: "Failed to save product" });
  }
});

router.delete("/api/admin/products/:path", async (req, res) => {
  try {
    const response = await fetch(
      `${FASTSPRING_API_BASE}/products/${req.params.path}`,
      { method: "DELETE", headers: { Authorization: authHeader } },
    );
    const data = await response.json();
    const result = data.products?.[0];
    if (!response.ok || result?.result !== "success") {
      console.error("Product delete failed", data);
      return res.status(502).json({
        error: "Failed to delete product",
        details: result || data,
      });
    }
    res.json(result);
  } catch (err) {
    console.error("Admin product delete error", err);
    res.status(500).json({ error: "Failed to delete product" });
  }
});

export default router;
