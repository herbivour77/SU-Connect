const { initBlobs, usersStore } = require('./_lib/stores');
const { verifyPassword } = require('./_lib/hash');
const { createSession, setSessionCookieHeader } = require('./_lib/session');
const { logEvent } = require('./_lib/auditLogger');
const { jsonResponse } = require('./_lib/rbac');
const { checkLock, recordFailure, clearAttempts, MAX_ATTEMPTS } = require('./_lib/rateLimiter');

function clientIp(event) {
  return (
    event.headers['x-nf-client-connection-ip'] ||
    (event.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    null
  );
}

// Brute-force / credential-stuffing protection: tracked per-email (stops
// repeated guessing against one account) AND per-IP (stops one source
// hammering many different emails). Either lock blocks the attempt.
// Every lockout is itself audit-logged as a security event.
exports.handler = async (event) => {
  initBlobs(event);
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

  const emailKey = `email:${String(email).toLowerCase()}`;
  const ipKey = ip ? `ip:${ip}` : null;

  const emailLock = await checkLock(emailKey);
  const ipLock = ipKey ? await checkLock(ipKey) : { locked: false };
  if (emailLock.locked || ipLock.locked) {
    await logEvent({
      user: null,
      action: 'login_blocked',
      actionCategory: 'security',
      description: `Login blocked for ${email} — too many recent failed attempts`,
      targetType: 'user',
      ip,
      success: false,
      failureReason: 'Rate limited: too many failed attempts',
    });
    return jsonResponse(429, { error: 'Too many failed attempts. Please try again in a few minutes.' });
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
    const emailState = await recordFailure(emailKey);
    if (ipKey) await recordFailure(ipKey);

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

    if (emailState.justLocked) {
      await logEvent({
        user: null,
        action: 'account_locked',
        actionCategory: 'security',
        description: `${email} temporarily locked after ${MAX_ATTEMPTS} failed login attempts`,
        targetType: 'user',
        targetId: matchedUser ? matchedUser.userId : null,
        ip,
        success: false,
        failureReason: 'Brute-force lockout triggered',
      });
    }

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

  // Successful login clears any accumulated failure count for this
  // email/IP so a legitimate user isn't left half-way to a lockout.
  await clearAttempts(emailKey);
  if (ipKey) await clearAttempts(ipKey);

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
