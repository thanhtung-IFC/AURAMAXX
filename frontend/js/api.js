// Tất cả yêu cầu HTTP đi qua tệp này để dễ thay địa chỉ API khi triển khai.
const configuredBase = window.AURAMAXX_API_BASE || window.location.origin;
const API_BASE = configuredBase.replace(/\/$/, "");

export async function apiRequest(path, options = {}) {
  const { timeout = 30000, signal: externalSignal, ...requestOptions } = options;
  const controller = new AbortController();
  const cancel = () => controller.abort(externalSignal.reason);
  if (externalSignal?.aborted) cancel();
  else externalSignal?.addEventListener("abort", cancel, { once: true });
  const timer = window.setTimeout(() => controller.abort(), timeout);
  const headers = new Headers(options.headers || {});
  const method = (requestOptions.method || "GET").toUpperCase();

  if (requestOptions.body && !(requestOptions.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrfToken = document.cookie
      .split("; ")
      .find((part) => part.startsWith("auramaxx_csrf="))
      ?.split("=")
      .slice(1)
      .join("=");
    if (csrfToken) headers.set("X-CSRF-Token", decodeURIComponent(csrfToken));
  }

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...requestOptions,
      headers,
      signal: controller.signal,
      credentials: "include",
    });

    const contentType = response.headers.get("content-type") || "";
    const noBody = method === "HEAD" || response.status === 204 || response.status === 205;
    const payload = noBody ? null : contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const detail = typeof payload === "object" && payload !== null
        ? payload.detail || payload.message || payload.error
        : payload;
      const readableDetail = Array.isArray(detail)
        ? detail.map((item) => item.msg).filter(Boolean).join(" ")
        : detail;
      const apiError = new Error(readableDetail || `Yêu cầu không thành công (${response.status}).`);
      apiError.status = response.status;
      throw apiError;
    }

    return payload;
  } catch (error) {
    if (externalSignal?.aborted) throw error;
    if (error.name === "AbortError") {
      throw new Error("Máy chủ phản hồi quá lâu. Vui lòng thử lại.");
    }
    if (error instanceof TypeError) {
      throw new Error("Không kết nối được backend. Hãy kiểm tra máy chủ API đang chạy.");
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
    externalSignal?.removeEventListener("abort", cancel);
  }
}

export const api = {
  health: () => apiRequest("/api/health", { method: "GET" }),
  get: (path, options = {}) => apiRequest(path, { ...options, method: "GET" }),
  post: (path, body) => apiRequest(path, { method: "POST", body: JSON.stringify(body) }),
  patch: (path, body) => apiRequest(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: (path, body) => apiRequest(path, {
    method: "DELETE",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }),
  stream: (path, body, signal) => {
    const headers = new Headers({ "Content-Type": "application/json" });
    const csrfToken = document.cookie
      .split("; ")
      .find((part) => part.startsWith("auramaxx_csrf="))
      ?.split("=")
      .slice(1)
      .join("=");
    if (csrfToken) headers.set("X-CSRF-Token", decodeURIComponent(csrfToken));
    return fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      credentials: "include",
      signal,
    });
  },
};
