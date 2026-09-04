// Server-side session management.
//
// The session token is an opaque random ID stored in an httpOnly cookie.
// The token itself carries no data — all real session state (user id,
// expiry) lives server-side in Blobs, so a client can never forge or
// tamper with its own permissions by editing the cookie.
const crypto = require('crypto');
const { sessionsStore } = require('./stores');

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const COOKIE_NAME = 'su_connect_session';

function newSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

async function createSession(user, ip) {
  const store = sessionsStore();
  const sessionId = newSessionId();
  const now = Date.now();
  const session = {
    sessionId,
    userId: user.userId,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    ip: ip || null,
  };
  await store.setJSON(sessionId, session);
  return session;
}

async function getSession(sessionId) {
  if (!sessionId) return null;
  const store = sessionsStore();
  const session = await store.get(sessionId, { type: 'json' });
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    await store.delete(sessionId);
    return null;
  }
  return session;
}

async function revokeSession(sessionId) {
  if (!sessionId) return;
  await sessionsStore().delete(sessionId);
}

// Revoke every active session belonging to a user (e.g. on deactivation,
// role change, or forced logout from the Admin Panel).
async function revokeAllSessionsForUser(userId) {
  const store = sessionsStore();
  const { blobs } = await store.list();
  for (const b of blobs) {
    const session = await store.get(b.key, { type: 'json' });
    if (session && session.userId === userId) {
      await store.delete(b.key);
    }
  }
}

function parseCookies(headerValue) {
  const out = {};
  if (!headerValue) return out;
  headerValue.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    out[key] = decodeURIComponent(val);
  });
  return out;
}

function sessionCookieFromRequest(event) {
  const cookies = parseCookies(event.headers.cookie || event.headers.Cookie);
  return cookies[COOKIE_NAME];
}

function setSessionCookieHeader(sessionId, expiresAt) {
  const expires = new Date(expiresAt).toUTCString();
  return `${COOKIE_NAME}=${sessionId}; HttpOnly; Secure; SameSite=Strict; Path=/; Expires=${expires}`;
}

function clearSessionCookieHeader() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

module.exports = {
  COOKIE_NAME,
  createSession,
  getSession,
  revokeSession,
  revokeAllSessionsForUser,
  sessionCookieFromRequest,
  setSessionCookieHeader,
  clearSessionCookieHeader,
};
