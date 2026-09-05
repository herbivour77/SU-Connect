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

  if (can('use_ai_assistant')) {
    document.getElementById('navAI').style.display = 'block';
  }
  if (can('manage_users')) {
    document.getElementById('navUsers').style.display = 'block';
    document.getElementById('navRoles').style.display = 'block';
  }
  if (can('view_audit_history')) {
    document.getElementById('navAudit').style.display = 'block';
    document.getElementById('navSecurity').style.display = 'block';
    document.getElementById('navImportHistory').style.display = 'block';
    document.getElementById('navExportHistory').style.display = 'block';
  }
  if (can('manage_users') || can('view_audit_history')) {
    document.getElementById('adminSectionLabel').style.display = 'block';
    document.getElementById('navSystemActivity').style.display = 'block';
  }

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
    ai: renderAIAssistant,
    users: renderUsers,
    roles: renderRoles,
    audit: () => renderAudit(),
    security: () => renderAudit({ actionCategory: 'auth,security' }, 'Security & Access Logs — logins, failed logins, lockouts, and session revocations.'),
    importHistory: () => renderAudit({ actionCategory: 'import_export', actionContains: 'import' }, 'Import History — every bulk import that has been run.'),
    exportHistory: () => renderAudit({ actionCategory: 'import_export', actionContains: 'export' }, 'Export History — every export that has been generated.'),
    systemActivity: renderSystemActivity,
  };
  viewTitle.textContent = {
    dashboard: 'Dashboard', contacts: 'Contacts', donations: 'Donations',
    volunteers: 'Volunteers', users: 'User Management', roles: 'Roles & Permissions',
    ai: 'AI Assistant',
    audit: 'Admin History', security: 'Security & Access Logs',
    importHistory: 'Import History', exportHistory: 'Export History',
    systemActivity: 'System Activity',
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
      <div class="toolbar" style="justify-content: space-between; align-items: center;">
        <h3 style="color: var(--su-navy); margin: 0;">Recent Admin Activity</h3>
        ${currentUser.role === 'super_admin' ? '<button class="ghost" id="clearActivityBtn">Clear Recent Activity</button>' : ''}
      </div>
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

  const clearBtn = document.getElementById('clearActivityBtn');
  if (clearBtn) clearBtn.addEventListener('click', () => clearAuditActivity(renderDashboard));
}

// Shared by the Dashboard's "Recent Admin Activity" panel and the full
// Admin History view. The action itself is always super_admin-only
// (enforced server-side by audit-clear.js) and always leaves a durable
// "who cleared this, and when" record behind — see _lib/auditLogger.js.
async function clearAuditActivity(afterClear) {
  if (!confirm('Clear the Recent Admin Activity view? This hides earlier entries from view — it does not delete them from the underlying record, and the fact that you cleared it (and when) will always remain visible in Admin History.')) {
    return;
  }
  try {
    await Api.post('audit-clear');
    await afterClear();
  } catch (err) {
    alert(err.message);
  }
}

