const XLSX = require('xlsx');
const { initBlobs, contactsStore } = require('./_lib/stores');
const { requirePermission, jsonResponse } = require('./_lib/rbac');
const { logEvent } = require('./_lib/auditLogger');

const COLUMNS = ['contactId', 'fullName', 'category', 'email', 'phone', 'notes', 'archived', 'createdAt'];
const HEADERS = ['Contact ID', 'Full Name', 'Category', 'Email', 'Phone', 'Notes', 'Archived', 'Created At'];

exports.handler = async (event) => {
  initBlobs(event);
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const gate = await requirePermission(event, 'export_contacts');
  if (gate.error) return gate.error;
  const actingUser = gate.user;

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { error: 'Invalid request body' });
  }

  // contactIds omitted or empty => export everything the caller can see.
  const contactIds = Array.isArray(body.contactIds) && body.contactIds.length ? new Set(body.contactIds) : null;
  const includeArchived = body.includeArchived !== false; // default true for exports

  const store = contactsStore();
  const { blobs } = await store.list();
  let contacts = (await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })))).filter(Boolean);

  if (!includeArchived) contacts = contacts.filter((c) => !c.archived);
  if (contactIds) contacts = contacts.filter((c) => contactIds.has(c.contactId));

  const rows = contacts.map((c) => [
    c.contactId, c.fullName, c.category || '', c.email || '', c.phone || '',
    c.notes || '', c.archived ? 'Yes' : 'No', c.createdAt || '',
  ]);

  const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...rows]);
  ws['!cols'] = COLUMNS.map(() => ({ wch: 22 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Contacts');
  const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });

  const exportId = `EXP-${Date.now()}`;
  await logEvent({
    user: actingUser,
    action: 'contacts_exported',
    actionCategory: 'import_export',
    description: `${actingUser.fullName} exported ${contacts.length} contact(s) to Excel${contactIds ? ' (selected)' : ' (all)'}`,
    targetType: 'contact',
    exportId,
    newValue: { count: contacts.length, selected: !!contactIds },
    success: true,
  });

  const filename = `contacts-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
    isBase64Encoded: true,
    body: base64,
  };
};
