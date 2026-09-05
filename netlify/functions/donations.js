const crypto = require('crypto');
const { initBlobs, donationsStore, contactsStore } = require('./_lib/stores');
const { requirePermission, jsonResponse } = require('./_lib/rbac');
const { logEvent } = require('./_lib/auditLogger');

exports.handler = async (event) => {
  initBlobs(event);
  const store = donationsStore();

  if (event.httpMethod === 'GET') {
    const gate = await requirePermission(event, 'view_donations');
    if (gate.error) return gate.error;

    const { blobs } = await store.list();
    const donations = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })));
    return jsonResponse(200, { donations: donations.filter(Boolean) });
  }

  if (event.httpMethod === 'POST') {
    const gate = await requirePermission(event, 'create_donations');
    if (gate.error) return gate.error;
    const actingUser = gate.user;

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { error: 'Invalid request body' });
    }

    const { contactId, amount, currency, date, method, notes } = body;
    if (!amount || !date) return jsonResponse(400, { error: 'amount and date are required' });

    if (contactId) {
      const contact = await contactsStore().get(contactId, { type: 'json' });
      if (!contact) return jsonResponse(404, { error: 'Linked contact not found' });
    }

    const donationId = `DN-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const now = new Date().toISOString();
    const donation = {
      donationId,
      contactId: contactId || null,
      amount,
      currency: currency || 'SGD',
      date,
      method: method || null,
      notes: notes || null,
      createdAt: now,
      createdBy: actingUser.userId,
    };
    await store.setJSON(donationId, donation);

    // Two audit trails, per the spec's separation-of-responsibilities
    // requirement: the donation record itself belongs to Contact History
    // (what happened to the contact); this audit event is Admin History
    // (what the staff member did).
    await logEvent({
      user: actingUser,
      action: 'donation_recorded',
      actionCategory: 'donations',
      description: `${actingUser.fullName} recorded a ${donation.currency} ${amount} donation`,
      targetType: 'donation',
      targetId: donationId,
      contactId: contactId || null,
      newValue: donation,
      success: true,
    });

    return jsonResponse(201, { donation });
  }

  if (event.httpMethod === 'DELETE') {
    const gate = await requirePermission(event, 'edit_donations');
    if (gate.error) return gate.error;
    const actingUser = gate.user;

    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch {}
    const donationId = (event.queryStringParameters || {}).donationId || body.donationId;
    if (!donationId) return jsonResponse(400, { error: 'donationId is required' });

    const donation = await store.get(donationId, { type: 'json' });
    if (!donation) return jsonResponse(404, { error: 'Donation not found' });

    await store.delete(donationId);

    // The donation record itself is Contact History and is genuinely
    // removed here (donations, unlike contacts, have no archive state
    // yet) — but the fact that it existed and who deleted it is
    // permanently preserved in Admin History via previousValue below.
    await logEvent({
      user: actingUser,
      action: 'donation_deleted',
      actionCategory: 'donations',
      description: `${actingUser.fullName} deleted a ${donation.currency} ${donation.amount} donation record`,
      targetType: 'donation',
      targetId: donationId,
      contactId: donation.contactId || null,
      previousValue: donation,
      success: true,
    });

    return jsonResponse(200, { ok: true, donationId });
  }

  return jsonResponse(405, { error: 'Method not allowed' });
};
