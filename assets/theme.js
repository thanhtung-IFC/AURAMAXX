(() => {
  const root = document.documentElement;
  const key = 'visionface-theme';
  const isAuthPage = /(?:^|\/)(?:admin-)?login\.html$/.test(location.pathname);
  let saved;
  try { saved = localStorage.getItem(key); } catch {}

  function apply(theme) {
    const isDark = theme === 'dark';
    root.dataset.theme = theme;
    root.classList.toggle('dark', isDark);
    root.style.colorScheme = theme;

    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.setAttribute('aria-pressed', String(isDark));
      const nextLabel = isDark ? 'Chế độ sáng' : 'Chế độ tối';
      const actionTitle = isDark ? 'Chuyển sang chế độ sáng' : 'Chuyển sang chế độ tối';
      button.setAttribute('aria-label', actionTitle);
      button.title = actionTitle;

      const hasFontAwesome = !!document.querySelector('link[href*="font-awesome"], link[href*="fontawesome"]');
      if (hasFontAwesome) {
        const icon = isDark
          ? '<i class="fa-solid fa-sun text-amber-400 text-xs" aria-hidden="true"></i>'
          : '<i class="fa-solid fa-moon text-indigo-400 text-xs" aria-hidden="true"></i>';
        button.innerHTML = icon + '<span class="theme-text">' + nextLabel + '</span>';
      } else {
        const symbol = isDark ? '☀' : '☾';
        button.innerHTML = '<span class="theme-symbol" aria-hidden="true">' + symbol + '</span><span class="theme-text">' + nextLabel + '</span>';
      }
    });
  }

  // Determine initial theme:
  // If user has a saved preference in localStorage, respect it.
  // Otherwise, default to 'dark' for main tracker, or 'light' for login page if appropriate.
  const initialTheme = (saved === 'light' || saved === 'dark') ? saved : (isAuthPage ? 'light' : 'dark');
  apply(initialTheme);

  document.addEventListener('DOMContentLoaded', () => {
    // Check if there is already a theme toggle button in the page
    let existingButton = document.querySelector('[data-theme-toggle]');
    if (!existingButton) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'theme-toggle';
      button.dataset.themeToggle = '';
      const host = document.querySelector('.auth-role-links, .topbar .links, header > div > div:last-child');
      (host || document.body).append(button);
    }

    // Bind click events to all [data-theme-toggle] buttons
    document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
      if (!btn.dataset.boundTheme) {
        btn.dataset.boundTheme = 'true';
        btn.addEventListener('click', () => {
          const currentTheme = root.dataset.theme === 'dark' ? 'light' : 'dark';
          apply(currentTheme);
          try { localStorage.setItem(key, currentTheme); } catch {}
        });
      }
    });

    apply(root.dataset.theme || (root.classList.contains('dark') ? 'dark' : 'light'));

    // Replace brand logos
    document.querySelectorAll('.journey-brand, .topbar .brand, [data-logo-slot]').forEach(brand => {
      const image = new Image();
      image.alt = 'VisionFace';
      image.className = 'visionface-logo';
      image.addEventListener('load', () => {
        if (brand.matches('.journey-brand, [data-logo-slot]')) {
          brand.replaceChildren(image);
        } else if (!brand.querySelector('.visionface-logo')) {
          image.alt = '';
          brand.prepend(image);
        }
      }, { once: true });
      image.src = new URL('assets/visionface-logo.png', location.href).href;
    });
  });

  window.addEventListener('storage', event => {
    if (event.key === key && ['light', 'dark'].includes(event.newValue)) {
      apply(event.newValue);
    }
  });
})();
