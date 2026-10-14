import { api } from "../api.js";

function setApiStatus(state, label) {
  const status = document.querySelector("#api-status");
  status.dataset.state = state;
  document.querySelector("#api-status-label").textContent = label;
}

export async function initHome() {
  const dateLabel = new Intl.DateTimeFormat("vi-VN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
  document.querySelector("#today-label").textContent = dateLabel;
  document.querySelectorAll("[data-year]").forEach((node) => {
    node.textContent = String(new Date().getFullYear());
  });

  setApiStatus("loading", "Đang kết nối");
  try {
    const result = await api.health();
    if (result.status !== "ok" || result.database !== "ok") {
      throw new Error("Backend chưa sẵn sàng.");
    }
    setApiStatus("online", "API đang hoạt động");
  } catch {
    setApiStatus("offline", "API ngoại tuyến");
  }
}
