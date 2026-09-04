const crypto = require('crypto');
const { usersStore } = require('./_lib/stores');
const { hashPassword } = require('./_lib/hash');
const { requirePermission, jsonResponse } = require('./_lib/rbac');
const { logEvent } = require('./_lib/auditLogger');
const { revokeAllSessionsForUser } = require('./_lib/session');

// Admin-initiated reset: generates a fresh random temporary password,
// hashes it, forces a change on next login, and revokes existing
// sessions. The plaintext temp password is returned once in this
// response for the admin to relay securely — it is never stored or
// logged anywhere.
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

  const { userId } = body;
  if (!userId) return jsonResponse(400, { error: 'userId is required' });

  const store = usersStore();
  const target = await store.get(userId, { type: 'json' });
  if (!target) return jsonResponse(404, { error: 'User not found' });

  if (target.role === 'super_admin' && actingUser.role !== 'super_admin') {
    return jsonResponse(403, { error: 'Only a Super Admin can reset a Super Admin password' });
  }

  const tempPassword = crypto.randomBytes(9).toString('base64url');
  target.passwordHash = hashPassword(tempPassword);
  target.mustChangePassword = true;
  target.updatedAt = new Date().toISOString();
  target.updatedBy = actingUser.userId;
  await store.setJSON(userId, target);

  await revokeAllSessionsForUser(userId);

  await logEvent({
    user: actingUser,
    action: 'password_reset_initiated',
    actionCategory: 'auth',
    description: `${actingUser.fullName} reset the password for ${target.fullName}`,
    targetType: 'user',
    targetId: target.userId,
    success: true,
  });

  return jsonResponse(200, { temporaryPassword: tempPassword });
};
