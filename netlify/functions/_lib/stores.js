// Central place every function gets its Netlify Blobs stores from.
// Keeping this in one file means storage naming stays consistent
// and makes it easy to see every collection SU Connect persists.
const { getStore } = require('@netlify/blobs');

function usersStore() {
  return getStore('su-connect-users');
}

function sessionsStore() {
  return getStore('su-connect-sessions');
}

// Audit log is append-only in *usage* (see auditLogger.js) even though
// the underlying Blobs store technically allows overwrite. No function
// other than auditLogger.js should ever write to this store.
function auditStore() {
  return getStore('su-connect-audit');
}

function contactsStore() {
  return getStore('su-connect-contacts');
}

function donationsStore() {
  return getStore('su-connect-donations');
}

function volunteersStore() {
  return getStore('su-connect-volunteers');
}

module.exports = {
  usersStore,
  sessionsStore,
  auditStore,
  contactsStore,
  donationsStore,
  volunteersStore,
};
