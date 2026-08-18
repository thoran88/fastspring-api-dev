import { mountComponents } from "./fs-components.js";

const STORAGE_KEY = "nova-theme";
// Header button plus the one mirrored inside the checkout modal - same
// toggle, same handler, so flipping either re-themes both the page and the
// already-mounted components without closing the modal.
const toggleBtns = document.querySelectorAll(".theme-toggle");

function currentTheme() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function applyToggleLabel(theme) {
  toggleBtns.forEach((btn) => {
    btn.textContent = theme === "light" ? "🌙" : "☀️";
    btn.setAttribute(
      "aria-label",
      theme === "light" ? "Switch to dark mode" : "Switch to light mode",
    );
  });
}

applyToggleLabel(currentTheme());

toggleBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const next = currentTheme() === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    localStorage.setItem(STORAGE_KEY, next);
    applyToggleLabel(next);
    mountComponents(next);
    window.dispatchEvent(new CustomEvent("themechange", { detail: next }));
  });
});
