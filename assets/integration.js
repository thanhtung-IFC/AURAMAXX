/* Shell integration used only by the unified FastAPI application. */
(() => {
  if (!window.VISIONFACE_API_PREFIX) return;
  const embedded = new URLSearchParams(location.search).get('embedded') === '1' && parent !== window;
  document.body.classList.toggle('auramaxx-embedded', embedded);
  const link = document.createElement('a');
  link.className = 'auramaxx-return';
  link.href = '/#face-lab';
  link.textContent = '← AURAMAXX · Face Lab';
  link.target = '_top';
  document.body.prepend(link);
  const caption = document.querySelector('header p');
  if (caption) caption.textContent = 'Camera USB · Nhận diện & liveness · Phân tích chính diện và góc nghiêng';
  const stop = () => {
    if (typeof window.stopCameraStream === 'function') window.stopCameraStream();
  };
  window.addEventListener('pagehide', stop);
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== parent || event.data?.type !== 'auramaxx:theme') return;
    const theme = event.data.theme;
    if (!['light', 'dark'].includes(theme)) return;
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  if (embedded) {
    document.querySelector('header nav')?.setAttribute('hidden', '');
    document.querySelector('[data-theme-toggle]')?.setAttribute('hidden', '');
  }
  if (!embedded && /(?:^|\/)(?:admin-)?login\.html$/.test(location.pathname)) {
    const modern = document.createElement('a');
    modern.className = 'auramaxx-return';
    modern.href = '/#my-aura';
    modern.textContent = 'Đăng nhập bằng email hoặc tài khoản cũ trong AURAMAXX →';
    document.body.append(modern);
  }
})();
