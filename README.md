# SU Connect

CRM for Scripture Union Singapore — Admin Panel (users, roles, audit log),
Contacts, Donations, and Volunteers.

Architecture: static `public/` frontend + Netlify Functions backend +
Netlify Blobs storage. No Claude API / AI features are used anywhere in
this app.

## Deploying

1. **Push this code** to `herbivour77/SU-Connect` on GitHub (see commands
   below), then connect the repo in Netlify (New site → Import an
   existing project → pick the repo). Netlify will read `netlify.toml`
   automatically — build command is not needed since `public/` is
   already static and functions are plain Node.

2. **Set the `SEED_TOKEN` environment variable** in Netlify (Site
   configuration → Environment variables) to any long random string —
   this is a one-time password that lets you create the first Super
   Admin account. Example generation:
   ```
   openssl rand -hex 24
   ```

3. **Deploy the site.**

4. **Run first-time setup**: visit `https://<your-site>.netlify.app/setup.html`,
   enter the `SEED_TOKEN` you set above plus Basil's name, email, and the
   password `Btdr` (or something stronger — this can be changed any time
   via the Admin Panel's password reset, and the account will be
   required to set a new password on first login regardless).

   This endpoint creates exactly one user and then permanently refuses
   to run again — it is not a hardcoded login bypass; it seeds a normal
   user record with a securely hashed password, the same way every
   other user in the system is created.

5. **Log in** at `/login.html` with that email + password. You'll be
   prompted to set a new password immediately (this always happens for
   newly created/reset accounts).

## Local development

```bash
npm install
npm install -g netlify-cli   # if not already installed
netlify dev
```

`netlify dev` serves `public/` and runs the functions locally with a
local Blobs emulation. Set `SEED_TOKEN` in a local `.env` file (already
gitignored) before running setup locally.

## Security notes / what's genuinely implemented vs. still to add

**Implemented for real** (per the project's security spec):
- Passwords are hashed with PBKDF2 (210,000 iterations) — never stored
  or returned in plaintext, anywhere.
- Sessions are opaque server-side tokens in httpOnly, Secure, SameSite
  cookies — no session data or role/permission info is ever stored
  client-side (not even in localStorage).
- Every permission check happens in the Netlify Function (server-side)
  before any data is returned or mutated — the frontend hiding a button
  is cosmetic only, never the actual access control.
- Role/status/permission changes immediately revoke the affected user's
  sessions.
- Every user-management, auth, and record action writes an Admin
  History entry (see `_lib/auditLogger.js`) with previous/new values,
  actor, timestamp, and success/failure. Only that one module ever
  writes to the audit store, and there is no update/delete path exposed
  for audit records anywhere in the API.
- Deactivating/suspending a user does not delete their created records
  — contacts, donations, volunteer records, and audit entries stay
  attributed to them permanently.

**Deliberately NOT yet implemented** (flagged rather than faked):
- **Brute-force/rate limiting on login** — failed attempts are logged
  to Admin History but nothing currently locks an account or IP out
  after repeated failures. Add this before real donor data goes in.
- **MFA** — the user model and login flow are structured so MFA could
  be added (e.g. a TOTP secret field + a second verification step) but
  it isn't built yet.
- **IP-based suspicious login detection.**
- **CSV/file import pipeline** — the Admin History event types for
  imports exist (`import_started`, `import_completed`, etc.) but the
  actual import UI/parsing isn't built in this pass.
- **Export generation/download tracking** — same as above; the audit
  event types are ready, the export feature itself isn't built.

None of the above are stubbed with fake UI — they simply don't have a
button yet, per the "do not build a fake Admin Panel" rule. Building
any of them is a matter of adding a new Netlify Function following the
same pattern as the existing ones.
