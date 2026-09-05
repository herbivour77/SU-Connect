const { initBlobs, usersStore } = require('./_lib/stores');
const { hashPassword, verifyPassword } = require('./_lib/hash');
const { getAuthedUser, jsonResponse } = require('./_lib/rbac');
const { logEvent } = require('./_lib/auditLogger');

exports.handler = async (event) => {
  initBlobs(event);
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const user = await getAuthedUser(event);
  if (!user) return jsonResponse(401, { error: 'Not authenticated' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { error: 'Invalid request body' });
  }

  const { currentPassword, newPassword } = body;
  if (!currentPassword || !newPassword) {
    return jsonResponse(400, { error: 'currentPassword and newPassword are required' });
  }
  if (newPassword.length < 10) {
    return jsonResponse(400, { error: 'New password must be at least 10 characters' });
  }
  if (!verifyPassword(currentPassword, user.passwordHash)) {
    return jsonResponse(401, { error: 'Current password is incorrect' });
  }

  const store = usersStore();
  user.passwordHash = hashPassword(newPassword);
  user.mustChangePassword = false;
  user.updatedAt = new Date().toISOString();
  await store.setJSON(user.userId, user);

  await logEvent({
    user,
    action: 'user_account_updated',
    actionCategory: 'auth',
    description: `${user.fullName} changed their own password`,
    targetType: 'user',
    targetId: user.userId,
    success: true,
  });

  return jsonResponse(200, { ok: true });
};
