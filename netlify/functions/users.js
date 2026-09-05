const crypto = require('crypto');
const { initBlobs, usersStore } = require('./_lib/stores');
const { hashPassword } = require('./_lib/hash');
const { requirePermission, jsonResponse } = require('./_lib/rbac');
const { logEvent } = require('./_lib/auditLogger');
const { revokeAllSessionsForUser } = require('./_lib/session');

function sanitize(user) {
  const { passwordHash, ...safe } = user;
  return safe;
}

exports.handler = async (event) => {
  initBlobs(event);
  if (event.httpMethod === 'GET') {
    const gate = await requirePermission(event, 'manage_users');
    if (gate.error) return gate.error;

    const store = usersStore();
    const { blobs } = await store.list();
    const users = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })));
    return jsonResponse(200, { users: users.filter(Boolean).map(sanitize) });
  }

  if (event.httpMethod === 'POST') {
    const gate = await requirePermission(event, 'manage_users');
    if (gate.error) return gate.error;
    const actingUser = gate.user;

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { error: 'Invalid request body' });
    }

    const { fullName, email, role, phone, notes, temporaryPassword } = body;

    if (!fullName || !email || !role) {
      return jsonResponse(400, { error: 'fullName, email, and role are required' });
    }
    if (!['super_admin', 'admin', 'staff'].includes(role)) {
      return jsonResponse(400, { error: 'Invalid role' });
    }
    // Only a Super Admin may create another Super Admin.
    if (role === 'super_admin' && actingUser.role !== 'super_admin') {
      return jsonResponse(403, { error: 'Only a Super Admin can create another Super Admin' });
    }

    const store = usersStore();
    const { blobs } = await store.list();
    for (const b of blobs) {
      const existing = await store.get(b.key, { type: 'json' });
      if (existing && existing.email.toLowerCase() === email.toLowerCase()) {
        return jsonResponse(409, { error: 'A user with this email already exists' });
      }
    }

    const userId = crypto.randomUUID();
    const password = temporaryPassword || crypto.randomBytes(9).toString('base64url');
    const now = new Date().toISOString();

    const newUser = {
      userId,
      fullName,
      email,
      role,
      status: 'active',
      phone: phone || null,
      notes: notes || null,
      passwordHash: hashPassword(password),
      mustChangePassword: true,
      permissionOverrides: { add: [], remove: [] },
      createdAt: now,
      createdBy: actingUser.userId,
    };

    await store.setJSON(userId, newUser);

    await logEvent({
      user: actingUser,
      action: 'user_created',
      actionCategory: 'user_management',
      description: `${actingUser.fullName} created user ${fullName} (${role})`,
      targetType: 'user',
      targetId: userId,
      newValue: { fullName, email, role, status: 'active' },
      success: true,
    });

    // The generated temporary password is returned exactly once, to the
    // creating admin, over the same authenticated channel — never stored
    // anywhere in plaintext, never logged, never retrievable again.
    return jsonResponse(201, { user: sanitize(newUser), temporaryPassword: password });
  }

  if (event.httpMethod === 'DELETE') {
    const gate = await requirePermission(event, 'manage_users');
    if (gate.error) return gate.error;
    const actingUser = gate.user;

    let body = {};
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      // DELETE requests sometimes arrive with no body; that's fine as
      // long as userId came in via the query string instead.
    }
    const userId = (event.queryStringParameters || {}).userId || body.userId;
    if (!userId) return jsonResponse(400, { error: 'userId is required' });

    if (userId === actingUser.userId) {
      return jsonResponse(400, { error: 'You cannot delete your own account' });
    }

    const store = usersStore();
    const target = await store.get(userId, { type: 'json' });
    if (!target) return jsonResponse(404, { error: 'User not found' });

    // Only a Super Admin can delete a Super Admin, same rule as editing one.
    if (target.role === 'super_admin' && actingUser.role !== 'super_admin') {
      return jsonResponse(403, { error: 'Only a Super Admin can delete a Super Admin account' });
    }

    // Never allow the system to be left with zero active Super Admins.
    if (target.role === 'super_admin') {
      const { blobs } = await store.list();
      const allUsers = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })));
      const remainingSuperAdmins = allUsers
        .filter(Boolean)
        .filter((u) => u.role === 'super_admin' && u.userId !== userId && u.status === 'active');
      if (remainingSuperAdmins.length === 0) {
        return jsonResponse(400, { error: 'Cannot delete the last remaining active Super Admin' });
      }
    }

    await store.delete(userId);
    await revokeAllSessionsForUser(userId);

    await logEvent({
      user: actingUser,
      action: 'user_deleted',
      actionCategory: 'user_management',
      description: `${actingUser.fullName} deleted user ${target.fullName} (${target.role})`,
      targetType: 'user',
      targetId: userId,
      previousValue: sanitize(target),
      success: true,
    });

    return jsonResponse(200, { ok: true, userId });
  }

  return jsonResponse(405, { error: 'Method not allowed' });
};
