const { initBlobs, contactsStore } = require('./_lib/stores');
const { requirePermission, jsonResponse } = require('./_lib/rbac');
const { logEvent } = require('./_lib/auditLogger');
const { normalizeGender } = require('./contacts');

exports.handler = async (event) => {
  initBlobs(event);
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { error: 'Invalid request body' });
  }

  const { action, contactId } = body;
  if (!contactId || !action) return jsonResponse(400, { error: 'contactId and action are required' });

  const store = contactsStore();
  const contact = await store.get(contactId, { type: 'json' });
  if (!contact) return jsonResponse(404, { error: 'Contact not found' });

  if (action === 'edit') {
    const gate = await requirePermission(event, 'edit_contacts');
    if (gate.error) return gate.error;
    const actingUser = gate.user;

    const { updates } = body;
    if (!updates || typeof updates !== 'object') {
      return jsonResponse(400, { error: 'updates object is required for edit' });
    }
    const previousValue = { ...contact };
    const allowed = ['fullName', 'email', 'phone', 'category', 'gender', 'notes'];
    allowed.forEach((f) => {
      if (f in updates) {
        if (f === 'category' && updates[f]) contact[f] = String(updates[f]).trim().toLowerCase();
        else if (f === 'gender') contact[f] = normalizeGender(updates[f]);
        else contact[f] = updates[f];
      }
    });
    contact.updatedAt = new Date().toISOString();
    contact.updatedBy = actingUser.userId;
    await store.setJSON(contactId, contact);

    await logEvent({
      user: actingUser,
      action: 'contact_edited',
      actionCategory: 'contacts',
      description: `${actingUser.fullName} edited contact ${contact.fullName}`,
      targetType: 'contact',
      targetId: contactId,
      contactId,
      previousValue,
      newValue: contact,
      success: true,
    });
    return jsonResponse(200, { contact });
  }

  if (action === 'archive' || action === 'restore') {
    const gate = await requirePermission(event, 'archive_contacts');
    if (gate.error) return gate.error;
    const actingUser = gate.user;

    const previousValue = contact.archived;
    contact.archived = action === 'archive';
    contact.updatedAt = new Date().toISOString();
    contact.updatedBy = actingUser.userId;
    await store.setJSON(contactId, contact);

    await logEvent({
      user: actingUser,
      action: action === 'archive' ? 'contact_archived' : 'contact_restored',
      actionCategory: 'contacts',
      description: `${actingUser.fullName} ${action}d contact ${contact.fullName}`,
      targetType: 'contact',
      targetId: contactId,
      contactId,
      previousValue: { archived: previousValue },
      newValue: { archived: contact.archived },
      success: true,
    });
    return jsonResponse(200, { contact });
  }

  if (action === 'merge') {
    const gate = await requirePermission(event, 'merge_contacts');
    if (gate.error) return gate.error;
    const actingUser = gate.user;

    const { mergeIntoContactId } = body;
    const survivor = await store.get(mergeIntoContactId, { type: 'json' });
    if (!survivor) return jsonResponse(404, { error: 'Target contact for merge not found' });

    // Merge non-empty fields from the duplicate into the survivor, then
    // archive the duplicate. Both records and the merge event stay
    // permanently attributable — nothing is deleted.
    ['email', 'phone', 'category', 'gender', 'notes'].forEach((f) => {
      if (!survivor[f] && contact[f]) survivor[f] = contact[f];
    });
    survivor.updatedAt = new Date().toISOString();
    survivor.updatedBy = actingUser.userId;
    contact.archived = true;
    contact.mergedInto = mergeIntoContactId;
    contact.updatedAt = new Date().toISOString();
    contact.updatedBy = actingUser.userId;

    await store.setJSON(mergeIntoContactId, survivor);
    await store.setJSON(contactId, contact);

    await logEvent({
      user: actingUser,
      action: 'contact_merged',
      actionCategory: 'contacts',
      description: `${actingUser.fullName} merged contact ${contact.fullName} into ${survivor.fullName}`,
      targetType: 'contact',
      targetId: contactId,
      contactId,
      previousValue: { contactId },
      newValue: { mergedInto: mergeIntoContactId },
      success: true,
    });
    return jsonResponse(200, { survivor, merged: contact });
  }

  return jsonResponse(400, { error: 'Unknown action' });
};
