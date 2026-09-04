let currentUser = null;
let currentPermissions = [];
let contactsCache = [];

const content = document.getElementById('content');
const viewTitle = document.getElementById('viewTitle');

function can(permission) {
  return currentPermissions.includes(permission);
}

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function init() {
  try {
    const me = await Api.get('auth-me');
    currentUser = me.user;
    currentPermissions = me.permissions;
  } catch {
    window.location.href = '/login.html';
    return;
  }

  document.getElementById('whoAmI').textContent = `${currentUser.fullName} · ${currentUser.role.replace('_', ' ')}`;

  if (can('manage_users')) document.getElementById('navUsers').style.display = 'block';
  if (can('view_audit_history')) document.getElementById('navAudit').style.display = 'block';
  if (can('manage_users') || can('view_audit_history')) document.getElementById('adminSectionLabel').style.display = 'block';

  document.querySelectorAll('.nav-item').forEach((el) => {
    el.addEventListener('click', () => {
      if (el.dataset.view === 'logout') return logout();
      setActiveNav(el.dataset.view);
      renderView(el.dataset.view);
    });
  });

  if (currentUser.mustChangePassword) {
    renderForcedPasswordChange();
  } else {
    setActiveNav('dashboard');
    renderView('dashboard');
  }
}

function setActiveNav(view) {
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.view === view));
}

async function logout() {
  try { await Api.post('auth-logout'); } catch {}
  window.location.href = '/login.html';
}

async function renderView(view) {
  const views = {
    dashboard: renderDashboard,
    contacts: renderContacts,
    donations: renderDonations,
    volunteers: renderVolunteers,
    users: renderUsers,
    audit: renderAudit,
  };
  viewTitle.textContent = {
    dashboard: 'Dashboard', contacts: 'Contacts', donations: 'Donations',
    volunteers: 'Volunteers', users: 'User Management', audit: 'Admin History',
  }[view];
  content.innerHTML = '<div class="empty-state">Loading…</div>';
  try {
    await views[view]();
  } catch (err) {
    content.innerHTML = `<div class="empty-state">Error: ${esc(err.message)}</div>`;
  }
}

/* ---------------- Dashboard ---------------- */
async function renderDashboard() {
  const stats = [];
  if (can('manage_users')) {
    const { users } = await Api.get('users');
    stats.push({ label: 'Active Users', value: users.filter((u) => u.status === 'active').length });
    stats.push({ label: 'Inactive Users', value: users.filter((u) => u.status !== 'active').length });
  }
  if (can('view_contacts')) {
    const { contacts } = await Api.get('contacts');
    stats.push({ label: 'Contacts', value: contacts.length });
  }
  if (can('view_donations')) {
    const { donations } = await Api.get('donations');
    stats.push({ label: 'Donations Recorded', value: donations.length });
  }
  if (can('view_volunteers')) {
    const { volunteers } = await Api.get('volunteers');
    stats.push({ label: 'Volunteer Records', value: volunteers.length });
  }

  let recentAuditHtml = '';
  if (can('view_audit_history')) {
    const { events } = await Api.get('audit?limit=8');
    recentAuditHtml = `
      <h3 style="color: var(--su-navy);">Recent Admin Activity</h3>
      <table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Description</th></tr></thead><tbody>
        ${events.map((e) => `<tr>
          <td>${esc(new Date(e.timestamp).toLocaleString())}</td>
          <td>${esc(e.userName || 'System')}</td>
          <td>${esc(e.action)}</td>
          <td>${esc(e.description)}</td>
        </tr>`).join('') || '<tr><td colspan="4">No activity yet.</td></tr>'}
      </tbody></table>`;
  }

  content.innerHTML = `
    <div class="stat-grid">
      ${stats.map((s) => `<div class="stat-card"><div class="value">${s.value}</div><div class="label">${esc(s.label)}</div></div>`).join('')}
    </div>
    ${recentAuditHtml}
  `;
}

