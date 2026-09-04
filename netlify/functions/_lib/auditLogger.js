// Admin History / Audit Log writer.
//
// This is the ONLY module that writes to the audit store. No other
// function, and no API endpoint, ever calls store.set/delete on
// su-connect-audit directly — that keeps the log effectively
// append-only at the application layer. There is deliberately no
// "update audit event" or "delete audit event" function exported here.
const crypto = require('crypto');
const { auditStore } = require('./stores');

async function logEvent({
  user,           // the acting user object (or null for unauthenticated attempts, e.g. failed login)
  action,         // e.g. 'user_deactivated', 'login_failed', 'contact_created'
  actionCategory, // e.g. 'user_management', 'auth', 'contacts', 'donations', 'volunteers', 'import_export', 'system'
  description,    // human-readable summary
  targetType,     // e.g. 'user', 'contact', 'donation', 'volunteer', 'import_batch'
  targetId,
  contactId,
  importBatchId,
  exportId,
  previousValue,
  newValue,
  ip,
  success = true,
  failureReason,
}) {
  const auditEventId = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  const event = {
    auditEventId,
    timestamp,
    userId: user ? user.userId : null,
    userName: user ? user.fullName : null,
    userEmail: user ? user.email : null,
    userRole: user ? user.role : null,
    action,
    actionCategory,
    description,
    targetType: targetType || null,
    targetId: targetId || null,
    contactId: contactId || null,
    importBatchId: importBatchId || null,
    exportId: exportId || null,
    previousValue: previousValue !== undefined ? previousValue : null,
    newValue: newValue !== undefined ? newValue : null,
    ip: ip || null,
    success,
    failureReason: failureReason || null,
  };

  // Key format sorts chronologically and stays unique under concurrent writes.
  const key = `${timestamp}__${auditEventId}`;
  await auditStore().setJSON(key, event);
  return event;
}

async function listEvents({ limit = 200 } = {}) {
  const store = auditStore();
  const { blobs } = await store.list();
  // Keys are timestamp-prefixed, so sorting keys sorts chronologically.
  const sortedKeys = blobs.map((b) => b.key).sort().reverse();
  const page = sortedKeys.slice(0, limit);
  const events = await Promise.all(page.map((k) => store.get(k, { type: 'json' })));
  return events.filter(Boolean);
}

module.exports = { logEvent, listEvents };
