// Central place every function gets its Netlify Blobs stores from.
//
// We explicitly provide the Netlify Site ID and authentication token
// so Netlify Blobs works reliably in deployed Functions.

const { getStore } = require('@netlify/blobs');

const siteID =
  process.env.NETLIFY_SITE_ID ||
  process.env.SITE_ID ||
  process.env.NETLIFY_BLOBS_SITE_ID;

const token =
  process.env.NETLIFY_AUTH_TOKEN ||
  process.env.NETLIFY_BLOBS_TOKEN;

if (!siteID) {
  throw new Error(
    'Netlify Blobs configuration error: NETLIFY_SITE_ID is missing.'
  );
}

if (!token) {
  throw new Error(
    'Netlify Blobs configuration error: NETLIFY_AUTH_TOKEN is missing.'
  );
}

function createStore(name) {
  return getStore({
    name,
    siteID,
    token,
  });
}

function usersStore() {
  return createStore('su-connect-users');
}

function sessionsStore() {
  return createStore('su-connect-sessions');
}

function auditStore() {
  return createStore('su-connect-audit');
}

function contactsStore() {
  return createStore('su-connect-contacts');
}

function donationsStore() {
  return createStore('su-connect-donations');
}

function volunteersStore() {
  return createStore('su-connect-volunteers');
}

module.exports = {
  usersStore,
  sessionsStore,
  auditStore,
  contactsStore,
  donationsStore,
  volunteersStore,
};
