// The admin panel has no mounted checkout components to re-theme, so this
// just flips the CSS variables via [data-theme] - no SDK involved at all,
// unlike theme.js / theme-gym.js which also re-mount payment components.
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
});