/* ---------------- Contacts ---------------- */
async function renderContacts() {
  const { contacts } = await Api.get('contacts?includeArchived=true');
  contactsCache = contacts;
  const canExport = can('export_contacts');
  const canImport = can('import_contacts');
  const categories = Array.from(new Set(contacts.map((c) => c.category).filter(Boolean))).sort();

  content.innerHTML = `
    <div class="toolbar">
      ${can('create_contacts') ? '<button class="secondary" id="addContactBtn">+ Add Contact</button>' : ''}
      ${canImport ? '<button class="secondary" id="importBtn">Import from Excel</button><input type="file" id="importFile" accept=".xlsx,.xls,.csv" style="display:none;">' : ''}
      ${canExport ? '<button class="ghost" id="exportSelectedBtn">Export Selected</button>' : ''}
      ${canExport ? '<button class="ghost" id="exportAllBtn">Export All to Excel</button>' : ''}
    </div>
    <div class="toolbar" style="align-items:flex-end;">
      <div style="flex:1;min-width:200px;"><label style="display:block;font-size:.78rem;">Search</label>
        <input id="c_q" placeholder="Search name, email, phone, notes…"></div>
      <div><label style="display:block;font-size:.78rem;">Category</label>
        <select id="c_category"><option value="">All categories</option>
          ${categories.map((cat) => `<option value="${esc(cat)}">${esc(cat)}</option>`).join('')}
        </select></div>
      <div><label style="display:block;font-size:.78rem;">Status</label>
        <select id="c_status"><option value="active">Active only</option><option value="archived">Archived only</option><option value="all">All</option></select></div>
    </div>
    <div class="error-text" id="contactsMsg" style="display:none;"></div>
    <table><thead><tr>
      ${canExport ? '<th><input type="checkbox" id="selectAll"></th>' : ''}
      <th>ID</th><th>Name</th><th>Gender</th><th>Category</th><th>Email</th><th>Phone</th><th>Actions</th>
    </tr></thead>
    <tbody id="contactsBody"></tbody></table>
  `;

  const renderRows = () => {
    const q = (document.getElementById('c_q').value || '').toLowerCase();
    const cat = document.getElementById('c_category').value;
    const status = document.getElementById('c_status').value;
    const rows = contacts.filter((c) => {
      if (status === 'active' && c.archived) return false;
      if (status === 'archived' && !c.archived) return false;
      if (cat && c.category !== cat) return false;
      if (q) {
        const hay = [c.fullName, c.email, c.phone, c.notes, c.contactId].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    document.getElementById('contactsBody').innerHTML = rows.map((c) => `<tr>
        ${canExport ? `<td><input type="checkbox" class="rowCheck" value="${esc(c.contactId)}"></td>` : ''}
        <td>${esc(c.contactId)}</td><td>${esc(c.fullName)}</td><td>${esc(c.gender)}</td><td>${esc(c.category)}</td>
        <td>${esc(c.email)}</td><td>${esc(c.phone)}</td>
        <td>
          <button class="ghost" data-activity="${c.contactId}">Activity</button>
          ${can('edit_contacts') ? `<button class="ghost" data-edit="${c.contactId}">Edit</button>` : ''}
          ${can('merge_contacts') ? `<button class="ghost" data-merge="${c.contactId}">Merge</button>` : ''}
          ${can('archive_contacts') ? `<button class="ghost" data-archive="${c.contactId}">${c.archived ? 'Restore' : 'Archive'}</button>` : ''}
        </td>
      </tr>`).join('') || `<tr><td colspan="${canExport ? 8 : 7}">No matching contacts.</td></tr>`;
    wireRowButtons();
  };

  function wireRowButtons() {
    document.querySelectorAll('[data-activity]').forEach((btn) => {
      btn.addEventListener('click', () => renderContactActivity(btn.dataset.activity));
    });
    document.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const c = contacts.find((x) => x.contactId === btn.dataset.edit);
        showEditContactModal(c, categories);
      });
    });
    document.querySelectorAll('[data-merge]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const c = contacts.find((x) => x.contactId === btn.dataset.merge);
        showMergeContactModal(c, contacts);
      });
    });
    document.querySelectorAll('[data-archive]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const contactId = btn.dataset.archive;
        const c = contacts.find((x) => x.contactId === contactId);
        await Api.post('contacts-update', { contactId, action: c.archived ? 'restore' : 'archive' });
        renderView('contacts');
      });
    });
    const selectAll = document.getElementById('selectAll');
    if (selectAll) {
      selectAll.addEventListener('change', () => {
        document.querySelectorAll('.rowCheck').forEach((cb) => { cb.checked = selectAll.checked; });
      });
    }
  }

  ['c_q', 'c_category', 'c_status'].forEach((id) => {
    const el = document.getElementById(id);
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', renderRows);
  });
  renderRows();

  const addBtn = document.getElementById('addContactBtn');
  if (addBtn) addBtn.addEventListener('click', () => showAddContactModal(categories));

  const msgEl = document.getElementById('contactsMsg');
  const showMsg = (text, isError) => {
    if (!msgEl) return;
    msgEl.textContent = text;
    msgEl.style.display = 'block';
    msgEl.style.color = isError ? 'var(--su-red, #c0392b)' : 'inherit';
  };

  const exportAllBtn = document.getElementById('exportAllBtn');
  if (exportAllBtn) {
    exportAllBtn.addEventListener('click', async () => {
      try {
        await Api.download('contacts-export', {}, 'contacts-export.xlsx');
      } catch (err) {
        showMsg(err.message, true);
      }
    });
  }

  const exportSelectedBtn = document.getElementById('exportSelectedBtn');
  if (exportSelectedBtn) {
    exportSelectedBtn.addEventListener('click', async () => {
      const contactIds = Array.from(content.querySelectorAll('.rowCheck:checked')).map((cb) => cb.value);
      if (!contactIds.length) {
        showMsg('Select at least one contact to export.', true);
        return;
      }
      try {
        await Api.download('contacts-export', { contactIds }, 'contacts-export-selected.xlsx');
      } catch (err) {
        showMsg(err.message, true);
      }
    });
  }

  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile');
  if (importBtn && importFile) {
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', async () => {
      const file = importFile.files[0];
      importFile.value = '';
      if (!file) return;
      try {
        showMsg('Reading file…', false);
        const rows = await parseSpreadsheetFile(file);
        if (!rows.length) {
          showMsg('No rows found in that file.', true);
          return;
        }
        showMsg(`Importing ${rows.length} row(s)…`, false);
        const res = await Api.post('contacts-import', { rows });
        showMsg(`Imported ${res.createdCount} contact(s). ${res.skippedCount} skipped${res.skippedCount ? ' (duplicates or missing name)' : ''}.`, false);
        renderView('contacts');
      } catch (err) {
        showMsg(err.message, true);
      }
    });
  }
}

