// Central place every function gets its Netlify Blobs stores from.
//
// WHY THE "MissingBlobsEnvironmentError" HAPPENED
// -------------------------------------------------
// Netlify auto-injects Blobs config (site ID + token) into the function
// environment ONLY for Functions API v2 / Edge Functions. These functions
// use the classic `exports.handler = async (event) => {...}` signature,
// which runs in "Lambda compatibility mode" — and in that mode Netlify
// does NOT auto-populate the Blobs context. `getStore('name')` on its own
// then has nothing to read, and throws.
//
// The fix isn't to hand-supply a long-lived NETLIFY_SITE_ID / auth token
// pair (that means managing a Personal Access Token as a secret, and that
// token typically has broad account-wide access). The supported fix for
// Lambda-compatibility functions is `connectLambda(event)`: it reads the
// per-request context Netlify already attaches to the Lambda `event`
// object and wires it up for `getStore()`, with no extra secrets needed.
//
// Every function handler MUST call `initBlobs(event)` as the very first
// line — before any store getter runs, including indirectly (e.g. via
// rbac.js -> getAuthedUser -> usersStore()).
const { getStore, connectLambda } = require('@netlify/blobs');

function initBlobs(event) {
  connectLambda(event);
}

function usersStore() {
  return getStore('su-connect-users');
}

function sessionsStore() {
  return getStore('su-connect-sessions');
}

// Audit log is append-only in *usage* (see auditLogger.js) even though
// the underlying Blobs store technically allows overwrite. No function
// other than auditLogger.js should ever write to this store.
function auditStore() {
  return getStore('su-connect-audit');
}

function contactsStore() {
  return getStore('su-connect-contacts');
}

// Rolling-window brute-force / credential-stuffing counters for the
// login endpoint. Not itself the audit trail — see _lib/rateLimiter.js.
function loginAttemptsStore() {
  return getStore('su-connect-login-attempts');
}

function donationsStore() {
  return getStore('su-connect-donations');
}

function volunteersStore() {
  return getStore('su-connect-volunteers');
}

module.exports = {
  initBlobs,
  usersStore,
  sessionsStore,
  auditStore,
  contactsStore,
  loginAttemptsStore,
  donationsStore,
  volunteersStore,
};
