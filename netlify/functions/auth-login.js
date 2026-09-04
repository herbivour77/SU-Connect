const { usersStore } = require('./_lib/stores');
const { verifyPassword } = require('./_lib/hash');
const { createSession, setSessionCookieHeader } = require('./_lib/session');
const { logEvent } = require('./_lib/auditLogger');
const { jsonResponse } = require('./_lib/rbac');

function clientIp(event) {
  return (
    event.headers['x-nf-client-connection-ip'] ||
    (event.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    null
  );
}

// NOTE ON BRUTE-FORCE PROTECTION: this MVP does not yet implement
// rate limiting/lockout after repeated failed attempts. Every failed
// attempt IS recorded in the audit log (see below) so it's visible to
// admins, but nothing currently blocks a fast retry loop. Before real
// donor/contact data goes into this system, add a per-email and
// per-IP attempt counter (e.g. a small Blobs-backed counter with a
// rolling window) that locks out after N failures. Flagging this
// explicitly rather than shipping a fake/no-op limiter.

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

  const { email, password } = body;
  const ip = clientIp(event);

  if (!email || !password) {
    return jsonResponse(400, { error: 'Email and password are required' });
  }

  const store = usersStore();
  const usersList = await store.list();
  let matchedUser = null;
  for (const b of usersList.blobs) {
    const u = await store.get(b.key, { type: 'json' });
    if (u && u.email && u.email.toLowerCase() === String(email).toLowerCase()) {
      matchedUser = u;
      break;
    }
  }

  if (!matchedUser || !verifyPassword(password, matchedUser.passwordHash)) {
    await logEvent({
      user: null,
      action: 'login_failed',
      actionCategory: 'auth',
      description: `Failed login attempt for ${email}`,
      targetType: 'user',
      targetId: matchedUser ? matchedUser.userId : null,
      ip,
      success: false,
      failureReason: 'Invalid credentials',
    });
    // Same generic message whether the account exists or not, to avoid
    // leaking which emails are registered.
    return jsonResponse(401, { error: 'Invalid email or password' });
  }

  if (matchedUser.status !== 'active') {
    await logEvent({
      user: matchedUser,
      action: 'login_failed',
      actionCategory: 'auth',
      description: `Login attempt for deactivated/suspended account ${email}`,
      targetType: 'user',
      targetId: matchedUser.userId,
      ip,
      success: false,
      failureReason: `Account status: ${matchedUser.status}`,
    });
    return jsonResponse(403, { error: 'This account is not active' });
  }

  const session = await createSession(matchedUser, ip);

  await logEvent({
    user: matchedUser,
    action: 'login',
    actionCategory: 'auth',
    description: `${matchedUser.fullName} logged in`,
    targetType: 'user',
    targetId: matchedUser.userId,
    ip,
    success: true,
  });

  const { passwordHash, ...safeUser } = matchedUser;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': setSessionCookieHeader(session.sessionId, session.expiresAt),
    },
    body: JSON.stringify({ user: safeUser }),
  };
};
