const { initBlobs, contactsStore, donationsStore, volunteersStore } = require('./_lib/stores');
const { requirePermission, jsonResponse } = require('./_lib/rbac');
const { logEvent } = require('./_lib/auditLogger');

// Real Claude-powered assistant, not a canned/mock response. It needs an
// ANTHROPIC_API_KEY set in the site's environment variables to work —
// without one it returns a clear, honest error rather than pretending
// to answer. Get a key at https://console.anthropic.com/settings/keys
// and add it in Netlify: Site settings -> Environment variables.
const MODEL = 'claude-sonnet-4-6';

async function buildContext(contactId) {
  if (!contactId) return null;
  const contact = await contactsStore().get(contactId, { type: 'json' });
  if (!contact) return null;

  const [{ blobs: donationBlobs }, { blobs: volunteerBlobs }] = await Promise.all([
    donationsStore().list(),
    volunteersStore().list(),
  ]);
  const donations = (await Promise.all(donationBlobs.map((b) => donationsStore().get(b.key, { type: 'json' }))))
    .filter((d) => d && d.contactId === contactId);
  const volunteerRecords = (await Promise.all(volunteerBlobs.map((b) => volunteersStore().get(b.key, { type: 'json' }))))
    .filter((v) => v && v.contactId === contactId);

  return { contact, donations, volunteerRecords };
}

exports.handler = async (event) => {
  initBlobs(event);
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const gate = await requirePermission(event, 'use_ai_assistant');
  if (gate.error) return gate.error;
  const actingUser = gate.user;

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { error: 'Invalid request body' });
  }

  const { question, contactId } = body;
  if (!question || !String(question).trim()) {
    return jsonResponse(400, { error: 'question is required' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return jsonResponse(503, {
      error: 'The AI Assistant is not configured yet. An administrator needs to add ANTHROPIC_API_KEY in Netlify site environment variables.',
    });
  }

  let contextBlock = 'No specific contact is selected for this question.';
  try {
    const ctx = await buildContext(contactId);
    if (ctx) {
      contextBlock = JSON.stringify({
        contact: {
          fullName: ctx.contact.fullName,
          category: ctx.contact.category,
          gender: ctx.contact.gender,
          email: ctx.contact.email,
          phone: ctx.contact.phone,
          notes: ctx.contact.notes,
        },
        donations: ctx.donations.map((d) => ({ amount: d.amount, currency: d.currency, date: d.date, method: d.method })),
        volunteerRecords: ctx.volunteerRecords.map((v) => ({ role: v.role, programme: v.programme, status: v.status })),
      }, null, 2);
    }
  } catch {
    // If context lookup fails for any reason, still let the question
    // through — it just won't be contact-scoped.
  }

  let answer;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        system: 'You are the AI Assistant inside SU Connect, a CRM for Scripture Union Singapore. Answer the staff member\'s question helpfully and concisely using only the contact/donation/volunteer context provided (if any). Never invent data you were not given.',
        messages: [
          { role: 'user', content: `Context:\n${contextBlock}\n\nQuestion: ${question}` },
        ],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Anthropic API error (${res.status}): ${errBody.slice(0, 300)}`);
    }
    const data = await res.json();
    answer = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  } catch (err) {
    await logEvent({
      user: actingUser,
      action: 'ai_query_executed',
      actionCategory: 'system',
      description: `${actingUser.fullName} ran an AI Assistant query that failed`,
      targetType: contactId ? 'contact' : null,
      contactId: contactId || null,
      success: false,
      failureReason: err.message,
    });
    return jsonResponse(502, { error: `AI Assistant request failed: ${err.message}` });
  }

  await logEvent({
    user: actingUser,
    action: 'ai_query_executed',
    actionCategory: 'system',
    description: `${actingUser.fullName} asked the AI Assistant: "${String(question).slice(0, 120)}"`,
    targetType: contactId ? 'contact' : null,
    contactId: contactId || null,
    success: true,
  });

  return jsonResponse(200, { answer });
};
