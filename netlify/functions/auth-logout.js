const { sessionCookieFromRequest, revokeSession, clearSessionCookieHeader, getSession } = require('./_lib/session');
const { initBlobs, usersStore } = require('./_lib/stores');
const { logEvent } = require('./_lib/auditLogger');
const { jsonResponse } = require('./_lib/rbac');

exports.handler = async (event) => {
  initBlobs(event);
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const sessionId = sessionCookieFromRequest(event);
  const session = await getSession(sessionId);

  if (session) {
    const user = await usersStore().get(session.userId, { type: 'json' });
    await revokeSession(sessionId);
    if (user) {
      await logEvent({
        user,
        action: 'logout',
        actionCategory: 'auth',
        description: `${user.fullName} logged out`,
        targetType: 'user',
        targetId: user.userId,
        success: true,
      });
    }
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearSessionCookieHeader(),
    },
    body: JSON.stringify({ ok: true }),
  };
};
