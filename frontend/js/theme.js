const STORAGE_KEY = "auramaxx-theme";
const MOTION_KEY = "auramaxx-reduce-motion";
let preference = "dark";
let reduceMotion = false;
let systemTheme;
let systemMotion;

export function getAppearance() {
  return { theme: preference, reduceMotion };
}

function applyAppearance() {
  const root = document.documentElement;
  const theme = preference === "system" ? (systemTheme?.matches ? "dark" : "light") : preference;
  root.dataset.theme = theme;
  root.dataset.reducedMotion = String(reduceMotion || Boolean(systemMotion?.matches));
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = theme === "light" ? "#f6f6f3" : "#111315";
  const toggle = document.querySelector("#theme-toggle");
  if (toggle) {
    const label = `Chuyển sang giao diện ${theme === "dark" ? "sáng" : "tối"}`;
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("aria-pressed", String(theme === "light"));
    toggle.title = label;
  }
  window.dispatchEvent(new CustomEvent("auramaxx:theme-changed", { detail: { theme } }));
  window.dispatchEvent(new CustomEvent("auramaxx:appearance-changed", { detail: getAppearance() }));
}

export function setTheme(theme) {
  if (!["dark", "light", "system"].includes(theme)) return;
  preference = theme;
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* Use the preference for this page. */ }
  applyAppearance();
}

export function setReducedMotion(value) {
  reduceMotion = Boolean(value);
  try { localStorage.setItem(MOTION_KEY, String(reduceMotion)); } catch { /* Use the preference for this page. */ }
  applyAppearance();
}

export function initTheme() {
  systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  systemMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (["dark", "light", "system"].includes(stored)) preference = stored;
    reduceMotion = localStorage.getItem(MOTION_KEY) === "true";
  } catch { /* Storage may be unavailable in private browsing. */ }
  applyAppearance();
  systemTheme.addEventListener?.("change", applyAppearance);
  systemMotion.addEventListener?.("change", applyAppearance);
  document.querySelector("#theme-toggle")?.addEventListener("click", () => {
    setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
  });
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) preference = ["dark", "light", "system"].includes(event.newValue) ? event.newValue : "dark";
    else if (event.key === MOTION_KEY) reduceMotion = event.newValue === "true";
    else if (event.key === null) { preference = "dark"; reduceMotion = false; }
    else return;
    applyAppearance();
  });
}
