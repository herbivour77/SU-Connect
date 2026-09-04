// One-time bootstrap endpoint: creates the first Super Admin account.
//
// This is NOT a hardcoded credential check in the app's auth path —
// auth-login.js never contains a special case for any particular user.
// Instead, this endpoint runs once, writes a normal hashed-password user
// record via the same hashPassword() every other user goes through, and
// then permanently refuses to run again once any user exists.
//
// Protected by a setup token from an environment variable (SEED_TOKEN)
// so it can't be triggered by a stranger who finds the URL. Set
// SEED_TOKEN in the Netlify site's environment variables before first
// deploy, call this endpoint once, then you may leave SEED_TOKEN set
// (the "already seeded" check below makes repeat calls a no-op) or
// remove it — either is fine.
const crypto = require('crypto');
const { usersStore } = require('./_lib/stores');
const { hashPassword } = require('./_lib/hash');
const { logEvent } = require('./_lib/auditLogger');
const { jsonResponse } = require('./_lib/rbac');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { error: 'Invalid request body' });
  }

  const { setupToken, fullName, email, password } = body;

  if (!process.env.SEED_TOKEN || setupToken !== process.env.SEED_TOKEN) {
    return jsonResponse(403, { error: 'Invalid or missing setup token' });
  }

  const store = usersStore();
  const { blobs } = await store.list();
  if (blobs.length > 0) {
    return jsonResponse(409, { error: 'Setup already completed — a user already exists. This endpoint is now inert.' });
  }

  if (!fullName || !email || !password) {
    return jsonResponse(400, { error: 'fullName, email, and password are required' });
  }
  if (password.length < 4) {
    return jsonResponse(400, { error: 'Password is too short' });
  }

  const userId = crypto.randomUUID();
  const now = new Date().toISOString();
  const superAdmin = {
    userId,
    fullName,
    email,
    role: 'super_admin',
    status: 'active',
    phone: null,
    notes: 'Initial Super Admin created via setup.',
    passwordHash: hashPassword(password),
    mustChangePassword: true,
    permissionOverrides: { add: [], remove: [] },
    createdAt: now,
    createdBy: null,
  };
  await store.setJSON(userId, superAdmin);

  await logEvent({
    user: superAdmin,
    action: 'user_created',
    actionCategory: 'user_management',
    description: `Initial Super Admin ${fullName} created via setup`,
    targetType: 'user',
    targetId: userId,
    newValue: { fullName, email, role: 'super_admin' },
    success: true,
  });

  const { passwordHash, ...safe } = superAdmin;
  return jsonResponse(201, { user: safe });
};