// Reads an uploaded .xlsx/.xls/.csv file with SheetJS and returns an
// array of plain row objects, keyed by column header, ready to POST to
// contacts-import. All parsing happens in the browser — the file itself
// never needs to be uploaded as a binary blob.
function parseSpreadsheetFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      try {
        const data = new Uint8Array(reader.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
        resolve(rows);
      } catch (err) {
        reject(new Error('Could not parse that file. Please upload a valid Excel or CSV file.'));
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

function showAddContactModal(categories = []) {
  showModal(`
    <h3>Add Contact</h3>
    <label>Full Name</label><input id="m_fullName" required />
    <label>Gender</label>
    <select id="m_gender"><option value="">— Not specified —</option><option value="M">M</option><option value="F">F</option></select>
    <label>Category</label>
    <input id="m_category" list="categoryOptions" placeholder="e.g. donor, volunteer, participant — or type a new one">
    <datalist id="categoryOptions">${categories.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    <label>Email</label><input id="m_email" type="email" />
    <label>Phone</label><input id="m_phone" />
    <label>Notes</label><textarea id="m_notes" rows="2"></textarea>
    <div class="error-text" id="modalError" style="display:none;"></div>
  `, async () => {
    await Api.post('contacts', {
      fullName: val('m_fullName'), gender: val('m_gender'), category: val('m_category'),
      email: val('m_email'), phone: val('m_phone'), notes: val('m_notes'),
    });
    renderView('contacts');
  });
}

function showEditContactModal(contact, categories = []) {
  showModal(`
    <h3>Edit Contact</h3>
    <label>Full Name</label><input id="m_fullName" value="${esc(contact.fullName)}" required />
    <label>Gender</label>
    <select id="m_gender">
      <option value="" ${!contact.gender ? 'selected' : ''}>— Not specified —</option>
      <option value="M" ${contact.gender === 'M' ? 'selected' : ''}>M</option>
      <option value="F" ${contact.gender === 'F' ? 'selected' : ''}>F</option>
    </select>
    <label>Category</label>
    <input id="m_category" list="categoryOptions" value="${esc(contact.category || '')}" placeholder="e.g. donor, volunteer, participant — or type a new one">
    <datalist id="categoryOptions">${categories.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    <label>Email</label><input id="m_email" type="email" value="${esc(contact.email || '')}" />
    <label>Phone</label><input id="m_phone" value="${esc(contact.phone || '')}" />
    <label>Notes</label><textarea id="m_notes" rows="2">${esc(contact.notes || '')}</textarea>
  `, async () => {
    await Api.post('contacts-update', {
      contactId: contact.contactId,
      action: 'edit',
      updates: {
        fullName: val('m_fullName'), gender: val('m_gender'), category: val('m_category'),
        email: val('m_email'), phone: val('m_phone'), notes: val('m_notes'),
      },
    });
    renderView('contacts');
  });
}

function showMergeContactModal(contact, allContacts) {
  const others = allContacts.filter((c) => c.contactId !== contact.contactId);
  showModal(`
    <h3>Merge "${esc(contact.fullName)}" into…</h3>
    <p class="hint-text">This record will be archived. Any of its fields missing on the target will be copied over. This cannot be undone, but both records remain permanently in Admin History.</p>
    <label>Merge into</label>
    <select id="m_target">${others.map((c) => `<option value="${esc(c.contactId)}">${esc(c.fullName)} (${esc(c.contactId)})</option>`).join('')}</select>
  `, async () => {
    await Api.post('contacts-update', {
      contactId: contact.contactId,
      action: 'merge',
      mergeIntoContactId: val('m_target'),
    });
    renderView('contacts');
  });
}

/* ---------------- Contact Activity (per-contact history) ---------------- */
// This is the "activity tracker" view for a single contact: everything
// this app knows about them in one place — donations, volunteer
// records, and their slice of Admin History — with the ability to add
// or delete records right from here instead of hunting through separate
// global lists.
async function renderContactActivity(contactId) {
  const contact = contactsCache.find((c) => c.contactId === contactId) || (await Api.get(`contacts?includeArchived=true`)).contacts.find((c) => c.contactId === contactId);
  const [{ donations }, { volunteers }, auditRes] = await Promise.all([
    Api.get('donations'),
    Api.get('volunteers'),
    can('view_audit_history') ? Api.get(`audit?contactId=${contactId}`) : Promise.resolve({ events: [] }),
  ]);
  const contactDonations = donations.filter((d) => d.contactId === contactId);
  const contactVolunteerRecords = volunteers.filter((v) => v.contactId === contactId);
  const events = auditRes.events || [];

  content.innerHTML = `
    <button class="ghost" id="backToContacts">← Back to Contacts</button>
    <h3 style="color: var(--su-navy); margin-top: 14px;">${esc(contact.fullName)} <span class="badge role">${esc(contact.category || 'uncategorised')}</span></h3>
    <p class="hint-text">${esc(contact.contactId)} · ${esc(contact.gender || 'gender not specified')} · ${esc(contact.email || 'no email')} · ${esc(contact.phone || 'no phone')}</p>

    <div class="toolbar" style="justify-content: space-between;">
      <h3 style="color: var(--su-navy); margin:0;">Donations</h3>
      ${can('create_donations') ? '<button class="secondary" id="addDonationBtnActivity">+ Record Donation</button>' : ''}
    </div>
    <table><thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Notes</th><th></th></tr></thead><tbody>
      ${contactDonations.map((d) => `<tr>
        <td>${esc(d.date)}</td><td>${esc(d.currency)} ${esc(d.amount)}</td><td>${esc(d.method)}</td><td>${esc(d.notes)}</td>
        <td>${can('edit_donations') ? `<button class="ghost" data-deldon="${d.donationId}">Delete</button>` : ''}</td>
      </tr>`).join('') || '<tr><td colspan="5">No donations from this contact.</td></tr>'}
    </tbody></table>

    <div class="toolbar" style="justify-content: space-between; margin-top: 20px;">
      <h3 style="color: var(--su-navy); margin:0;">Volunteer Records</h3>
      ${can('create_volunteers') ? '<button class="secondary" id="addVolunteerBtnActivity">+ Add Volunteer Record</button>' : ''}
    </div>
    <table><thead><tr><th>Role</th><th>Programme</th><th>Status</th><th></th></tr></thead><tbody>
      ${contactVolunteerRecords.map((v) => `<tr>
        <td>${esc(v.role)}</td><td>${esc(v.programme)}</td><td>${esc(v.status)}</td>
        <td>${can('edit_volunteers') ? `<button class="ghost" data-delvol="${v.volunteerRecordId}">Delete</button>` : ''}</td>
      </tr>`).join('') || '<tr><td colspan="4">No volunteer records for this contact.</td></tr>'}
    </tbody></table>

    ${can('view_audit_history') ? `
    <h3 style="color: var(--su-navy); margin-top: 20px;">Admin History for this Contact</h3>
    <table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Description</th></tr></thead><tbody>
      ${events.map((e) => `<tr>
        <td>${esc(new Date(e.timestamp).toLocaleString())}</td><td>${esc(e.userName || '—')}</td>
        <td>${esc(e.action)}</td><td>${esc(e.description)}</td>
      </tr>`).join('') || '<tr><td colspan="4">No admin activity recorded for this contact.</td></tr>'}
    </tbody></table>` : ''}
  `;

  document.getElementById('backToContacts').addEventListener('click', () => renderView('contacts'));

  const addDonBtn = document.getElementById('addDonationBtnActivity');
  if (addDonBtn) addDonBtn.addEventListener('click', () => showAddDonationModal(contactId, () => renderContactActivity(contactId)));
  const addVolBtn = document.getElementById('addVolunteerBtnActivity');
  if (addVolBtn) addVolBtn.addEventListener('click', () => showAddVolunteerModal(contactId, () => renderContactActivity(contactId)));

  content.querySelectorAll('[data-deldon]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this donation record? This cannot be undone.')) return;
      await Api.del('donations', { donationId: btn.dataset.deldon });
      renderContactActivity(contactId);
    });
  });
  content.querySelectorAll('[data-delvol]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this volunteer record? This cannot be undone.')) return;
      await Api.del('volunteers', { volunteerRecordId: btn.dataset.delvol });
      renderContactActivity(contactId);
    });
  });
}

