const STORAGE_KEY = "auramaxx-theme";

export function initTheme() {
  const root = document.documentElement;
  const toggle = document.querySelector("#theme-toggle");
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (!toggle) return;

  let savedTheme = "dark";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") savedTheme = stored;
  } catch {
    // Private browsing settings may disable local storage; theme still works in memory.
  }

  const applyTheme = (theme) => {
    root.dataset.theme = theme;
    window.dispatchEvent(new CustomEvent("auramaxx:theme-changed", { detail: { theme } }));
    if (themeColor) themeColor.content = theme === "light" ? "#f4f5f9" : "#100d1d";
    const nextTheme = theme === "dark" ? "light" : "dark";
    toggle.setAttribute("aria-label", `Chuyển sang giao diện ${nextTheme === "light" ? "sáng" : "tối"}`);
    toggle.setAttribute("aria-pressed", String(theme === "light"));
    toggle.title = `Chuyển sang giao diện ${nextTheme === "light" ? "sáng" : "tối"}`;
  };

  applyTheme(savedTheme);
  toggle.addEventListener("click", () => {
    const theme = root.dataset.theme === "light" ? "dark" : "light";
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Keep the selected theme for this page even if it cannot be persisted.
    }
  });
}
