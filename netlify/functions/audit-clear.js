const { requirePermission, jsonResponse } = require('./_lib/rbac');
const { clearAuditLog } = require('./_lib/auditLogger');
const { initBlobs } = require('./_lib/stores');

// Clears the Recent Admin Activity / Admin History view.
//
// Deliberately restricted to the super_admin ROLE itself, not just the
// 'view_audit_history' or 'manage_users' PERMISSION — permission
// overrides let a Super Admin hand those out to an Admin or Staff
// account, but the ability to clear the activity log should never
// travel with a delegable permission. See _lib/auditLogger.js for how
// "clear" is implemented (checkpoint, not deletion) and why the clearing
// action itself always remains visible afterwards.
exports.handler = async (event) => {
  initBlobs(event);
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const gate = await requirePermission(event, 'view_audit_history');
  if (gate.error) return gate.error;
  const actingUser = gate.user;

  if (actingUser.role !== 'super_admin') {
    return jsonResponse(403, { error: 'Only a Super Admin can clear Admin Activity history' });
  }

  const event_ = await clearAuditLog(actingUser);
  return jsonResponse(200, { ok: true, clearedBy: actingUser.fullName, event: event_ });
};