/* ---------------- Contacts ---------------- */
async function renderContacts() {
  const { contacts } = await Api.get('contacts');
  contactsCache = contacts;
  content.innerHTML = `
    <div class="toolbar">
      ${can('create_contacts') ? '<button class="secondary" id="addContactBtn">+ Add Contact</button>' : ''}
    </div>
    <table><thead><tr><th>ID</th><th>Name</th><th>Category</th><th>Email</th><th>Phone</th><th>Actions</th></tr></thead>
    <tbody>
      ${contacts.map((c) => `<tr>
        <td>${esc(c.contactId)}</td><td>${esc(c.fullName)}</td><td>${esc(c.category)}</td>
        <td>${esc(c.email)}</td><td>${esc(c.phone)}</td>
        <td>${can('archive_contacts') ? `<button class="ghost" data-archive="${c.contactId}">${c.archived ? 'Restore' : 'Archive'}</button>` : ''}</td>
      </tr>`).join('') || '<tr><td colspan="6">No contacts yet.</td></tr>'}
    </tbody></table>
  `;
  const addBtn = document.getElementById('addContactBtn');
  if (addBtn) addBtn.addEventListener('click', showAddContactModal);
  content.querySelectorAll('[data-archive]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const contactId = btn.dataset.archive;
      const c = contacts.find((x) => x.contactId === contactId);
      await Api.post('contacts-update', { contactId, action: c.archived ? 'restore' : 'archive' });
      renderView('contacts');
    });
  });
}

function showAddContactModal() {
  showModal(`
    <h3>Add Contact</h3>
    <label>Full Name</label><input id="m_fullName" required />
    <label>Category</label>
    <select id="m_category"><option value="participant">Participant</option><option value="donor">Donor</option><option value="volunteer">Volunteer</option><option value="staff">Staff</option></select>
    <label>Email</label><input id="m_email" type="email" />
    <label>Phone</label><input id="m_phone" />
    <label>Notes</label><textarea id="m_notes" rows="2"></textarea>
    <div class="error-text" id="modalError" style="display:none;"></div>
  `, async () => {
    await Api.post('contacts', {
      fullName: val('m_fullName'), category: val('m_category'),
      email: val('m_email'), phone: val('m_phone'), notes: val('m_notes'),
    });
    renderView('contacts');
  });
}

/* ---------------- Donations ---------------- */
async function renderDonations() {
  const { donations } = await Api.get('donations');
  content.innerHTML = `
    <div class="toolbar">
      ${can('create_donations') ? '<button class="secondary" id="addDonationBtn">+ Record Donation</button>' : ''}
    </div>
    <table><thead><tr><th>ID</th><th>Date</th><th>Amount</th><th>Contact</th><th>Method</th></tr></thead>
    <tbody>
      ${donations.map((d) => `<tr>
        <td>${esc(d.donationId)}</td><td>${esc(d.date)}</td><td>${esc(d.currency)} ${esc(d.amount)}</td>
        <td>${esc(d.contactId || '—')}</td><td>${esc(d.method)}</td>
      </tr>`).join('') || '<tr><td colspan="5">No donations recorded yet.</td></tr>'}
    </tbody></table>
  `;
  const addBtn = document.getElementById('addDonationBtn');
  if (addBtn) addBtn.addEventListener('click', showAddDonationModal);
}

async function showAddDonationModal() {
  if (!contactsCache.length) {
    try { contactsCache = (await Api.get('contacts')).contacts; } catch {}
  }
  showModal(`
    <h3>Record Donation</h3>
    <label>Contact (optional)</label>
    <select id="m_contactId"><option value="">— None / Anonymous —</option>${contactsCache.map((c) => `<option value="${esc(c.contactId)}">${esc(c.fullName)}</option>`).join('')}</select>
    <label>Amount</label><input id="m_amount" type="number" step="0.01" required />
    <label>Currency</label><input id="m_currency" value="SGD" />
    <label>Date</label><input id="m_date" type="date" required />
    <label>Method</label><input id="m_method" placeholder="e.g. bank transfer, cash, PayNow" />
    <label>Notes</label><textarea id="m_notes" rows="2"></textarea>
  `, async () => {
    await Api.post('donations', {
      contactId: val('m_contactId') || null, amount: parseFloat(val('m_amount')),
      currency: val('m_currency'), date: val('m_date'), method: val('m_method'), notes: val('m_notes'),
    });
    renderView('donations');
  });
}

