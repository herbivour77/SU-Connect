const { requirePermission, jsonResponse } = require('./_lib/rbac');
const { listEvents } = require('./_lib/auditLogger');

// Read-only. There is intentionally no write/delete path exposed here —
// see _lib/auditLogger.js for why.
exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const gate = await requirePermission(event, 'view_audit_history');
  if (gate.error) return gate.error;

  const params = event.queryStringParameters || {};
  let events = await listEvents({ limit: 1000 });

  if (params.userId) events = events.filter((e) => e.userId === params.userId);
  if (params.action) events = events.filter((e) => e.action === params.action);
  if (params.actionCategory) events = events.filter((e) => e.actionCategory === params.actionCategory);
  if (params.targetType) events = events.filter((e) => e.targetType === params.targetType);
  if (params.contactId) events = events.filter((e) => e.contactId === params.contactId);
  if (params.success) events = events.filter((e) => String(e.success) === params.success);
  if (params.from) events = events.filter((e) => e.timestamp >= params.from);
  if (params.to) events = events.filter((e) => e.timestamp <= params.to);
  if (params.q) {
    const q = params.q.toLowerCase();
    events = events.filter(
      (e) =>
        (e.description || '').toLowerCase().includes(q) ||
        (e.userName || '').toLowerCase().includes(q) ||
        (e.action || '').toLowerCase().includes(q)
    );
  }

  const limit = Math.min(parseInt(params.limit, 10) || 200, 1000);
  return jsonResponse(200, { events: events.slice(0, limit) });
};
