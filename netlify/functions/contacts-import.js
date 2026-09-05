const crypto = require('crypto');
const { initBlobs, contactsStore } = require('./_lib/stores');
const { requirePermission, jsonResponse } = require('./_lib/rbac');
const { logEvent } = require('./_lib/auditLogger');
const { normalizeGender } = require('./contacts');

// Accepts rows already parsed client-side (the browser reads the .xlsx
// with SheetJS and posts plain JSON — no binary parsing happens here).
//
// `columnMap` (optional) is a { fullName, email, phone, category, gender,
// notes } object of ACTUAL column headers from the uploaded file, chosen
// by the person via the mapping step in the UI before import runs. When
// present it's used verbatim — no guessing. This exists because guessing
// header names (e.g. "Full Name" vs "Name" vs "Full Name (English)" vs
// something else entirely) is inherently fragile against real-world
// spreadsheets; asking the person once is the only fix that reliably works
// for every file. If no columnMap is sent (e.g. an older client, or a
// programmatic caller), we fall back to matching a handful of common
// header spellings, same as before.
//
// Category is free text (see contacts.js) — any non-empty value the
// spreadsheet contains is kept as-is (trimmed, lowercased for
// consistency with categories typed in the UI), not restricted to a
// fixed list, so importing introduces new categories just like typing
// one in the Add Contact form does.
function normalizeRow(raw, columnMap) {
  const byHeader = (header) => {
    if (!header) return '';
    const hit = Object.keys(raw).find((rk) => rk === header);
    return hit && String(raw[hit]).trim() !== '' ? String(raw[hit]).trim() : '';
  };
  const byGuess = (...keys) => {
    for (const k of keys) {
      const hit = Object.keys(raw).find((rk) => rk.trim().toLowerCase() === k);
      if (hit && String(raw[hit]).trim() !== '') return String(raw[hit]).trim();
    }
    return '';
  };

  const get = (mappedField, ...guessKeys) =>
    (columnMap && columnMap[mappedField]) ? byHeader(columnMap[mappedField]) : byGuess(...guessKeys);

  const category = get('category', 'category');

  return {
    fullName: get('fullName', 'full name', 'fullname', 'name'),
    email: get('email', 'email', 'email address') || null,
    phone: get('phone', 'phone', 'phone number', 'mobile') || null,
    gender: normalizeGender(get('gender', 'gender', 'sex')),
    category: category ? category.toLowerCase() : null,
    notes: get('notes', 'notes', 'note') || null,
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

  const { rows, columnMap } = body;
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

  // Writes are parallelized in bounded chunks rather than one at a time.
  // A single Netlify Function invocation has a hard wall-clock timeout
  // (10s by default, up to 26s max even on paid plans); at a few hundred
  // rows, writing sequentially can approach or exceed that on a large
  // import and leave it silently incomplete partway through. Chunked
  // concurrency keeps each request fast without hammering the store with
  // thousands of simultaneous requests at once. The client additionally
  // splits very large files into multiple smaller requests — see
  // contacts:showImportColumnMappingModal in app.js — so no single
  // request needs to write more than a few hundred rows regardless of
  // how big the uploaded file is.
  const WRITE_CONCURRENCY = 25;
  for (let i = 0; i < rows.length; i += WRITE_CONCURRENCY) {
    const chunk = rows.slice(i, i + WRITE_CONCURRENCY);
    await Promise.all(chunk.map(async (raw) => {
      const row = normalizeRow(raw, columnMap);
      if (!row.fullName) {
        skipped.push({ row: raw, reason: 'Missing full name' });
        return;
      }
      if (row.email && existingEmails.has(row.email.toLowerCase())) {
        skipped.push({ row: raw, reason: `Duplicate email: ${row.email}` });
        return;
      }
      // Reserve the email within this chunk immediately (not after the
      // write completes) so two rows in the same chunk that share an
      // email can't both slip past the check while their writes are
      // in flight concurrently.
      if (row.email) existingEmails.add(row.email.toLowerCase());

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
    }));
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