/* ---------------- Volunteers ---------------- */
async function renderVolunteers() {
  const { volunteers } = await Api.get('volunteers');
  content.innerHTML = `
    <div class="toolbar">
      ${can('create_volunteers') ? '<button class="secondary" id="addVolunteerBtn">+ Add Volunteer Record</button>' : ''}
    </div>
    <table><thead><tr><th>ID</th><th>Contact</th><th>Role</th><th>Programme</th><th>Status</th></tr></thead>
    <tbody>
      ${volunteers.map((v) => `<tr>
        <td>${esc(v.volunteerRecordId)}</td><td>${esc(v.contactId)}</td><td>${esc(v.role)}</td>
        <td>${esc(v.programme)}</td><td>${esc(v.status)}</td>
      </tr>`).join('') || '<tr><td colspan="5">No volunteer records yet.</td></tr>'}
    </tbody></table>
  `;
  const addBtn = document.getElementById('addVolunteerBtn');
  if (addBtn) addBtn.addEventListener('click', showAddVolunteerModal);
}

async function showAddVolunteerModal() {
  if (!contactsCache.length) {
    try { contactsCache = (await Api.get('contacts')).contacts; } catch {}
  }
  showModal(`
    <h3>Add Volunteer Record</h3>
    <label>Contact</label>
    <select id="m_contactId" required>${contactsCache.map((c) => `<option value="${esc(c.contactId)}">${esc(c.fullName)}</option>`).join('')}</select>
    <label>Role</label><input id="m_role" placeholder="e.g. Camp Counsellor" required />
    <label>Programme</label><input id="m_programme" placeholder="e.g. Camp Alight" />
    <label>Status</label>
    <select id="m_status"><option value="active">Active</option><option value="inactive">Inactive</option></select>
  `, async () => {
    await Api.post('volunteers', {
      contactId: val('m_contactId'), role: val('m_role'),
      programme: val('m_programme'), status: val('m_status'),
    });
    renderView('volunteers');
  });
}

/* ---------------- Admin: Users ---------------- */
async function renderUsers() {
  const { users } = await Api.get('users');
  content.innerHTML = `
    <div class="toolbar"><button class="secondary" id="addUserBtn">+ Add User</button></div>
    <table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>
      ${users.map((u) => `<tr>
        <td>${esc(u.fullName)}</td><td>${esc(u.email)}</td>
        <td><span class="badge role">${esc(u.role.replace('_', ' '))}</span></td>
        <td><span class="badge ${u.status === 'active' ? 'active' : 'inactive'}">${esc(u.status)}</span></td>
        <td>
          <button class="ghost" data-status="${u.userId}" data-newstatus="${u.status === 'active' ? 'suspended' : 'active'}">${u.status === 'active' ? 'Suspend' : 'Reactivate'}</button>
          <button class="ghost" data-reset="${u.userId}">Reset Password</button>
        </td>
      </tr>`).join('')}
    </tbody></table>
  `;
  document.getElementById('addUserBtn').addEventListener('click', showAddUserModal);
  content.querySelectorAll('[data-status]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await Api.post('users-update', { userId: btn.dataset.status, updates: { status: btn.dataset.newstatus } });
      renderView('users');
    });
  });
  content.querySelectorAll('[data-reset]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const res = await Api.post('users-reset-password', { userId: btn.dataset.reset });
      alert(`Temporary password (share securely, this will not be shown again):\n\n${res.temporaryPassword}`);
    });
  });
}

