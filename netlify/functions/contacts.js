const crypto = require('crypto');
const { initBlobs, contactsStore } = require('./_lib/stores');
const { requirePermission, jsonResponse } = require('./_lib/rbac');
const { logEvent } = require('./_lib/auditLogger');

// Gender is a simple, optional M/F field on the basic contact form.
// Accepts a few common spellings and normalizes down to 'M' or 'F';
// anything else (including blank) is stored as null rather than rejected,
// since it's optional.
function normalizeGender(value) {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  if (v === 'm' || v === 'male') return 'M';
  if (v === 'f' || v === 'female') return 'F';
  return null;
}

// Categories are free text, and a contact can belong to more than one
// (e.g. someone is both a "donor" and a "volunteer"). Accepts either a
// real array (from the tag-style picker in the Add/Edit form) or a
// single comma/semicolon-separated string (from a spreadsheet cell with
// several categories typed into one column), and always normalizes down
// to a deduplicated array of trimmed, lowercased strings.
function normalizeCategories(value) {
  let list;
  if (Array.isArray(value)) list = value;
  else if (typeof value === 'string') list = value.split(/[,;]/);
  else list = [];
  const cleaned = list.map((c) => String(c).trim().toLowerCase()).filter(Boolean);
  return Array.from(new Set(cleaned));
}

// Reads a contact straight out of storage and fills in `categories` for
// records written before multi-category support existed (which only
// have the old singular `category` string field). The legacy field is
// left in place rather than deleted — harmless, and avoids a write on
// every single read.
function withCategories(contact) {
  if (!contact) return contact;
  if (Array.isArray(contact.categories)) return contact;
  return { ...contact, categories: contact.category ? [contact.category] : [] };
}

exports.handler = async (event) => {
  initBlobs(event);
  const store = contactsStore();

  if (event.httpMethod === 'GET') {
    const gate = await requirePermission(event, 'view_contacts');
    if (gate.error) return gate.error;

    const { blobs } = await store.list();
    const contacts = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })));
    const includeArchived = (event.queryStringParameters || {}).includeArchived === 'true';
    const filtered = contacts.filter(Boolean).filter((c) => includeArchived || !c.archived).map(withCategories);
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

    const { fullName, email, phone, address1, address2, address3, gender, notes } = body;
    const categories = normalizeCategories(body.categories !== undefined ? body.categories : body.category);
    if (!fullName) return jsonResponse(400, { error: 'fullName is required' });

    const contactId = `CT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const now = new Date().toISOString();
    const contact = {
      contactId,
      fullName,
      email: email || null,
      phone: phone || null,
      address1: address1 || null,
      address2: address2 || null,
      address3: address3 || null,
      gender: normalizeGender(gender),
      // Free text, not an enum, and a contact can have several — the org
      // can invent categories as it needs them (e.g. "sponsor", "alumni"),
      // typed straight into the Add/Edit Contact form.
      categories,
      category: categories[0] || null, // kept in sync for any old code path still reading the singular field
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

module.exports.normalizeGender = normalizeGender;
module.exports.normalizeCategories = normalizeCategories;
module.exports.withCategories = withCategories;
