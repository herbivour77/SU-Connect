const crypto = require('crypto');
const { initBlobs, volunteersStore, contactsStore } = require('./_lib/stores');
const { requirePermission, jsonResponse } = require('./_lib/rbac');
const { logEvent } = require('./_lib/auditLogger');

exports.handler = async (event) => {
  initBlobs(event);
  const store = volunteersStore();

  if (event.httpMethod === 'GET') {
    const gate = await requirePermission(event, 'view_volunteers');
    if (gate.error) return gate.error;

    const { blobs } = await store.list();
    const volunteers = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })));
    return jsonResponse(200, { volunteers: volunteers.filter(Boolean) });
  }

  if (event.httpMethod === 'POST') {
    const gate = await requirePermission(event, 'create_volunteers');
    if (gate.error) return gate.error;
    const actingUser = gate.user;

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { error: 'Invalid request body' });
    }

    const { contactId, role, programme, status, notes } = body;
    if (!contactId || !role) return jsonResponse(400, { error: 'contactId and role are required' });

    const contact = await contactsStore().get(contactId, { type: 'json' });
    if (!contact) return jsonResponse(404, { error: 'Linked contact not found' });

    const volunteerRecordId = `VL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const now = new Date().toISOString();
    const record = {
      volunteerRecordId,
      contactId,
      role,
      programme: programme || null, // e.g. Camp Alight, SUPA Camp
      status: status || 'active',
      notes: notes || null,
      createdAt: now,
      createdBy: actingUser.userId,
    };
    await store.setJSON(volunteerRecordId, record);

    await logEvent({
      user: actingUser,
      action: 'volunteer_record_created',
      actionCategory: 'volunteers',
      description: `${actingUser.fullName} added ${contact.fullName} as a volunteer (${role})`,
      targetType: 'volunteer',
      targetId: volunteerRecordId,
      contactId,
      newValue: record,
      success: true,
    });

    return jsonResponse(201, { volunteer: record });
  }

  if (event.httpMethod === 'DELETE') {
    const gate = await requirePermission(event, 'edit_volunteers');
    if (gate.error) return gate.error;
    const actingUser = gate.user;

    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch {}
    const volunteerRecordId = (event.queryStringParameters || {}).volunteerRecordId || body.volunteerRecordId;
    if (!volunteerRecordId) return jsonResponse(400, { error: 'volunteerRecordId is required' });

    const record = await store.get(volunteerRecordId, { type: 'json' });
    if (!record) return jsonResponse(404, { error: 'Volunteer record not found' });

    await store.delete(volunteerRecordId);

    await logEvent({
      user: actingUser,
      action: 'volunteer_record_deleted',
      actionCategory: 'volunteers',
      description: `${actingUser.fullName} deleted a volunteer record (${record.role})`,
      targetType: 'volunteer',
      targetId: volunteerRecordId,
      contactId: record.contactId || null,
      previousValue: record,
      success: true,
    });

    return jsonResponse(200, { ok: true, volunteerRecordId });
  }

  return jsonResponse(405, { error: 'Method not allowed' });
};
