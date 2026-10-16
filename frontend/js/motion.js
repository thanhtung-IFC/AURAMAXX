const REVEAL_SELECTOR = [
  ".page-heading-row",
  ".feature-card",
  ".bottom-grid > *",
  ".health-intro-grid > *",
  ".habit-card",
  ".chat-layout > *",
  ".progress-empty-panel",
  ".profile-layout > *",
  ".face-camera-panel",
  ".face-result-panel",
  ".face-how-panel",
  ".face-profile-overview > article",
  ".face-score-row",
].join(",");

export function initMotion() {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (!("IntersectionObserver" in window)) return;
  const root = document.documentElement;
  const queued = new Set();
  const tracked = new Set();
  let scope = null, frame = 0;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting || !tracked.has(entry.target) || !scope?.contains(entry.target)) continue;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
      tracked.delete(entry.target);
    }
  }, { threshold: 0, rootMargin: "0px 0px 72px 0px" });

  const observe = element => {
    if (element.classList.contains("is-visible") || tracked.has(element) || element.closest("[hidden]")) return;
    element.classList.add("motion-reveal");
    tracked.add(element);
    observer.observe(element);
  };
  const observeWithin = node => {
    if (!scope?.contains(node)) return;
    if (node.matches(REVEAL_SELECTOR)) observe(node);
    node.querySelectorAll(REVEAL_SELECTOR).forEach(observe);
  };
  const flush = () => {
    frame = 0;
    // Large renders often add both a container and its descendants in one batch.
    const nodes = new Set(queued); queued.clear();
    for (const node of nodes) {
      let parent = node.parentElement;
      while (parent && !nodes.has(parent)) parent = parent.parentElement;
      if (!parent) observeWithin(node);
    }
    for (const element of tracked) if (!scope?.contains(element)) { observer.unobserve(element); tracked.delete(element); }
  };
  const mutations = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) if (node instanceof Element) queued.add(node);
      // Content can become visible without adding nodes (for example a report).
      if (record.type === "attributes" && !record.target.hidden) queued.add(record.target);
    }
    if ((queued.size || tracked.size) && !frame) frame = requestAnimationFrame(flush);
  });
  const refresh = () => {
    mutations.disconnect(); observer.disconnect(); tracked.clear(); queued.clear();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    const enabled = !document.hidden && !reducedMotion.matches && root.dataset.reducedMotion !== "true" && root.dataset.performanceTier !== "economy";
    root.classList.toggle("motion-ready", enabled);
    scope = enabled ? document.querySelector('[data-page]:not([hidden])') : null;
    if (!scope) return;
    observeWithin(scope);
    mutations.observe(scope, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
  };
  document.addEventListener("auramaxx:routechange", refresh);
  document.addEventListener("visibilitychange", refresh);
  window.addEventListener("auramaxx:appearance-changed", refresh);
  window.addEventListener("auramaxx:performance-tier", refresh);
  reducedMotion.addEventListener?.("change", refresh);
  refresh();
}