/* ---------------- Donations ---------------- */
async function renderDonations() {
  const [{ donations }, contactsRes] = await Promise.all([
    Api.get('donations'),
    contactsCache.length ? Promise.resolve({ contacts: contactsCache }) : Api.get('contacts?includeArchived=true'),
  ]);
  if (!contactsCache.length) contactsCache = contactsRes.contacts;
  const contactName = (id) => (contactsCache.find((c) => c.contactId === id) || {}).fullName || id || '—';
  const methods = Array.from(new Set(donations.map((d) => d.method).filter(Boolean))).sort();

  content.innerHTML = `
    <div class="toolbar">
      ${can('create_donations') ? '<button class="secondary" id="addDonationBtn">+ Record Donation</button>' : ''}
    </div>
    <div class="toolbar" style="align-items:flex-end;">
      <div style="flex:1;min-width:200px;"><label style="display:block;font-size:.78rem;">Search</label>
        <input id="d_q" placeholder="Search contact, method, notes…"></div>
      <div><label style="display:block;font-size:.78rem;">From</label><input type="date" id="d_from"></div>
      <div><label style="display:block;font-size:.78rem;">To</label><input type="date" id="d_to"></div>
      <div><label style="display:block;font-size:.78rem;">Method</label>
        <select id="d_method"><option value="">All methods</option>${methods.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}</select></div>
      <div><label style="display:block;font-size:.78rem;">Min amount</label><input type="number" id="d_min" style="width:90px;"></div>
      <div><label style="display:block;font-size:.78rem;">Max amount</label><input type="number" id="d_max" style="width:90px;"></div>
    </div>
    <table><thead><tr><th>ID</th><th>Date</th><th>Amount</th><th>Contact</th><th>Method</th><th></th></tr></thead>
    <tbody id="donationsBody"></tbody></table>
  `;

  const renderRows = () => {
    const q = (document.getElementById('d_q').value || '').toLowerCase();
    const from = document.getElementById('d_from').value;
    const to = document.getElementById('d_to').value;
    const method = document.getElementById('d_method').value;
    const min = parseFloat(document.getElementById('d_min').value);
    const max = parseFloat(document.getElementById('d_max').value);
    const rows = donations.filter((d) => {
      if (from && d.date < from) return false;
      if (to && d.date > to) return false;
      if (method && d.method !== method) return false;
      if (!isNaN(min) && d.amount < min) return false;
      if (!isNaN(max) && d.amount > max) return false;
      if (q) {
        const hay = [contactName(d.contactId), d.method, d.notes, d.donationId].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    document.getElementById('donationsBody').innerHTML = rows.map((d) => `<tr>
        <td>${esc(d.donationId)}</td><td>${esc(d.date)}</td><td>${esc(d.currency)} ${esc(d.amount)}</td>
        <td>${d.contactId ? `<a href="#" data-gocontact="${d.contactId}">${esc(contactName(d.contactId))}</a>` : '—'}</td>
        <td>${esc(d.method)}</td>
        <td>${can('edit_donations') ? `<button class="ghost" data-deldon="${d.donationId}">Delete</button>` : ''}</td>
      </tr>`).join('') || '<tr><td colspan="6">No matching donations.</td></tr>';

    document.querySelectorAll('[data-gocontact]').forEach((a) => {
      a.addEventListener('click', (e) => { e.preventDefault(); renderContactActivity(a.dataset.gocontact); });
    });
    document.querySelectorAll('[data-deldon]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this donation record? This cannot be undone.')) return;
        await Api.del('donations', { donationId: btn.dataset.deldon });
        renderView('donations');
      });
    });
  };

  ['d_q', 'd_from', 'd_to', 'd_method', 'd_min', 'd_max'].forEach((id) => {
    const el = document.getElementById(id);
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', renderRows);
  });
  renderRows();

  const addBtn = document.getElementById('addDonationBtn');
  if (addBtn) addBtn.addEventListener('click', () => showAddDonationModal());
}

// contactId: when set (e.g. launched from a contact's Activity page), the
// contact is locked in rather than pickable. onDone: called instead of
// the default renderView('donations') refresh — used by the Activity page
// to refresh itself in place.
async function showAddDonationModal(contactId = null, onDone = () => renderView('donations')) {
  if (!contactsCache.length) {
    try { contactsCache = (await Api.get('contacts?includeArchived=true')).contacts; } catch {}
  }
  const contact = contactId ? contactsCache.find((c) => c.contactId === contactId) : null;
  showModal(`
    <h3>Record Donation</h3>
    <label>Contact${contact ? '' : ' (optional)'}</label>
    ${contact
      ? `<input value="${esc(contact.fullName)}" disabled>`
      : `<select id="m_contactId"><option value="">— None / Anonymous —</option>${contactsCache.map((c) => `<option value="${esc(c.contactId)}">${esc(c.fullName)}</option>`).join('')}</select>`}
    <label>Amount</label><input id="m_amount" type="number" step="0.01" required />
    <label>Currency</label><input id="m_currency" value="SGD" />
    <label>Date</label><input id="m_date" type="date" required />
    <label>Method</label><input id="m_method" placeholder="e.g. bank transfer, cash, PayNow" />
    <label>Notes</label><textarea id="m_notes" rows="2"></textarea>
  `, async () => {
    await Api.post('donations', {
      contactId: contact ? contact.contactId : (val('m_contactId') || null),
      amount: parseFloat(val('m_amount')),
      currency: val('m_currency'), date: val('m_date'), method: val('m_method'), notes: val('m_notes'),
    });
    onDone();
  });
}

