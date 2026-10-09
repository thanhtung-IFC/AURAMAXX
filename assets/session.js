/* Cookie-based authentication; no passwords or session tokens in LocalStorage. */
(() => {
  const nativeFetch = window.fetch.bind(window);
  const state = { account: null, csrf: null };
  const staticPages = window.location.hostname.endsWith('.github.io');
  const hostingMessage = 'GitHub Pages chỉ chạy giao diện tĩnh. Đăng nhập cần máy chủ Python và database. Hãy mở địa chỉ của máy chủ web; trên máy đang chạy dự án là http://localhost:8000.';
  if (staticPages) {
    const projectRoot = new URL('../', document.currentScript.src);
    document.querySelectorAll('a[href^="/"]').forEach(link => {
      link.href = new URL(link.getAttribute('href').slice(1), projectRoot).href;
    });
    if (!['login.html', 'admin-login.html'].includes(window.location.pathname.split('/').pop())) {
      window.location.replace(new URL('login.html', projectRoot).href);
    }
    const message = document.getElementById('loginMessage');
    if (message) message.textContent = hostingMessage;
  }
  const ready = staticPages ? Promise.resolve(state) : nativeFetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' })
    .then(response => response.ok ? response.json() : Promise.reject(new Error('Không thể kiểm tra phiên đăng nhập.')))
    .then(data => {
      state.account = data.account;
      state.csrf = data.csrf_token;
      document.querySelectorAll('[data-session-name]').forEach(node => {
        node.textContent = state.account ? `${state.account.display_name} · ${state.account.role === 'admin' ? 'Admin' : 'Người dùng'}` : '';
      });
      document.querySelectorAll('[data-admin-only]').forEach(node => { node.hidden = state.account?.role !== 'admin'; });
      return state;
    }).catch(() => state);

  async function authenticatedFetch(input, options = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return nativeFetch(input, options);
    if (staticPages) throw new Error(hostingMessage);
    await ready;
    const headers = new Headers(options.headers || {});
    const method = (options.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && state.csrf) headers.set('X-CSRF-Token', state.csrf);
    const response = await nativeFetch(input, { ...options, headers, credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 401 && !url.pathname.startsWith('/api/auth/')) window.location.assign('/login.html');
    return response;
  }
  window.fetch = authenticatedFetch;
  window.VisionAuth = {
    ready, state, fetch: authenticatedFetch,
    async logout() {
      const response = await authenticatedFetch('/api/auth/logout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      });
      if (!response.ok && response.status !== 401) throw new Error('Chưa đăng xuất được. Vui lòng thử lại.');
      if (typeof window.stopCameraStream === 'function') window.stopCameraStream();
      window.location.assign(state.account?.role === 'admin' ? '/admin-login.html' : '/login.html');
    }
  };
  document.querySelectorAll('[data-logout]').forEach(button => button.addEventListener('click', async () => {
    try { await window.VisionAuth.logout(); } catch (error) { window.alert(error.message); }
  }));
})();
