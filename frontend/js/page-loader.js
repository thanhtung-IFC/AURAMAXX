// Load feature code only when its page is opened. Keep one initialization per page.
const PAGES = {
  "face-lab": { load: () => import("./pages/face-lab-native.js"), init: "initFaceLab" },
  arena: { load: () => import("./pages/arena.js"), init: "initArena" },
  "health-hub": { load: () => import("./pages/health-hub.js"), init: "initHealthHub" },
  progress: { load: () => import("./pages/progress.js"), init: "initProgress" },
  "aura-ai": { load: () => import("./pages/aura-ai.js"), init: "initAuraAI" },
};
const initialized = new Map();
const pending = new Map();
let promptVersion = 0;

async function loadPage(route) {
  const config = PAGES[route];
  if (!config) return null;
  if (initialized.has(route)) return initialized.get(route);
  if (pending.has(route)) return pending.get(route);
  const page = document.querySelector(`[data-page="${route}"]`);
  page.querySelector(":scope > .page-load-status")?.remove();
  page.setAttribute("aria-busy", "true");
  const notice = document.createElement("div");
  notice.className = "page-load-status panel";
  notice.setAttribute("role", "status");
  notice.textContent = "Đang tải…";
  page.prepend(notice);
  const task = config.load().then(module => {
    // Navigation may have changed while the module was downloading.
    if (window.location.hash.slice(1) !== route) return null;
    notice.remove();
    module[config.init]();
    initialized.set(route, module);
    return module;
  }).catch(() => {
    if (window.location.hash.slice(1) !== route) { notice.remove(); return null; }
    notice.textContent = "Chưa tải được trang. Kiểm tra kết nối rồi thử lại. ";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "button button-outline";
    retry.textContent = "Tải lại trang";
    // Browsers can cache a failed module import for the lifetime of the document.
    retry.addEventListener("click", () => window.location.reload(), { once: true });
    notice.append(retry);
    return null;
  }).finally(() => {
    page.removeAttribute("aria-busy");
    if (window.location.hash.slice(1) !== route) notice.remove();
    pending.delete(route);
  });
  pending.set(route, task);
  return task;
}

export function initPageLoader() {
  document.addEventListener("auramaxx:routechange", event => { void loadPage(event.detail.route); });
  // Face Lab can send a prompt before Aura AI has ever been opened.
  window.addEventListener("auramaxx:ai-request", async event => {
    const version = ++promptVersion;
    const { message, attach } = event.detail;
    window.location.hash = "aura-ai";
    const module = await loadPage("aura-ai");
    if (module && version === promptVersion && window.location.hash === "#aura-ai") module.prepareAuraPrompt(message, attach);
  });
}