function showAddUserModal() {
  showModal(`
    <h3>Add User</h3>
    <label>Full Name</label><input id="m_fullName" required />
    <label>Email</label><input id="m_email" type="email" required />
    <label>Role</label>
    <select id="m_role">
      <option value="staff">Staff</option>
      <option value="admin">Admin</option>
      ${currentUser.role === 'super_admin' ? '<option value="super_admin">Super Admin</option>' : ''}
    </select>
    <label>Phone</label><input id="m_phone" />
    <label>Notes</label><textarea id="m_notes" rows="2"></textarea>
  `, async () => {
    const res = await Api.post('users', {
      fullName: val('m_fullName'), email: val('m_email'), role: val('m_role'),
      phone: val('m_phone'), notes: val('m_notes'),
    });
    renderView('users');
    setTimeout(() => alert(`User created. Temporary password (share securely):\n\n${res.temporaryPassword}`), 200);
  });
}

/* ---------------- Admin: Audit Log ---------------- */
async function renderAudit() {
  content.innerHTML = `
    <div class="toolbar">
      <input id="auditSearch" placeholder="Search description, user, action…" />
      <button class="secondary" id="auditSearchBtn">Search</button>
    </div>
    <div id="auditResults">Loading…</div>
  `;
  document.getElementById('auditSearchBtn').addEventListener('click', loadAudit);
  await loadAudit();
}

async function loadAudit() {
  const q = document.getElementById('auditSearch').value;
  const { events } = await Api.get(`audit${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  document.getElementById('auditResults').innerHTML = `
    <table><thead><tr><th>When</th><th>User</th><th>Role</th><th>Action</th><th>Description</th><th>Result</th></tr></thead>
    <tbody>
      ${events.map((e) => `<tr>
        <td>${esc(new Date(e.timestamp).toLocaleString())}</td>
        <td>${esc(e.userName || '—')}</td>
        <td>${esc(e.userRole || '—')}</td>
        <td>${esc(e.action)}</td>
        <td>${esc(e.description)}</td>
        <td><span class="badge ${e.success ? 'active' : 'inactive'}">${e.success ? 'Success' : 'Failed'}</span></td>
      </tr>`).join('') || '<tr><td colspan="6">No matching events.</td></tr>'}
    </tbody></table>
  `;
}

/* ---------------- Forced password change ---------------- */
function renderForcedPasswordChange() {
  content.innerHTML = '';
  viewTitle.textContent = 'Change Password Required';
  showModal(`
    <h3>Set a New Password</h3>
    <p class="hint-text">Your account requires a password change before continuing.</p>
    <label>Current (temporary) Password</label><input id="m_current" type="password" required />
    <label>New Password (min. 10 characters)</label><input id="m_new" type="password" required minlength="10" />
  `, async () => {
    await Api.post('auth-change-password', { currentPassword: val('m_current'), newPassword: val('m_new') });
    currentUser.mustChangePassword = false;
    closeModal();
    setActiveNav('dashboard');
    renderView('dashboard');
  }, { dismissible: false });
}

/* ---------------- Modal helper ---------------- */
function val(id) { return document.getElementById(id).value; }

function showModal(innerHtml, onSubmit, opts = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'activeModal';
  backdrop.innerHTML = `
    <div class="modal">
      ${innerHtml}
      <div class="error-text" id="modalError" style="display:none;"></div>
      <div class="modal-actions">
        ${opts.dismissible === false ? '' : '<button class="secondary" id="modalCancel">Cancel</button>'}
        <button class="primary" id="modalSubmit" style="margin-top:0;">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const cancelBtn = document.getElementById('modalCancel');
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
  document.getElementById('modalSubmit').addEventListener('click', async () => {
    const errorEl = document.getElementById('modalError');
    errorEl.style.display = 'none';
    try {
      await onSubmit();
      closeModal();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
    }
  });
}

function closeModal() {
  const el = document.getElementById('activeModal');
  if (el) el.remove();
}

init();
