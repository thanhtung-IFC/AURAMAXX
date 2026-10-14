export function showToast(message, type = "info") {
  const region = document.querySelector("#toast-region");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  while (region.children.length >= 2) region.firstElementChild.remove();
  region.append(toast);
  window.setTimeout(() => toast.remove(), 4200);
}
