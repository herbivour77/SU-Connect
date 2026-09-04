// Password hashing via PBKDF2 (Node's built-in crypto — no extra
// dependency, no plaintext ever stored or returned).
//
// Consistent with the app's security rules:
//   - Passwords are always stored as salt+hash, never plaintext.
//   - There is no code path anywhere that reads a password back out.
//   - Verification re-derives the hash and does a constant-time compare.
const crypto = require('crypto');

const ITERATIONS = 210000; // OWASP-recommended minimum for PBKDF2-SHA256 (2023+)
const KEYLEN = 32;
const DIGEST = 'sha256';

function hashPassword(plainPassword) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto
    .pbkdf2Sync(plainPassword, salt, ITERATIONS, KEYLEN, DIGEST)
    .toString('hex');
  return `pbkdf2$${ITERATIONS}$${salt}$${derived}`;
}

function verifyPassword(plainPassword, storedHash) {
  if (!storedHash || typeof storedHash !== 'string') return false;
  const parts = storedHash.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;

  const iterations = parseInt(parts[1], 10);
  const salt = parts[2];
  const expected = parts[3];

  const derived = crypto
    .pbkdf2Sync(plainPassword, salt, iterations, KEYLEN, DIGEST)
    .toString('hex');

  const expectedBuf = Buffer.from(expected, 'hex');
  const derivedBuf = Buffer.from(derived, 'hex');
  if (expectedBuf.length !== derivedBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, derivedBuf);
}

module.exports = { hashPassword, verifyPassword };
