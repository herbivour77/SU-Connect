// Simple Blobs-backed rate limiter for authentication attempts.
//
// This is app-layer brute-force protection: it stops naive fast-retry
// password-guessing and credential-stuffing loops against auth-login.js.
// It is not a substitute for edge/WAF-level rate limiting, but every
// lockout it triggers is itself audit-logged (see auth-login.js), so
// admins always have visibility into it — nothing here is a silent block.
const { loginAttemptsStore } = require('./stores');

const WINDOW_MS = 15 * 60 * 1000; // failures older than this don't count
const LOCKOUT_MS = 15 * 60 * 1000; // how long a lock lasts once triggered
const MAX_ATTEMPTS = 5;

async function checkLock(key) {
  const state = await loginAttemptsStore().get(key, { type: 'json' });
  if (state && state.lockedUntil && state.lockedUntil > Date.now()) {
    return { locked: true, retryAfterMs: state.lockedUntil - Date.now() };
  }
  return { locked: false };
}

async function recordFailure(key) {
  const store = loginAttemptsStore();
  const now = Date.now();
  let state = await store.get(key, { type: 'json' });
  if (!state || now - state.windowStart > WINDOW_MS) {
    state = { windowStart: now, count: 0, lockedUntil: null };
  }
  state.count += 1;
  let justLocked = false;
  if (state.count >= MAX_ATTEMPTS && !(state.lockedUntil && state.lockedUntil > now)) {
    state.lockedUntil = now + LOCKOUT_MS;
    justLocked = true;
  }
  await store.setJSON(key, state);
  return { ...state, justLocked };
}

async function clearAttempts(key) {
  await loginAttemptsStore().delete(key);
}

module.exports = { checkLock, recordFailure, clearAttempts, MAX_ATTEMPTS, LOCKOUT_MS };
