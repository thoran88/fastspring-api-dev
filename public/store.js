import { sdk } from "./fs-sdk.js";

// Catalog is entirely dynamic - the backend returns every product
// tagged sku "GAME" in the dashboard, so nothing about the games
// themselves is hardcoded here. Glyph/gradient placeholders (used
// until a product has cover art) are derived deterministically from
// the product data itself, below.
const GRADIENTS = [
  ["#1f2b3d", "#0e131c"],
  ["#3a2a1f", "#14100c"],
  ["#3d1620", "#14090c"],
  ["#2e2a1a", "#100e08"],
  ["#1a2e28", "#081410"],
  ["#332216", "#120c07"],
  ["#301931", "#0f0810"],
  ["#1c2a1e", "#0a0f0a"],
  ["#243318", "#0d1208"],
  ["#1a2b33", "#081014"],
  ["#132a1d", "#070f0a"],
  ["#2b1a1a", "#100909"],
];

const STOPWORDS = new Set(["of", "the", "a", "an", "and", "&"]);

function glyphFor(title) {
  const initials = title
    .split(/\s+/)
    .filter((word) => word && !STOPWORDS.has(word.toLowerCase()))
    .map((word) => word[0].toUpperCase())
    .join("");
  return (initials || title.slice(0, 4).toUpperCase()).slice(0, 5);
}

function gradientFor(productPath) {
  let hash = 0;
  for (let i = 0; i < productPath.length; i++) {
    hash = (hash * 31 + productPath.charCodeAt(i)) >>> 0;
  }
  return GRADIENTS[hash % GRADIENTS.length];
}

async function loadCatalog() {
  const res = await fetch("/api/products");
  if (!res.ok) {
    throw new Error(`Failed to load products (${res.status})`);
  }
  const apiProducts = (await res.json()).products || [];

  return apiProducts.map((p) => {
    const title = p.display || p.productPath;
    return {
      productPath: p.productPath,
      title,
      price: p.price || "Price unavailable",
      image: p.image || null,
      glyph: glyphFor(title),
      gradient: gradientFor(p.productPath),
    };
  });
}

// Safe URL for use in a CSS url(...) value - only accept http(s).
function cssUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null;
    return `url(${JSON.stringify(url)})`;
  } catch {
    return null;
  }
}

function buildCoverEl(game, className) {
  const cover = document.createElement("div");
  cover.className = className;
  const safeImage = game.image && cssUrl(game.image);
  if (safeImage) {
    cover.classList.add("has-image");
    cover.style.backgroundImage = safeImage;
  } else {
    cover.style.background = `linear-gradient(160deg, ${game.gradient[0]}, ${game.gradient[1]})`;
  }
  return cover;
}

const grid = document.getElementById("game-grid");
let games = [];

function renderEmptyState(message) {
  grid.innerHTML = "";
  const empty = document.createElement("p");
  empty.className = "empty-state";
  empty.textContent = message;
  grid.appendChild(empty);
}

function renderLoading() {
  grid.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "grid-loading";
  const spinner = document.createElement("div");
  spinner.className = "spinner";
  wrap.appendChild(spinner);
  grid.appendChild(wrap);
}

function renderGrid() {
  if (games.length === 0) {
    renderEmptyState(
      'No games yet - add a product with sku "GAME" in the FastSpring dashboard to see it here.',
    );
    return;
  }
  grid.innerHTML = "";
  games.forEach((game, i) => {
    const card = document.createElement("div");
    card.className = "game-card";
    card.style.animationDelay = `${i * 40}ms`;

    const cover = buildCoverEl(game, "game-cover");
    const glyph = document.createElement("span");
    glyph.className = "glyph";
    glyph.textContent = game.glyph;
    const coverTitle = document.createElement("span");
    coverTitle.className = "cover-title";
    coverTitle.textContent = game.title;
    cover.append(glyph, coverTitle);

    const info = document.createElement("div");
    info.className = "game-info";

    const titleEl = document.createElement("div");
    titleEl.className = "game-title";
    titleEl.textContent = game.title;

    const priceEl = document.createElement("div");
    priceEl.className = "game-price";
    priceEl.textContent = game.price;

    const buyBtn = document.createElement("button");
    buyBtn.className = "buy-btn";
    buyBtn.textContent = "Buy now";
    buyBtn.addEventListener("click", () => openModal(game));

    info.append(titleEl, priceEl, buyBtn);
    card.append(cover, info);
    grid.appendChild(card);
  });
}

renderLoading();
loadCatalog()
  .then((loaded) => {
    games = loaded;
    renderGrid();
  })
  .catch((err) => {
    console.error("Could not load catalog", err);
    renderEmptyState("Couldn't load the catalog right now - please refresh.");
  });

const backdrop = document.getElementById("modal-backdrop");
const checkoutView = document.getElementById("checkout-view");
const successView = document.getElementById("success-view");
const errorBanner = document.getElementById("error-banner");
let currentGame = null;

function openModal(game) {
  currentGame = game;
  document.getElementById("modal-title").textContent = game.title;
  document.getElementById("modal-price").textContent = game.price;

  const now = new Date();
  const datePart =
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0");
  document.getElementById("email").value = `thoran+${datePart}@fastspring.com`;

  errorBanner.style.display = "none";
  successView.classList.remove("open");
  checkoutView.style.display = "block";
  backdrop.classList.add("open");
  startCheckoutSession();
}

function closeModal() {
  backdrop.classList.remove("open");
  currentGame = null;
}

document.getElementById("modal-close").addEventListener("click", closeModal);
backdrop.addEventListener("click", (e) => {
  if (e.target === backdrop) closeModal();
});
document
  .getElementById("continue-btn")
  .addEventListener("click", closeModal);

// The pay button lives inside fs-components.js's mounted fs-pay-button,
// so we create the session as soon as the modal opens rather than
// waiting on a separate in-modal button click.
async function startCheckoutSession() {
  if (!currentGame) return;
  errorBanner.style.display = "none";

  try {
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: document.getElementById("fname").value,
        lastName: document.getElementById("lname").value,
        email: document.getElementById("email").value,
        productPath: currentGame.productPath,
      }),
    });
    const data = await res.json();

    if (!data.id) {
      throw new Error(data.error || "Failed to create session");
    }

    sdk.checkout(data.id, {
      onSuccess: () => console.log("Session attached — checkout ready"),
      onError: (err) => showError(err?.message || "Checkout failed to load"),
    });
  } catch (err) {
    showError(err.message);
  }
}

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.style.display = "block";
}

window.addEventListener("fs:order-completed", (e) => {
  const order = e.detail || {};
  checkoutView.style.display = "none";
  successView.classList.add("open");
  document.getElementById("success-sub").textContent =
    `A confirmation email is on its way to ${document.getElementById("email").value}.`;
  document.getElementById("receipt").innerHTML = `
                <div><span>Game</span><span>${currentGame ? currentGame.title : ""}</span></div>
                <div><span>Order reference</span><span>${order.reference || order.id || "—"}</span></div>
                <div><span>Total</span><span>${order.total || (currentGame ? currentGame.price : "—")}</span></div>
            `;
});

window.addEventListener("fs:payment-failed", (e) => {
  showError(e.detail?.message || "Payment failed — please try again.");
});

// Switching theme tears down and recreates the mounted card/pay-button
// components (see fs-components.js), which drops any session they were
// attached to - reattach a fresh one if the checkout modal is open.
window.addEventListener("themechange", () => {
  if (backdrop.classList.contains("open") && currentGame) {
    startCheckoutSession();
  }
});
