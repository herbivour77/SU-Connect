// Admin History / Audit Log writer.
//
// This is the ONLY module that writes to the audit store. No other
// function, and no API endpoint, ever calls store.set/delete on
// su-connect-audit directly — that keeps the log effectively
// append-only at the application layer. There is deliberately no
// "update audit event" or "delete audit event" function exported here.
//
// "Clearing" the log (see clearAuditLog below) does not delete anything.
// It writes a checkpoint timestamp; listEvents() hides events at or
// before that checkpoint. The clear action itself is then logged as a
// brand-new event stamped *after* the checkpoint, so it can never be
// hidden by the very checkpoint it creates — there is always a durable
// record of exactly which Super Admin cleared the view, and when.
const crypto = require('crypto');
const { auditStore } = require('./stores');

const CHECKPOINT_KEY = '__clear_checkpoint__';

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
  const sortedKeys = blobs
    .map((b) => b.key)
    .filter((k) => k !== CHECKPOINT_KEY)
    .sort()
    .reverse();
  const page = sortedKeys.slice(0, limit);
  let events = (await Promise.all(page.map((k) => store.get(k, { type: 'json' })))).filter(Boolean);

  const checkpoint = await store.get(CHECKPOINT_KEY, { type: 'json' });
  if (checkpoint && checkpoint.clearedAt) {
    events = events.filter((e) => e.timestamp >= checkpoint.clearedAt);
  }

  return events;
}

// Super Admin-only action (enforced by the calling endpoint, not here).
// Hides every event up to now behind a checkpoint, then immediately logs
// the clear itself — stamped after the checkpoint — so who-did-it is
// always visible and can't be wiped by a subsequent clear.
async function clearAuditLog(actingUser) {
  const store = auditStore();
  const clearedAt = new Date().toISOString();
  await store.setJSON(CHECKPOINT_KEY, {
    clearedAt,
    clearedBy: actingUser.userId,
    clearedByName: actingUser.fullName,
  });

  return logEvent({
    user: actingUser,
    action: 'audit_log_cleared',
    actionCategory: 'system',
    description: `${actingUser.fullName} cleared the Recent Admin Activity view`,
    targetType: 'audit_log',
    success: true,
  });
}

module.exports = { logEvent, listEvents, clearAuditLog };
