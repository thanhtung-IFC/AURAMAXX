(() => {
  const role = document.body.dataset.loginRole;
  const form = document.getElementById('loginForm');
  const message = document.getElementById('loginMessage');
  const button = document.getElementById('submitLogin');
  let register = false;
  function switchMode(value) {
    register = value;
    document.getElementById('displayNameLabel').hidden = !value;
    document.getElementById('displayName').required = value;
    document.getElementById('passwordHint').hidden = !value;
    document.getElementById('password').minLength = value ? 6 : 1;
    document.getElementById('password').autocomplete = value ? 'new-password' : 'current-password';
    document.getElementById('formTitle').textContent = value ? 'Tạo tài khoản của bạn' : 'Chào mừng bạn trở lại';
    button.textContent = value ? 'Tạo tài khoản' : 'Đăng nhập';
    document.getElementById('tabLogin').setAttribute('aria-selected', String(!value));
    document.getElementById('tabRegister').setAttribute('aria-selected', String(value));
    document.getElementById('tabLogin').setAttribute('aria-pressed', String(!value));
    document.getElementById('tabRegister').setAttribute('aria-pressed', String(value));
    const description = document.getElementById('formDescription');
    if (description) description.textContent = value ? 'Chỉ vài bước để bắt đầu hành trình của bạn.' : 'Đăng nhập để tiếp tục hành trình của bạn.';
    message.textContent = '';
  }
  document.getElementById('togglePassword')?.addEventListener('click', event => {
    const password = document.getElementById('password');
    const visible = password.type === 'password';
    password.type = visible ? 'text' : 'password';
    event.currentTarget.setAttribute('aria-pressed', String(visible));
    event.currentTarget.setAttribute('aria-label', visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
  });
  document.getElementById('tabLogin')?.addEventListener('click', () => switchMode(false));
  document.getElementById('tabRegister')?.addEventListener('click', () => switchMode(true));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    button.disabled = true;
    message.className = 'message';
    message.textContent = '';
    try {
      const body = { username: document.getElementById('username').value.trim(), password: document.getElementById('password').value };
      if (register) body.display_name = document.getElementById('displayName').value.trim();
      const response = await VisionAuth.fetch(register ? '/api/auth/register' : `/api/auth/${role}/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || data.detail || 'Không thể đăng nhập.');
      document.getElementById('password').value = '';
      if (register) {
        switchMode(false);
        message.className = 'message success';
        message.textContent = 'Đã tạo tài khoản. Hãy nhập mật khẩu để đăng nhập.';
      } else {
        window.location.assign(data.account.must_change_password ? '/account.html' : role === 'admin' ? '/admin.html' : '/');
      }
    } catch (error) { message.textContent = error.message; }
    finally { button.disabled = false; }
  });
})();
