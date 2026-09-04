const crypto = require('crypto');
const { usersStore } = require('./_lib/stores');
const { hashPassword } = require('./_lib/hash');
const { requirePermission, jsonResponse } = require('./_lib/rbac');
const { logEvent } = require('./_lib/auditLogger');

function sanitize(user) {
  const { passwordHash, ...safe } = user;
  return safe;
}

exports.handler = async (event) => {
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

  return jsonResponse(405, { error: 'Method not allowed' });
};
