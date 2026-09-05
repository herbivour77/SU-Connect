const crypto = require('crypto');
const { initBlobs, contactsStore } = require('./_lib/stores');
const { requirePermission, jsonResponse } = require('./_lib/rbac');
const { logEvent } = require('./_lib/auditLogger');
const { normalizeGender } = require('./contacts');

// Accepts rows already parsed client-side (the browser reads the .xlsx
// with SheetJS and posts plain JSON — no binary parsing happens here).
// Column names are matched loosely so a spreadsheet exported from this
// same tool, or a reasonably-labelled spreadsheet from elsewhere, both work.
//
// Category is free text (see contacts.js) — any non-empty value the
// spreadsheet contains is kept as-is (trimmed, lowercased for
// consistency with categories typed in the UI), not restricted to a
// fixed list, so importing introduces new categories just like typing
// one in the Add Contact form does.
function normalizeRow(raw) {
  const get = (...keys) => {
    for (const k of keys) {
      const hit = Object.keys(raw).find((rk) => rk.trim().toLowerCase() === k);
      if (hit && String(raw[hit]).trim() !== '') return String(raw[hit]).trim();
    }
    return '';
  };

  const category = get('category');

  return {
    fullName: get('full name', 'fullname', 'name'),
    email: get('email', 'email address') || null,
    phone: get('phone', 'phone number', 'mobile') || null,
    gender: normalizeGender(get('gender', 'sex')),
    category: category ? category.toLowerCase() : null,
    notes: get('notes', 'note') || null,
  };
}

exports.handler = async (event) => {
  initBlobs(event);
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const gate = await requirePermission(event, 'import_contacts');
  if (gate.error) return gate.error;
  const actingUser = gate.user;

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { error: 'Invalid request body' });
  }

  const { rows } = body;
  if (!Array.isArray(rows) || !rows.length) {
    return jsonResponse(400, { error: 'rows must be a non-empty array' });
  }
  if (rows.length > 5000) {
    return jsonResponse(400, { error: 'Import is limited to 5000 rows at a time' });
  }

  const store = contactsStore();
  const { blobs } = await store.list();
  const existing = (await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })))).filter(Boolean);
  const existingEmails = new Set(existing.filter((c) => c.email).map((c) => c.email.toLowerCase()));

  const importBatchId = crypto.randomUUID();
  const now = new Date().toISOString();
  const created = [];
  const skipped = [];

  for (const raw of rows) {
    const row = normalizeRow(raw);
    if (!row.fullName) {
      skipped.push({ row: raw, reason: 'Missing full name' });
      continue;
    }
    if (row.email && existingEmails.has(row.email.toLowerCase())) {
      skipped.push({ row: raw, reason: `Duplicate email: ${row.email}` });
      continue;
    }

    const contactId = `CT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const contact = {
      contactId,
      fullName: row.fullName,
      email: row.email,
      phone: row.phone,
      gender: row.gender,
      category: row.category,
      notes: row.notes,
      archived: false,
      createdAt: now,
      createdBy: actingUser.userId,
      importBatchId,
    };
    await store.setJSON(contactId, contact);
    created.push(contact);
    if (row.email) existingEmails.add(row.email.toLowerCase());
  }

  await logEvent({
    user: actingUser,
    action: 'contacts_imported',
    actionCategory: 'import_export',
    description: `${actingUser.fullName} imported ${created.length} contact(s) from Excel (${skipped.length} skipped)`,
    targetType: 'contact',
    importBatchId,
    newValue: { created: created.length, skipped: skipped.length },
    success: true,
  });

  return jsonResponse(200, {
    importBatchId,
    createdCount: created.length,
    skippedCount: skipped.length,
    skipped: skipped.slice(0, 50), // don't blow up the response for huge imports
  });
};
