// Role-Based Access Control.
//
// IMPORTANT: this is the *only* place permission decisions are made.
// Every function must call requirePermission()/getAuthedUser() before
// doing anything — never trust a role or permission sent by the client.
// Hiding a button in the frontend is not security; this file is the
// actual security.
const { getSession, sessionCookieFromRequest } = require('./session');
const { usersStore } = require('./stores');

const PERMISSIONS = [
  'view_contacts', 'create_contacts', 'edit_contacts', 'archive_contacts', 'merge_contacts',
  'view_activities', 'create_activities', 'edit_activities',
  'import_contacts', 'import_activities', 'export_contacts', 'export_activities',
  'view_donations', 'create_donations', 'edit_donations',
  'view_volunteers', 'create_volunteers', 'edit_volunteers',
  'manage_users', 'view_audit_history', 'manage_system_settings',
];

const ROLE_PERMISSIONS = {
  super_admin: PERMISSIONS.slice(), // everything
  admin: [
    'view_contacts', 'create_contacts', 'edit_contacts', 'archive_contacts', 'merge_contacts',
    'view_activities', 'create_activities', 'edit_activities',
    'import_contacts', 'import_activities', 'export_contacts', 'export_activities',
    'view_donations', 'create_donations', 'edit_donations',
    'view_volunteers', 'create_volunteers', 'edit_volunteers',
    'view_audit_history',
  ],
  staff: [
    'view_contacts', 'create_contacts', 'edit_contacts',
    'view_activities', 'create_activities',
    'view_volunteers',
  ],
};

// Per-user permission overrides are supported: a user record may carry
// `permissionOverrides: { add: [...], remove: [...] }` set by a Super
// Admin, on top of their role's defaults.
function effectivePermissions(user) {
  const base = new Set(ROLE_PERMISSIONS[user.role] || []);
  const overrides = user.permissionOverrides || {};
  (overrides.add || []).forEach((p) => base.add(p));
  (overrides.remove || []).forEach((p) => base.delete(p));
  return base;
}

function userHasPermission(user, permission) {
  return effectivePermissions(user).has(permission);
}

// Resolves the calling user from their session cookie, or null.
// Returns null (not an error) for anonymous/invalid/expired sessions —
// callers decide whether that's acceptable for the endpoint in question.
async function getAuthedUser(event) {
  const sessionId = sessionCookieFromRequest(event);
  const session = await getSession(sessionId);
  if (!session) return null;

  const user = await usersStore().get(session.userId, { type: 'json' });
  if (!user || user.status !== 'active') return null;

  return user;
}

// Standard guard for a function handler:
//   const gate = await requirePermission(event, 'manage_users');
//   if (gate.error) return gate.error;
//   const user = gate.user;
function jsonResponse(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
    body: JSON.stringify(body),
  };
}

async function requirePermission(event, permission) {
  const user = await getAuthedUser(event);
  if (!user) {
    return { error: jsonResponse(401, { error: 'Not authenticated' }) };
  }
  if (permission && !userHasPermission(user, permission)) {
    return { error: jsonResponse(403, { error: 'Forbidden — insufficient permissions' }) };
  }
  return { user };
}

module.exports = {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  effectivePermissions,
  userHasPermission,
  getAuthedUser,
  requirePermission,
  jsonResponse,
};
