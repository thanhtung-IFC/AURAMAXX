const PAGES = {
  home: "Tổng quan",
  "face-lab": "Face Lab",
  "health-hub": "Health Hub",
  "aura-ai": "Aura AI",
  progress: "Tiến trình",
  arena: "Face Arena",
  "my-aura": "My Aura",
};
let currentRoute = null;

function getRoute() {
  const route = window.location.hash.slice(1);
  return Object.hasOwn(PAGES, route) ? route : "home";
}

function renderRoute() {
  const selected = getRoute();
  if (selected === currentRoute) return;
  currentRoute = selected;

  document.querySelectorAll("[data-page]").forEach((page) => {
    page.hidden = page.dataset.page !== selected;
  });

  document.querySelectorAll("[data-nav]").forEach((link) => {
    const isCurrent = link.dataset.nav === selected;
    link.classList.toggle("active", isCurrent);
    if (isCurrent) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  document.querySelector("#page-breadcrumb").textContent = PAGES[selected];
  document.title = `${PAGES[selected]} · AURAMAXX`;
  // Reset before painting the new page; animating a scroll across different
  // page heights competes with its entrance and can show the wrong section.
  window.scrollTo({ top: 0, behavior: "instant" });
  document.dispatchEvent(new CustomEvent("auramaxx:routechange", { detail: { route: selected } }));
}

export function initRouter() {
  document.addEventListener("click", (event) => {
    const routeButton = event.target.closest("[data-go]");
    if (routeButton) window.location.hash = routeButton.dataset.go;
  });
  window.addEventListener("hashchange", renderRoute);
  renderRoute();
}
