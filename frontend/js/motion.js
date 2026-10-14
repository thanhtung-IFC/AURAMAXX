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
  if (reducedMotion.matches || !("IntersectionObserver" in window)) return;

  const observed = new WeakSet();
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.08, rootMargin: "0px 0px -24px 0px" });

  const observeWithin = (root) => {
    if (!(root instanceof Element || root instanceof Document)) return;
    if (root instanceof Element && root.matches(REVEAL_SELECTOR)) observe(root);
    root.querySelectorAll(REVEAL_SELECTOR).forEach(observe);
  };

  const observe = (element) => {
    if (observed.has(element)) return;
    observed.add(element);
    element.classList.add("motion-reveal");
    observer.observe(element);
  };

  document.documentElement.classList.add("motion-ready");
  observeWithin(document);
  document.addEventListener("auramaxx:routechange", () => observeWithin(document));
  const mutations = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (node instanceof Element) observeWithin(node);
      });
    }
  });
  mutations.observe(document.querySelector("main") || document.body, { childList: true, subtree: true });
  reducedMotion.addEventListener?.("change", (event) => {
    if (event.matches) {
      mutations.disconnect();
      observer.disconnect();
      document.documentElement.classList.remove("motion-ready");
    }
  });
}
