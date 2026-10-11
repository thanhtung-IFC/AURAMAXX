(() => {
  const root = document.documentElement;
  const key = 'visionface-theme';
  const login = /(?:^|\/)(?:admin-)?login\.html$/.test(location.pathname);
  let saved;
  try { saved = localStorage.getItem(key); } catch {}
  function apply(theme) {
    root.dataset.theme = theme;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.setAttribute('aria-pressed', String(theme === 'dark'));
      button.setAttribute('aria-label', theme === 'dark' ? 'Chuyển sang chế độ sáng' : 'Chuyển sang chế độ tối');
      button.title = button.getAttribute('aria-label');
      button.innerHTML = '<span aria-hidden="true">' + (theme === 'dark' ? '☀' : '☾') + '</span><span>' + (theme === 'dark' ? 'Chế độ sáng' : 'Chế độ tối') + '</span>';
    });
  }
  apply(saved === 'light' || saved === 'dark' ? saved : login ? 'light' : 'dark');
  document.addEventListener('DOMContentLoaded', () => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'theme-toggle';
    button.dataset.themeToggle = '';
    const host = document.querySelector('.auth-role-links, .topbar .links, header > div > div:last-child');
    (host || document.body).append(button);
    button.addEventListener('click', () => {
      const theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      apply(theme);
      try { localStorage.setItem(key, theme); } catch {}
    });
    apply(root.dataset.theme);
    document.querySelectorAll('.journey-brand, .topbar .brand, [data-logo-slot]').forEach(brand => {
      const image = new Image();
      image.alt = 'VisionFace';
      image.className = 'visionface-logo';
      image.addEventListener('load', () => {
        if (brand.matches('.journey-brand, [data-logo-slot]')) {
          brand.replaceChildren(image);
        } else {
          image.alt = '';
          brand.prepend(image);
        }
      }, { once: true });
      image.src = new URL('assets/visionface-logo.png', location.href).href;
    });
  });
  window.addEventListener('storage', event => {
    if (event.key === key && ['light', 'dark'].includes(event.newValue)) apply(event.newValue);
  });
})();
