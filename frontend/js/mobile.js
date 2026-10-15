export function initMobileUI() {
  const root = document.documentElement;
  const mobile = window.matchMedia("(max-width: 760px)");
  const dialog = document.querySelector("#mobile-more-dialog");
  const toggle = document.querySelector("#mobile-more-toggle");
  const close = () => { if (dialog.open) dialog.close(); toggle.setAttribute("aria-expanded", "false"); };
  toggle.addEventListener("click", () => {
    dialog.showModal();
    toggle.setAttribute("aria-expanded", "true");
  });
  document.querySelector("#mobile-more-close").addEventListener("click", close);
  dialog.addEventListener("close", () => toggle.setAttribute("aria-expanded", "false"));
  dialog.addEventListener("click", event => {
    if (event.target.closest("a")) close();
    else if (event.target === dialog) {
      const bounds = dialog.getBoundingClientRect();
      if (event.clientY < bounds.top || event.clientY > bounds.bottom || event.clientX < bounds.left || event.clientX > bounds.right) close();
    }
  });
  const updateRoute = () => {
    const current = window.location.hash.slice(1);
    toggle.classList.toggle("active", ["my-aura", "progress", "arena"].includes(current));
    close();
  };
  document.addEventListener("auramaxx:routechange", updateRoute);
  updateRoute();

  const viewport = window.visualViewport;
  let fullHeight = window.innerHeight, lastWidth = window.innerWidth, lastHeight = 0, scheduled = 0;
  const updateViewport = () => {
    scheduled = 0;
    const height = viewport?.height || window.innerHeight;
    const editable = document.activeElement?.matches('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), [contenteditable="true"]');
    if (Math.abs(window.innerWidth - lastWidth) > 50) fullHeight = window.innerHeight;
    lastWidth = window.innerWidth;
    if (!editable) fullHeight = window.innerHeight;
    root.style.setProperty("--mobile-viewport-height", `${Math.round(height)}px`);
    const keyboard = mobile.matches && editable && (viewport?.scale || 1) < 1.1 && Math.max(fullHeight, window.innerHeight) - height > 120;
    const changed = root.dataset.mobileKeyboard !== String(Boolean(keyboard));
    root.dataset.mobileKeyboard = String(Boolean(keyboard));
    // Safari can keep the layout viewport full height while the keyboard shrinks
    // only the visual viewport. Leave enough document space to scroll above it.
    const inset = keyboard ? Math.max(0, window.innerHeight - height - (viewport?.offsetTop || 0)) : 0;
    root.style.setProperty("--mobile-keyboard-inset", `${Math.round(inset)}px`);
    if ((changed || height !== lastHeight) && keyboard && document.activeElement?.id === "chat-input") {
      requestAnimationFrame(() => {
        const form = document.querySelector("#chat-form");
        form?.scrollIntoView({ block: "end", behavior: "instant" });
        requestAnimationFrame(() => {
          if (root.dataset.mobileKeyboard !== "true" || !form) return;
          const overflow = form.getBoundingClientRect().bottom + 8 - ((viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight));
          if (overflow > 0) window.scrollBy({ top: overflow, behavior: "instant" });
        });
      });
    }
    lastHeight = height;
  };
  const schedule = () => { if (!scheduled) scheduled = requestAnimationFrame(updateViewport); };
  viewport?.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  document.addEventListener("focusin", schedule);
  document.addEventListener("focusout", schedule);
  mobile.addEventListener("change", () => { if (!mobile.matches) close(); schedule(); });
  updateViewport();
}