/* ---------------- Volunteers ---------------- */
async function renderVolunteers() {
  const [{ volunteers }, contactsRes] = await Promise.all([
    Api.get('volunteers'),
    contactsCache.length ? Promise.resolve({ contacts: contactsCache }) : Api.get('contacts?includeArchived=true'),
  ]);
  if (!contactsCache.length) contactsCache = contactsRes.contacts;
  const contactName = (id) => (contactsCache.find((c) => c.contactId === id) || {}).fullName || id || '—';
  const programmes = Array.from(new Set(volunteers.map((v) => v.programme).filter(Boolean))).sort();

  content.innerHTML = `
    <div class="toolbar">
      ${can('create_volunteers') ? '<button class="secondary" id="addVolunteerBtn">+ Add Volunteer Record</button>' : ''}
    </div>
    <div class="toolbar" style="align-items:flex-end;">
      <div style="flex:1;min-width:200px;"><label style="display:block;font-size:.78rem;">Search</label>
        <input id="v_q" placeholder="Search contact, role, programme…"></div>
      <div><label style="display:block;font-size:.78rem;">Programme</label>
        <select id="v_programme"><option value="">All programmes</option>${programmes.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}</select></div>
      <div><label style="display:block;font-size:.78rem;">Status</label>
        <select id="v_status"><option value="">All</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
    </div>
    <table><thead><tr><th>ID</th><th>Contact</th><th>Role</th><th>Programme</th><th>Status</th><th></th></tr></thead>
    <tbody id="volunteersBody"></tbody></table>
  `;

  const renderRows = () => {
    const q = (document.getElementById('v_q').value || '').toLowerCase();
    const programme = document.getElementById('v_programme').value;
    const status = document.getElementById('v_status').value;
    const rows = volunteers.filter((v) => {
      if (programme && v.programme !== programme) return false;
      if (status && v.status !== status) return false;
      if (q) {
        const hay = [contactName(v.contactId), v.role, v.programme, v.volunteerRecordId].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    document.getElementById('volunteersBody').innerHTML = rows.map((v) => `<tr>
        <td>${esc(v.volunteerRecordId)}</td>
        <td><a href="#" data-gocontact="${v.contactId}">${esc(contactName(v.contactId))}</a></td>
        <td>${esc(v.role)}</td><td>${esc(v.programme)}</td><td>${esc(v.status)}</td>
        <td>${can('edit_volunteers') ? `<button class="ghost" data-delvol="${v.volunteerRecordId}">Delete</button>` : ''}</td>
      </tr>`).join('') || '<tr><td colspan="6">No matching volunteer records.</td></tr>';

    document.querySelectorAll('[data-gocontact]').forEach((a) => {
      a.addEventListener('click', (e) => { e.preventDefault(); renderContactActivity(a.dataset.gocontact); });
    });
    document.querySelectorAll('[data-delvol]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this volunteer record? This cannot be undone.')) return;
        await Api.del('volunteers', { volunteerRecordId: btn.dataset.delvol });
        renderView('volunteers');
      });
    });
  };

  ['v_q', 'v_programme', 'v_status'].forEach((id) => {
    const el = document.getElementById(id);
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', renderRows);
  });
  renderRows();

  const addBtn = document.getElementById('addVolunteerBtn');
  if (addBtn) addBtn.addEventListener('click', () => showAddVolunteerModal());
}

async function showAddVolunteerModal(contactId = null, onDone = () => renderView('volunteers')) {
  if (!contactsCache.length) {
    try { contactsCache = (await Api.get('contacts?includeArchived=true')).contacts; } catch {}
  }
  const contact = contactId ? contactsCache.find((c) => c.contactId === contactId) : null;
  showModal(`
    <h3>Add Volunteer Record</h3>
    <label>Contact</label>
    ${contact
      ? `<input value="${esc(contact.fullName)}" disabled>`
      : `<select id="m_contactId" required>${contactsCache.map((c) => `<option value="${esc(c.contactId)}">${esc(c.fullName)}</option>`).join('')}</select>`}
    <label>Role</label><input id="m_role" placeholder="e.g. Camp Counsellor" required />
    <label>Programme</label><input id="m_programme" placeholder="e.g. Camp Alight" />
    <label>Status</label>
    <select id="m_status"><option value="active">Active</option><option value="inactive">Inactive</option></select>
  `, async () => {
    await Api.post('volunteers', {
      contactId: contact ? contact.contactId : val('m_contactId'),
      role: val('m_role'), programme: val('m_programme'), status: val('m_status'),
    });
    onDone();
  });
}

