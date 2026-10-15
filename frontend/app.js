import { initRouter } from "./js/router.js";
import { showToast } from "./js/ui.js";
import { initHome } from "./js/pages/home.js";
import { initFaceLab } from "./js/pages/face-lab.js";
import { initMyAura } from "./js/pages/my-aura.js";
import { initHealthHub } from "./js/pages/health-hub.js";
import { initProgress } from "./js/pages/progress.js";
import { initAuraAI } from "./js/pages/aura-ai.js";
import { initTheme } from "./js/theme.js";
import { initMotion } from "./js/motion.js";
import { initArena } from "./js/pages/arena.js";
import { initMobileUI } from "./js/mobile.js";

initTheme();
initRouter();
initMobileUI();
initFaceLab();
initHome();
initMyAura();
initHealthHub();
initProgress();
initAuraAI();
initArena();
initMotion();

const featureRoutes = {"face-lab": "face_analysis", "health-hub": "health_tracking", progress: "health_tracking", "aura-ai": "aura_ai", arena: "arena"};
fetch("/api/features", {credentials: "include"}).then(response => response.ok ? response.json() : null).then(payload => {
  if (!payload?.features) return;
  document.querySelectorAll("[data-nav]").forEach(link => {
    const feature = featureRoutes[link.dataset.nav];
    if (feature && payload.features[feature] === false) link.hidden = true;
  });
  document.addEventListener("auramaxx:routechange", event => {
    const feature = featureRoutes[event.detail.route];
    if (feature && payload.features[feature] === false) {
      window.location.hash = "home";
      showToast("Tính năng này hiện đã được quản trị viên tạm dừng.");
    }
  });
  const activeFeature = featureRoutes[window.location.hash.slice(1)];
  if (activeFeature && payload.features[activeFeature] === false) window.location.hash = "home";
}).catch(() => {});

document.querySelector(".notification-button").addEventListener("click", () => {
  showToast("Bạn chưa có thông báo mới.");
});
