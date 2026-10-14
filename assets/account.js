(() => {
  const adminReturn = new URLSearchParams(window.location.search).get('next') === '/manage';
  VisionAuth.ready.then(({ account }) => {
    if (!account) return window.location.assign(adminReturn ? '/admin-login.html' : '/login.html');
    if (account.must_change_password) document.getElementById('passwordNotice').textContent = 'Đây là lần đăng nhập bằng mật khẩu tạm. Hãy đặt mật khẩu riêng trước khi sử dụng.';
  });
  document.getElementById('passwordForm').addEventListener('submit', async event => {
    event.preventDefault();
    const message = document.getElementById('passwordMessage');
    const button = document.getElementById('savePassword');
    const password = document.getElementById('newPassword').value;
    message.textContent = '';
    if (password !== document.getElementById('confirmPassword').value) { message.textContent = 'Hai mật khẩu mới chưa khớp.'; return; }
    button.disabled = true;
    try {
      const response = await VisionAuth.fetch('/api/auth/password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: document.getElementById('currentPassword').value, new_password: password })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || data.detail || 'Không thể đổi mật khẩu.');
      document.getElementById('passwordForm').reset();
      window.location.assign(adminReturn && VisionAuth.state.account.role === 'admin' ? '/admin-login.html?password_changed=1' : window.VISIONFACE_API_PREFIX ? '/#my-aura' : VisionAuth.state.account.role === 'admin' ? '/admin-login.html' : '/login.html');
    } catch (error) { message.textContent = error.message; }
    finally { button.disabled = false; }
  });
})();