/* ---------------- AI Assistant ---------------- */
async function renderAIAssistant() {
  if (!contactsCache.length) {
    try { contactsCache = (await Api.get('contacts?includeArchived=true')).contacts; } catch {}
  }
  content.innerHTML = `
    <p class="hint-text">Ask about a specific contact (optional) or ask a general question. Answers are generated by Claude and are only as accurate as the data in this system — always verify anything important.</p>
    <div class="toolbar" style="align-items:flex-end;">
      <div style="min-width:220px;"><label style="display:block;font-size:.78rem;">Contact (optional)</label>
        <select id="ai_contact"><option value="">— General question —</option>
          ${contactsCache.map((c) => `<option value="${esc(c.contactId)}">${esc(c.fullName)}</option>`).join('')}
        </select></div>
    </div>
    <textarea id="ai_question" rows="3" placeholder="e.g. Summarise this donor's giving history, or: How many active volunteers do we have in Camp Alight?" style="width:100%; margin-bottom:10px;"></textarea>
    <button class="primary" id="ai_ask">Ask</button>
    <div id="ai_answer" style="margin-top: 18px; white-space: pre-wrap;"></div>
  `;

  document.getElementById('ai_ask').addEventListener('click', async () => {
    const question = document.getElementById('ai_question').value.trim();
    const answerEl = document.getElementById('ai_answer');
    if (!question) return;
    answerEl.textContent = 'Thinking…';
    try {
      const res = await Api.post('ai-assistant', {
        question,
        contactId: document.getElementById('ai_contact').value || null,
      });
      answerEl.textContent = res.answer;
    } catch (err) {
      answerEl.textContent = '';
      answerEl.innerHTML = `<span class="error-text" style="display:block;">${esc(err.message)}</span>`;
    }
  });
}

/* ---------------- Admin: Users ---------------- */
const ROLE_OPTIONS = ['staff', 'admin', 'super_admin'];

