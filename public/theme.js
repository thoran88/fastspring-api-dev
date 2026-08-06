import { mountComponents } from "./fs-components.js";

const STORAGE_KEY = "nova-theme";
const toggleBtn = document.getElementById("theme-toggle");

function currentTheme() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function applyToggleLabel(theme) {
  toggleBtn.textContent = theme === "light" ? "🌙" : "☀️";
  toggleBtn.setAttribute(
    "aria-label",
    theme === "light" ? "Switch to dark mode" : "Switch to light mode",
  );
}

applyToggleLabel(currentTheme());

toggleBtn.addEventListener("click", () => {
  const next = currentTheme() === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  localStorage.setItem(STORAGE_KEY, next);
  applyToggleLabel(next);
  mountComponents(next);
  window.dispatchEvent(new CustomEvent("themechange", { detail: next }));
});
