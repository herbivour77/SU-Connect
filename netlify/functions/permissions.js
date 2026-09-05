const { initBlobs } = require('./_lib/stores');
const { requirePermission, jsonResponse, PERMISSIONS, ROLE_PERMISSIONS } = require('./_lib/rbac');

// Single source of truth for the permission catalog lives in _lib/rbac.js.
// The frontend never hardcodes a permission list — it always reads it
// from here, so the Roles & Permissions screen can never drift out of
// sync with what the server actually enforces.
exports.handler = async (event) => {
  initBlobs(event);
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const gate = await requirePermission(event, 'manage_users');
  if (gate.error) return gate.error;

  return jsonResponse(200, { permissions: PERMISSIONS, rolePermissions: ROLE_PERMISSIONS });
};