async function renderUsers() {
  const { users } = await Api.get('users');
  const isSuperAdmin = currentUser.role === 'super_admin';

  content.innerHTML = `
    <div class="toolbar"><button class="secondary" id="addUserBtn">+ Add User</button></div>
    <table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>
      ${users.map((u) => {
        const isSelf = u.userId === currentUser.userId;
        // Only a Super Admin may touch a Super Admin account; the backend
        // enforces this too, but hiding the controls avoids a confusing
        // 403 round-trip for anyone who isn't going to be allowed anyway.
        const canEditThisRow = isSuperAdmin || u.role !== 'super_admin';
        const roleSelect = canEditThisRow && !isSelf
          ? `<select data-role-select="${u.userId}" data-current-role="${u.role}">
              ${ROLE_OPTIONS.filter((r) => r !== 'super_admin' || isSuperAdmin).map((r) =>
                `<option value="${r}" ${r === u.role ? 'selected' : ''}>${r.replace('_', ' ')}</option>`
              ).join('')}
            </select>`
          : `<span class="badge role">${esc(u.role.replace('_', ' '))}</span>`;

        return `<tr>
          <td>${esc(u.fullName)}</td><td>${esc(u.email)}</td>
          <td>${roleSelect}</td>
          <td><span class="badge ${u.status === 'active' ? 'active' : 'inactive'}">${esc(u.status)}</span></td>
          <td>
            ${!isSelf ? `<button class="ghost" data-status="${u.userId}" data-newstatus="${u.status === 'active' ? 'suspended' : 'active'}">${u.status === 'active' ? 'Suspend' : 'Reactivate'}</button>` : ''}
            <button class="ghost" data-reset="${u.userId}">Reset Password</button>
            <button class="ghost" data-revoke="${u.userId}" data-uname="${esc(u.fullName)}">Revoke Sessions</button>
            ${!isSelf && canEditThisRow ? `<button class="ghost" data-delete="${u.userId}" data-name="${esc(u.fullName)}">Delete</button>` : ''}
          </td>
        </tr>`;
      }).join('')}
    </tbody></table>
  `;
  document.getElementById('addUserBtn').addEventListener('click', showAddUserModal);

  content.querySelectorAll('[data-status]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await Api.post('users-update', { userId: btn.dataset.status, updates: { status: btn.dataset.newstatus } });
      renderView('users');
    });
  });

  content.querySelectorAll('[data-role-select]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const userId = sel.dataset.roleSelect;
      const newRole = sel.value;
      const previousRole = sel.dataset.currentRole;
      if (newRole === previousRole) return;
      if (!confirm(`Change this user's role from "${previousRole.replace('_', ' ')}" to "${newRole.replace('_', ' ')}"? Their active sessions will be signed out.`)) {
        sel.value = previousRole;
        return;
      }
      try {
        await Api.post('users-update', { userId, updates: { role: newRole } });
        renderView('users');
      } catch (err) {
        alert(err.message);
        sel.value = previousRole;
      }
    });
  });

  content.querySelectorAll('[data-reset]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const res = await Api.post('users-reset-password', { userId: btn.dataset.reset });
      alert(`Temporary password (share securely, this will not be shown again):\n\n${res.temporaryPassword}`);
    });
  });

  content.querySelectorAll('[data-revoke]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Revoke all active sessions for ${btn.dataset.uname}? They will be signed out immediately.`)) return;
      try {
        await Api.post('users-update', { userId: btn.dataset.revoke, revokeSessions: true });
        alert('Sessions revoked.');
      } catch (err) {
        alert(err.message);
      }
    });
  });

  content.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.name;
      if (!confirm(`Permanently delete ${name}'s account? This cannot be undone.`)) return;
      try {
        await Api.del('users', { userId: btn.dataset.delete });
        renderView('users');
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

async function showAddUserModal() {
  let permissions = [];
  let rolePermissions = {};
  if (currentUser.role === 'super_admin') {
    ({ permissions, rolePermissions } = await Api.get('permissions'));
  }
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
    <label>Account Status</label>
    <select id="m_status"><option value="active">Active</option><option value="suspended">Suspended (not yet ready to log in)</option></select>
    <label>Phone</label><input id="m_phone" />
    <label>Notes</label><textarea id="m_notes" rows="2"></textarea>
    ${currentUser.role === 'super_admin' ? `
    <label>Additional Permissions (beyond the role's default set)</label>
    <div style="max-height:180px; overflow-y:auto; display:grid; grid-template-columns:1fr 1fr; gap:2px 10px;">
      ${permissions.map((p) => `<label style="font-weight:normal; display:flex; gap:6px; align-items:center;"><input type="checkbox" class="m_extraPerm" value="${esc(p)}"> ${esc(p)}</label>`).join('')}
    </div>` : ''}
  `, async () => {
    const role = val('m_role');
    const status = val('m_status');
    const res = await Api.post('users', {
      fullName: val('m_fullName'), email: val('m_email'), role,
      phone: val('m_phone'), notes: val('m_notes'),
    });

    const extra = Array.from(document.querySelectorAll('.m_extraPerm:checked'))
      .map((cb) => cb.value)
      .filter((p) => !(rolePermissions[role] || []).includes(p));

    if (extra.length || status !== 'active') {
      const updates = {};
      if (extra.length) updates.permissionOverrides = { add: extra, remove: [] };
      if (status !== 'active') updates.status = status;
      await Api.post('users-update', { userId: res.user.userId, updates });
    }

    renderView('users');
    setTimeout(() => alert(`User created. Temporary password (share securely):\n\n${res.temporaryPassword}`), 200);
  });
}

/* ---------------- Admin: Admin History (Audit Log) ---------------- */
// Shared by Admin History, Security & Access Logs, Import History, and
// Export History — those are all just this same real, filterable view
// against the real backend, pre-scoped to a relevant slice of it. See
// section 1 of the spec: this satisfies each listed Admin Panel screen
// without four near-duplicate implementations.
async function renderAudit(presetFilters = {}, subtitle) {
  let usersForFilter = [];
  if (can('manage_users')) {
    try { usersForFilter = (await Api.get('users')).users; } catch {}
  }
  const lockedCategory = !!presetFilters.actionCategory;

  content.innerHTML = `
    ${subtitle ? `<p class="hint-text">${esc(subtitle)}</p>` : ''}
    <div class="toolbar" style="align-items:flex-end;">
      <div><label style="display:block;font-size:.78rem;">From</label><input type="date" id="f_from"></div>
      <div><label style="display:block;font-size:.78rem;">To</label><input type="date" id="f_to"></div>
      <div><label style="display:block;font-size:.78rem;">User</label>
        <select id="f_user"><option value="">All users</option>
          ${usersForFilter.map((u) => `<option value="${esc(u.userId)}">${esc(u.fullName)}</option>`).join('')}
        </select>
      </div>
      <div><label style="display:block;font-size:.78rem;">Role</label>
        <select id="f_role"><option value="">All roles</option>
          <option value="super_admin">Super Admin</option><option value="admin">Admin</option><option value="staff">Staff</option>
        </select>
      </div>
      ${!lockedCategory ? `<div><label style="display:block;font-size:.78rem;">Category</label>
        <select id="f_category"><option value="">All categories</option>
          <option value="user_management">User Management</option><option value="auth">Auth</option>
          <option value="security">Security</option><option value="contacts">Contacts</option>
          <option value="donations">Donations</option><option value="volunteers">Volunteers</option>
          <option value="import_export">Import/Export</option><option value="system">System</option>
        </select>
      </div>` : ''}
      <div><label style="display:block;font-size:.78rem;">Result</label>
        <select id="f_success"><option value="">Any</option><option value="true">Success</option><option value="false">Failed</option></select>
      </div>
      <div><label style="display:block;font-size:.78rem;">Contact ID</label><input id="f_contactId" placeholder="CT-…"></div>
      <div><label style="display:block;font-size:.78rem;">Import Batch</label><input id="f_importBatchId"></div>
      <div><label style="display:block;font-size:.78rem;">Export ID</label><input id="f_exportId"></div>
      <div style="flex:1;min-width:180px;"><label style="display:block;font-size:.78rem;">Keyword</label><input id="f_q" placeholder="Search description, user, action…"></div>
      <button class="secondary" id="auditSearchBtn">Search</button>
      ${currentUser.role === 'super_admin' ? '<button class="ghost" id="clearActivityBtn">Clear Recent Activity</button>' : ''}
    </div>
    <div id="auditResults">Loading…</div>
  `;

  document.getElementById('auditSearchBtn').addEventListener('click', () => loadAudit(presetFilters));
  const clearBtn = document.getElementById('clearActivityBtn');
  if (clearBtn) clearBtn.addEventListener('click', () => clearAuditActivity(() => loadAudit(presetFilters)));
  await loadAudit(presetFilters);
}

async function loadAudit(presetFilters = {}) {
  const val2 = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
  const params = new URLSearchParams();
  if (presetFilters.actionCategory) params.set('actionCategory', presetFilters.actionCategory);
  else if (val2('f_category')) params.set('actionCategory', val2('f_category'));
  if (presetFilters.actionContains) params.set('actionContains', presetFilters.actionContains);
  if (val2('f_from')) params.set('from', `${val2('f_from')}T00:00:00.000Z`);
  if (val2('f_to')) params.set('to', `${val2('f_to')}T23:59:59.999Z`);
  if (val2('f_user')) params.set('userId', val2('f_user'));
  if (val2('f_role')) params.set('userRole', val2('f_role'));
  if (val2('f_success')) params.set('success', val2('f_success'));
  if (val2('f_contactId')) params.set('contactId', val2('f_contactId'));
  if (val2('f_importBatchId')) params.set('importBatchId', val2('f_importBatchId'));
  if (val2('f_exportId')) params.set('exportId', val2('f_exportId'));
  if (val2('f_q')) params.set('q', val2('f_q'));

  const { events } = await Api.get(`audit?${params.toString()}`);
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

/* ---------------- Admin: Roles & Permissions ---------------- */
async function renderRoles() {
  const [{ users }, { permissions, rolePermissions }] = await Promise.all([
    Api.get('users'),
    Api.get('permissions'),
  ]);

  content.innerHTML = `
    <p class="hint-text">Default permissions per role are fixed by the system. A Super Admin can additionally grant or revoke individual permissions per user below.</p>
    <h3 style="color: var(--su-navy);">Role Defaults</h3>
    <table><thead><tr><th>Permission</th><th>Super Admin</th><th>Admin</th><th>Staff</th></tr></thead>
    <tbody>
      ${permissions.map((p) => `<tr>
        <td>${esc(p)}</td>
        <td>${rolePermissions.super_admin.includes(p) ? '✓' : ''}</td>
        <td>${rolePermissions.admin.includes(p) ? '✓' : ''}</td>
        <td>${rolePermissions.staff.includes(p) ? '✓' : ''}</td>
      </tr>`).join('')}
    </tbody></table>

    <h3 style="color: var(--su-navy); margin-top: 24px;">Per-User Overrides</h3>
    <table><thead><tr><th>Name</th><th>Role</th><th>Overrides</th><th>Actions</th></tr></thead>
    <tbody>
      ${users.map((u) => {
        const add = (u.permissionOverrides && u.permissionOverrides.add) || [];
        const remove = (u.permissionOverrides && u.permissionOverrides.remove) || [];
        const overrideSummary = [
          ...add.map((p) => `+${p}`),
          ...remove.map((p) => `−${p}`),
        ].join(', ') || '—';
        return `<tr>
          <td>${esc(u.fullName)}</td><td><span class="badge role">${esc(u.role.replace('_', ' '))}</span></td>
          <td>${esc(overrideSummary)}</td>
          <td>${currentUser.role === 'super_admin' ? `<button class="ghost" data-editperms="${u.userId}">Edit Permissions</button>` : ''}</td>
        </tr>`;
      }).join('')}
    </tbody></table>
  `;

  content.querySelectorAll('[data-editperms]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const u = users.find((x) => x.userId === btn.dataset.editperms);
      showEditPermissionsModal(u, permissions, rolePermissions);
    });
  });
}

function showEditPermissionsModal(user, permissions, rolePermissions) {
  const roleDefaults = new Set(rolePermissions[user.role] || []);
  const add = new Set((user.permissionOverrides && user.permissionOverrides.add) || []);
  const remove = new Set((user.permissionOverrides && user.permissionOverrides.remove) || []);
  const effective = (p) => (remove.has(p) ? false : add.has(p) ? true : roleDefaults.has(p));

  showModal(`
    <h3>Edit Permissions — ${esc(user.fullName)}</h3>
    <p class="hint-text">Role: ${esc(user.role.replace('_', ' '))}. Checked = this user currently has this permission.</p>
    <div style="max-height: 320px; overflow-y: auto; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px;">
      ${permissions.map((p) => `
        <label style="display:flex; align-items:center; gap:6px; font-weight:normal;">
          <input type="checkbox" class="permCheck" value="${esc(p)}" ${effective(p) ? 'checked' : ''}>
          ${esc(p)}${roleDefaults.has(p) ? ' <span class="hint-text">(role default)</span>' : ''}
        </label>`).join('')}
    </div>
  `, async () => {
    const newAdd = [];
    const newRemove = [];
    document.querySelectorAll('.permCheck').forEach((cb) => {
      const p = cb.value;
      const isDefault = roleDefaults.has(p);
      if (cb.checked && !isDefault) newAdd.push(p);
      if (!cb.checked && isDefault) newRemove.push(p);
    });
    await Api.post('users-update', {
      userId: user.userId,
      updates: { permissionOverrides: { add: newAdd, remove: newRemove } },
    });
    renderView('roles');
  });
}

/* ---------------- Admin: System Activity ---------------- */
async function renderSystemActivity() {
  const stats = [];
  let events = [];
  if (can('manage_users')) {
    const { users } = await Api.get('users');
    stats.push({ label: 'Active Users', value: users.filter((u) => u.status === 'active').length });
    stats.push({ label: 'Inactive / Suspended Users', value: users.filter((u) => u.status !== 'active').length });
  }
  if (can('view_audit_history')) {
    ({ events } = await Api.get('audit?limit=1000'));
  }

  const since = (hours) => Date.now() - hours * 60 * 60 * 1000;
  const inLastHours = (e, hours) => new Date(e.timestamp).getTime() >= since(hours);
  const failedLogins24h = events.filter((e) => e.action === 'login_failed' && inLastHours(e, 24)).length;
  const lockouts24h = events.filter((e) => e.action === 'account_locked' && inLastHours(e, 24)).length;
  const imports24h = events.filter((e) => e.action === 'contacts_imported' && inLastHours(e, 24)).length;
  const exports24h = events.filter((e) => e.action === 'contacts_exported' && inLastHours(e, 24)).length;
  stats.push({ label: 'Failed Logins (24h)', value: failedLogins24h });
  stats.push({ label: 'Account Lockouts (24h)', value: lockouts24h });
  stats.push({ label: 'Imports (24h)', value: imports24h });
  stats.push({ label: 'Exports (24h)', value: exports24h });

  const recent = events.slice(0, 15);

  content.innerHTML = `
    <div class="stat-grid">
      ${stats.map((s) => `<div class="stat-card"><div class="value">${s.value}</div><div class="label">${esc(s.label)}</div></div>`).join('')}
    </div>
    <h3 style="color: var(--su-navy);">Most Recent System Activity</h3>
    <table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Description</th><th>Result</th></tr></thead><tbody>
      ${recent.map((e) => `<tr>
        <td>${esc(new Date(e.timestamp).toLocaleString())}</td>
        <td>${esc(e.userName || 'System')}</td>
        <td>${esc(e.action)}</td>
        <td>${esc(e.description)}</td>
        <td><span class="badge ${e.success ? 'active' : 'inactive'}">${e.success ? 'Success' : 'Failed'}</span></td>
      </tr>`).join('') || '<tr><td colspan="5">No activity yet.</td></tr>'}
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
