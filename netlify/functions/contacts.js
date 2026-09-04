const crypto = require('crypto');
const { initBlobs, contactsStore } = require('./_lib/stores');
const { requirePermission, jsonResponse } = require('./_lib/rbac');
const { logEvent } = require('./_lib/auditLogger');

exports.handler = async (event) => {
  initBlobs(event);
  const store = contactsStore();

  if (event.httpMethod === 'GET') {
    const gate = await requirePermission(event, 'view_contacts');
    if (gate.error) return gate.error;

    const { blobs } = await store.list();
    const contacts = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })));
    const includeArchived = (event.queryStringParameters || {}).includeArchived === 'true';
    const filtered = contacts.filter(Boolean).filter((c) => includeArchived || !c.archived);
    return jsonResponse(200, { contacts: filtered });
  }

  if (event.httpMethod === 'POST') {
    const gate = await requirePermission(event, 'create_contacts');
    if (gate.error) return gate.error;
    const actingUser = gate.user;

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { error: 'Invalid request body' });
    }

    const { fullName, email, phone, category, notes } = body;
    if (!fullName) return jsonResponse(400, { error: 'fullName is required' });

    const contactId = `CT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const now = new Date().toISOString();
    const contact = {
      contactId,
      fullName,
      email: email || null,
      phone: phone || null,
      category: category || null, // e.g. donor, volunteer, participant, staff
      notes: notes || null,
      archived: false,
      createdAt: now,
      createdBy: actingUser.userId,
    };
    await store.setJSON(contactId, contact);

    await logEvent({
      user: actingUser,
      action: 'contact_created',
      actionCategory: 'contacts',
      description: `${actingUser.fullName} created contact ${fullName}`,
      targetType: 'contact',
      targetId: contactId,
      contactId,
      newValue: contact,
      success: true,
    });

    return jsonResponse(201, { contact });
  }

  return jsonResponse(405, { error: 'Method not allowed' });
};
