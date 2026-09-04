const { usersStore } = require('./_lib/stores');
const { requirePermission, jsonResponse } = require('./_lib/rbac');
const { logEvent } = require('./_lib/auditLogger');
const { revokeAllSessionsForUser } = require('./_lib/session');

function sanitize(user) {
  const { passwordHash, ...safe } = user;
  return safe;
}

// Handles: role change, status change (deactivate/reactivate/suspend),
// notes/phone/name updates. One endpoint, but every distinct kind of
// change gets its own audit action + previous/new value pair, per the
// Admin History spec.
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const gate = await requirePermission(event, 'manage_users');
  if (gate.error) return gate.error;
  const actingUser = gate.user;

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { error: 'Invalid request body' });
  }

  const { userId, updates } = body;
  if (!userId || !updates || typeof updates !== 'object') {
    return jsonResponse(400, { error: 'userId and updates are required' });
  }

  const store = usersStore();
  const target = await store.get(userId, { type: 'json' });
  if (!target) return jsonResponse(404, { error: 'User not found' });

  // Only a Super Admin can modify a Super Admin, and only a Super Admin
  // can promote someone TO Super Admin.
  if (
    (target.role === 'super_admin' || updates.role === 'super_admin') &&
    actingUser.role !== 'super_admin'
  ) {
    return jsonResponse(403, { error: 'Only a Super Admin can modify Super Admin accounts' });
  }

  const allowedFields = ['role', 'status', 'fullName', 'phone', 'notes', 'permissionOverrides'];
  let sessionsShouldBeRevoked = false;

  for (const field of allowedFields) {
    if (!(field in updates)) continue;
    const previousValue = target[field];
    const newValue = updates[field];
    if (JSON.stringify(previousValue) === JSON.stringify(newValue)) continue;

    target[field] = newValue;

    let action;
    if (field === 'role') action = 'user_role_changed';
    else if (field === 'status') action = `user_${newValue}`; // e.g. user_deactivated, user_reactivated, user_suspended
    else if (field === 'permissionOverrides') action = 'user_permissions_changed';
    else action = 'user_account_updated';

    if (field === 'role' || field === 'status' || field === 'permissionOverrides') {
      sessionsShouldBeRevoked = true;
    }

    await logEvent({
      user: actingUser,
      action,
      actionCategory: 'user_management',
      description: `${actingUser.fullName} changed ${field} for ${target.fullName}`,
      targetType: 'user',
      targetId: target.userId,
      previousValue,
      newValue,
      success: true,
    });
  }

  target.updatedAt = new Date().toISOString();
  target.updatedBy = actingUser.userId;
  await store.setJSON(userId, target);

  // A role, status, or permission change invalidates existing sessions so
  // the new access level takes effect immediately, not on next natural expiry.
  if (sessionsShouldBeRevoked) {
    await revokeAllSessionsForUser(userId);
    await logEvent({
      user: actingUser,
      action: 'sessions_revoked',
      actionCategory: 'auth',
      description: `Sessions for ${target.fullName} revoked following account change`,
      targetType: 'user',
      targetId: target.userId,
      success: true,
    });
  }

  return jsonResponse(200, { user: sanitize(target) });
};
