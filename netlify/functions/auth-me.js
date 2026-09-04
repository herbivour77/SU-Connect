const { getAuthedUser, jsonResponse } = require('./_lib/rbac');
const { effectivePermissions } = require('./_lib/rbac');

exports.handler = async (event) => {
  const user = await getAuthedUser(event);
  if (!user) return jsonResponse(401, { error: 'Not authenticated' });

  const { passwordHash, ...safeUser } = user;
  return jsonResponse(200, {
    user: safeUser,
    permissions: Array.from(effectivePermissions(user)),
  });
};
