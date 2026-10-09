(() => {
  const state = { people: [], accounts: [], selected: null, selectedAccount: null };
  const byId = id => document.getElementById(id);
  const text = (tag, value, className) => {
    const node = document.createElement(tag); node.textContent = value ?? '—';
    if (className) node.className = className;
    return node;
  };
  const date = value => {
    if (!value) return 'Chưa đăng nhập';
    const parsed = new Date(value.replace(/(\.\d{3})\d+/, '$1'));
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('vi-VN');
  };
  async function request(url, body, method = 'POST') {
    const options = body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    const response = await VisionAuth.fetch(url, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Không thể tải dữ liệu.');
    return data;
  }
  function message(error, success = false) {
    byId('adminMessage').className = success ? 'message success' : 'message';
    byId('adminMessage').textContent = error;
  }
  function renderPeople() {
    const search = byId('searchPeople').value.toLocaleLowerCase('vi');
    const body = byId('peopleRows'); body.replaceChildren();
    const people = state.people.filter(person => [person.name, person.id, person.owner_username || ''].join(' ').toLocaleLowerCase('vi').includes(search));
    for (const person of people) {
      const row = document.createElement('tr');
      const identity = document.createElement('td');
      identity.append(text('div', person.name), text('div', person.id, 'mono muted'));
      const action = document.createElement('td');
      const button = text('button', 'Chi tiết');
      button.addEventListener('click', () => showDetail(person.id).catch(error => message(error.message)));
      action.append(button);
      row.append(identity, text('td', person.owner_username || 'Chưa gán'), text('td', person.sample_count), action);
      body.append(row);
    }
    if (!people.length) { const row = document.createElement('tr'); const cell = text('td', 'Không có hồ sơ phù hợp.', 'empty'); cell.colSpan = 4; row.append(cell); body.append(row); }
  }
  async function showDetail(id) {
    const person = await request('/api/admin/people/' + encodeURIComponent(id));
    state.selected = id;
    const panel = byId('personDetail'); panel.replaceChildren(text('h2', person.name));
    const info = document.createElement('dl');
    for (const [label, value] of [['ID', person.id], ['Ngày tạo', date(person.created_at)], ['Số mẫu', person.sample_count]]) info.append(text('dt', label), text('dd', value));
    panel.append(info);
    if (person.account_id) {
      const accountButton = text('button', 'Xem tài khoản đăng nhập');
      accountButton.addEventListener('click', async () => {
        try { await activateTab('accounts'); await showAccountDetail(person.account_id); }
        catch (error) { message(error.message); }
      });
      panel.append(accountButton);
    }
    const form = document.createElement('form');
    const nameLabel = text('label', 'Tên hồ sơ'); const name = document.createElement('input');
    name.value = person.name; name.required = true; name.maxLength = 120; nameLabel.append(name);
    const ownerLabel = text('label', 'Tài khoản sở hữu'); const owner = document.createElement('select');
    const none = text('option', 'Chưa gán tài khoản'); none.value = ''; owner.append(none);
    for (const account of state.accounts.filter(account => account.is_active || account.id === person.account_id)) {
      const option = text('option', `${account.username} · ${account.display_name}${account.is_active ? '' : ' (đã khóa)'}`);
      option.value = account.id; owner.append(option);
    }
    owner.value = person.account_id || ''; ownerLabel.append(owner);
    const save = text('button', 'Lưu thay đổi', 'primary'); save.type = 'submit';
    form.append(nameLabel, ownerLabel, save);
    form.addEventListener('submit', async event => {
      event.preventDefault(); save.disabled = true;
      try {
        await request('/api/admin/people/' + encodeURIComponent(id), { name: name.value.trim(), account_id: owner.value || null });
        await load(); await showDetail(id); message('Đã lưu hồ sơ và tài khoản sở hữu.', true);
      } catch (error) { message(error.message); }
      finally { save.disabled = false; }
    });
    panel.append(form, text('h3', 'Các mẫu khuôn mặt'));
    const wrap = document.createElement('div'); wrap.className = 'table-wrap';
    const table = document.createElement('table');
    const head = document.createElement('tr');
    for (const label of ['Mẫu / Ngày tạo', 'Vector', 'Điểm mốc', 'Phiên bản']) head.append(text('th', label));
    table.append(head);
    for (const sample of person.samples) {
      const row = document.createElement('tr'); const identity = document.createElement('td');
      identity.append(text('div', sample.id, 'mono'), text('div', date(sample.created_at), 'muted'));
      row.append(identity, text('td', sample.dimension), text('td', sample.landmark_count), text('td', sample.feature_version));
      table.append(row);
    }
    if (person.samples.length) { wrap.append(table); panel.append(wrap); }
    else panel.append(text('p', 'Chưa có mẫu khuôn mặt. Có thể thêm mẫu từ trang Camera.', 'empty'));
    panel.append(text('p', 'Hồ sơ hiện lưu đặc trưng khuôn mặt; chưa lưu ảnh gốc.', 'muted'));
    const remove = text('button', 'Xóa hồ sơ và các mẫu', 'danger');
    remove.addEventListener('click', async () => {
      if (!window.confirm(`Xóa hồ sơ “${person.name}” cùng toàn bộ mẫu khuôn mặt?`)) return;
      remove.disabled = true;
      try {
        await request('/api/faces', { id }, 'DELETE');
        state.selected = null; panel.replaceChildren(text('h2', 'Chi tiết hồ sơ'), text('p', 'Hồ sơ đã được xóa.', 'muted'));
        await load(); message('Đã xóa hồ sơ.', true);
      } catch (error) { message(error.message); remove.disabled = false; }
    });
    panel.append(remove);
  }
  function renderAccounts() {
    const body = byId('accountRows'); body.replaceChildren();
    const search = byId('searchAccounts').value.toLocaleLowerCase('vi');
    for (const account of state.accounts.filter(account => [account.username, account.display_name, account.id].join(' ').toLocaleLowerCase('vi').includes(search))) {
      const row = document.createElement('tr'); const identity = document.createElement('td');
      identity.append(text('div', account.username), text('div', account.id, 'mono muted'));
      const action = document.createElement('td');
      if (account.role !== 'admin') {
        const button = text('button', account.is_active ? 'Khóa' : 'Mở khóa');
        button.dataset.action = 'toggle-status';
        button.addEventListener('click', async () => {
          button.disabled = true;
          try { await request(`/api/admin/accounts/${encodeURIComponent(account.id)}/status`, { is_active: !account.is_active }); await load(); if (state.selectedAccount === account.id) await showAccountDetail(account.id); message('Đã cập nhật trạng thái tài khoản.', true); }
          catch (error) { message(error.message); button.disabled = false; }
        });
        action.append(button);
      }
      const detail = text('button', 'Chi tiết'); detail.dataset.action = 'account-detail';
      detail.addEventListener('click', () => showAccountDetail(account.id).catch(error => message(error.message)));
      action.append(detail);
      row.append(identity, text('td', account.display_name), text('td', account.role === 'admin' ? 'Admin' : 'Người dùng'), text('td', account.is_active ? 'Hoạt động' : 'Đã khóa'), text('td', account.people_count), text('td', account.must_change_password ? 'Cần đổi mật khẩu tạm' : 'Đã thiết lập'), text('td', date(account.last_login)), action);
      body.append(row);
    }
    if (!body.children.length) { const row = document.createElement('tr'); const cell = text('td', 'Không có tài khoản phù hợp.', 'empty'); cell.colSpan = 8; row.append(cell); body.append(row); }
  }
  function clearTemporaryPassword() {
    byId('issuedTemporaryPassword').value = '';
    byId('issuedTemporaryPassword').type = 'password';
    byId('temporaryPasswordRecipient').textContent = '';
    byId('temporaryPasswordPanel').hidden = true;
    byId('toggleTemporaryPassword').textContent = 'Hiện mật khẩu';
  }
  function showTemporaryPassword(username, password) {
    clearTemporaryPassword();
    byId('issuedTemporaryPassword').value = password;
    byId('temporaryPasswordRecipient').textContent = `Tên đăng nhập: ${username}`;
    byId('temporaryPasswordPanel').hidden = false;
    byId('temporaryPasswordPanel').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  async function showAccountDetail(id) {
    clearTemporaryPassword();
    const account = await request('/api/admin/accounts/' + encodeURIComponent(id));
    state.selectedAccount = id;
    const panel = byId('accountDetail'); panel.replaceChildren(text('h2', account.display_name));
    const info = document.createElement('dl');
    for (const [label, value] of [['ID tài khoản', account.id], ['Tên đăng nhập', account.username], ['Quyền', account.role === 'admin' ? 'Admin' : 'Người dùng'], ['Trạng thái', account.is_active ? 'Hoạt động' : 'Đã khóa'], ['Ngày tạo', date(account.created_at)], ['Đăng nhập cuối', date(account.last_login)], ['Phiên hoạt động', account.active_sessions], ['Mật khẩu', account.must_change_password ? 'Mật khẩu tạm · cần đổi khi đăng nhập' : 'Đã thiết lập']]) info.append(text('dt', label), text('dd', value));
    panel.append(info);
    if (account.role === 'user') {
      const form = document.createElement('form'); form.id = 'editAccountForm'; form.className = 'account-form';
      const usernameLabel = text('label', 'Tên đăng nhập'); const username = document.createElement('input');
      username.id = 'editUsername'; username.value = account.username; username.required = true; username.minLength = 3; username.maxLength = 64; username.pattern = '[A-Za-z0-9_.\\-]+'; usernameLabel.append(username);
      const nameLabel = text('label', 'Họ tên người dùng'); const name = document.createElement('input');
      name.id = 'editDisplayName'; name.value = account.display_name; name.required = true; name.maxLength = 120; nameLabel.append(name);
      const save = text('button', 'Lưu thông tin', 'primary'); save.type = 'submit'; form.append(usernameLabel, nameLabel, save);
      form.addEventListener('submit', async event => {
        event.preventDefault(); save.disabled = true;
        try {
          await request(`/api/admin/accounts/${encodeURIComponent(id)}/profile`, { username: username.value.trim(), display_name: name.value.trim() });
          await load(); await showAccountDetail(id); message('Đã cập nhật thông tin tài khoản. Tên hồ sơ khuôn mặt được quản lý riêng.', true);
        } catch (error) { message(error.message); }
        finally { save.disabled = false; }
      });
      panel.append(form, text('h3', 'Cấp lại mật khẩu'));
      const reset = document.createElement('form'); reset.id = 'resetUserPasswordForm'; reset.className = 'account-form';
      const label = text('label', 'Mật khẩu tạm mới (bỏ trống để tạo ngẫu nhiên)'); const password = document.createElement('input');
      password.id = 'resetTemporaryPassword'; password.type = 'password'; password.minLength = 12; password.maxLength = 128; password.autocomplete = 'new-password'; label.append(password);
      const issue = text('button', 'Đặt lại mật khẩu', 'primary'); issue.type = 'submit'; reset.append(label, issue);
      reset.addEventListener('submit', async event => {
        event.preventDefault(); issue.disabled = true;
        try {
          const data = await request(`/api/admin/accounts/${encodeURIComponent(id)}/reset-password`, { temporary_password: password.value });
          password.value = ''; await load(); await showAccountDetail(id);
          showTemporaryPassword(account.username, data.temporary_password);
          message('Đã cấp mật khẩu tạm và đăng xuất các phiên cũ. Người dùng cần đổi mật khẩu sau khi đăng nhập.', true);
        } catch (error) { message(error.message); }
        finally { issue.disabled = false; }
      });
      panel.append(reset);
      const revoke = text('button', 'Đăng xuất mọi phiên của người dùng'); revoke.id = 'revokeUserSessions';
      revoke.addEventListener('click', async () => {
        revoke.disabled = true;
        try { await request(`/api/admin/accounts/${encodeURIComponent(id)}/sessions/revoke`, {}); await showAccountDetail(id); message('Đã thu hồi các phiên đăng nhập.', true); }
        catch (error) { message(error.message); revoke.disabled = false; }
      });
      panel.append(revoke);
    } else panel.append(text('p', 'Đổi mật khẩu admin tại trang Tài khoản cá nhân.', 'muted'));
    panel.append(text('h3', 'Hồ sơ khuôn mặt liên kết'));
    for (const person of account.people) {
      const button = text('button', `${person.name} · ${person.sample_count} mẫu`); button.dataset.action = 'linked-person';
      button.addEventListener('click', async () => {
        try { await activateTab('people'); await showDetail(person.id); }
        catch (error) { message(error.message); }
      });
      panel.append(button, text('p', person.id, 'mono muted'));
    }
    if (!account.people.length) panel.append(text('p', 'Chưa liên kết hồ sơ. Chọn một hồ sơ ở tab Hồ sơ khuôn mặt để gán tài khoản sở hữu.', 'muted'));
  }
  byId('createAccountForm').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button'); button.disabled = true;
    try {
      const data = await request('/api/admin/accounts', { username: byId('createUsername').value.trim(), display_name: byId('createDisplayName').value.trim(), temporary_password: byId('createTemporaryPassword').value });
      form.reset(); await load(); await showAccountDetail(data.account.id);
      showTemporaryPassword(data.account.username, data.temporary_password); message('Đã tạo tài khoản người dùng với mật khẩu tạm.', true);
    } catch (error) { message(error.message); }
    finally { button.disabled = false; }
  });
  byId('toggleTemporaryPassword').addEventListener('click', () => {
    const input = byId('issuedTemporaryPassword'); input.type = input.type === 'password' ? 'text' : 'password';
    byId('toggleTemporaryPassword').textContent = input.type === 'password' ? 'Hiện mật khẩu' : 'Ẩn mật khẩu';
  });
  byId('dismissTemporaryPassword').addEventListener('click', clearTemporaryPassword);
  window.addEventListener('pagehide', clearTemporaryPassword);
  async function loadAudit() {
    byId('auditSource').textContent = 'Đang tải nhật ký từ database…';
    let data;
    try { data = await request('/api/admin/audit'); }
    catch (error) { byId('auditSource').textContent = 'Không tải được nhật ký. Bấm Làm mới để thử lại.'; throw error; }
    const body = byId('auditRows'); body.replaceChildren();
    byId('auditSource').textContent = `Nguồn dữ liệu: ${data.storage.backend === 'sqlserver' ? 'SQL Server' : 'SQLite'} · ${data.storage.table}`;
    const labels = { 'account.created': 'Tạo tài khoản', 'account.updated': 'Sửa thông tin tài khoản', 'account.password_reset': 'Admin đặt lại mật khẩu', 'account.sessions_revoked': 'Thu hồi phiên đăng nhập', 'account.login': 'Đăng nhập', 'account.password_changed': 'Đổi mật khẩu', 'account.enabled': 'Mở khóa tài khoản', 'account.disabled': 'Khóa tài khoản', 'person.updated': 'Sửa / gán hồ sơ', 'person.sample_saved': 'Lưu mẫu khuôn mặt', 'person.deleted': 'Xóa hồ sơ', 'people.cleared': 'Xóa toàn bộ hồ sơ' };
    for (const item of data.events) { const row = document.createElement('tr'); row.append(text('td', date(item.created_at)), text('td', item.actor || 'Hệ thống'), text('td', labels[item.action] || item.action), text('td', item.target_id || '—', 'mono')); body.append(row); }
    if (!data.events.length) { const row = document.createElement('tr'); const cell = text('td', 'Chưa có nhật ký thao tác.', 'empty'); cell.colSpan = 4; row.append(cell); body.append(row); }
  }
  async function load() {
    const [people, accounts] = await Promise.all([request('/api/admin/people'), request('/api/admin/accounts')]);
    state.people = people.people; state.accounts = accounts.accounts;
    byId('accountCount').textContent = state.accounts.length;
    byId('peopleCount').textContent = state.people.length;
    byId('sampleCount').textContent = state.people.reduce((sum, person) => sum + person.sample_count, 0);
    renderPeople(); renderAccounts();
    if (!byId('auditPanel').hidden) await loadAudit();
  }
  byId('searchPeople').addEventListener('input', renderPeople);
  byId('searchAccounts').addEventListener('input', renderAccounts);
  byId('refreshAdmin').addEventListener('click', async () => { try { clearTemporaryPassword(); await load(); if (state.selected) await showDetail(state.selected); if (state.selectedAccount) await showAccountDetail(state.selectedAccount); message('Đã tải lại dữ liệu.', true); } catch (error) { message(error.message); } });
  async function activateTab(tab) {
    clearTemporaryPassword();
    document.querySelectorAll('[data-tab]').forEach(item => item.setAttribute('aria-selected', String(item.dataset.tab === tab)));
    for (const name of ['people', 'accounts', 'audit']) byId(name + 'Panel').hidden = tab !== name;
    if (tab === 'audit') await loadAudit();
  }
  document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', async () => {
    try { await activateTab(button.dataset.tab); } catch (error) { message(error.message); }
  }));
  VisionAuth.ready.then(async ({ account }) => {
    if (!account || account.role !== 'admin') return window.location.assign('/admin-login.html');
    if (account.must_change_password) return window.location.assign('/account.html');
    try { await load(); } catch (error) { message(error.message); }
  });
})();
