// Thin wrapper around fetch(). Cookies (the session) are sent
// automatically via credentials: 'include' — there is no token stored
// in localStorage/sessionStorage, so there's nothing for client-side
// script injection to steal and replay elsewhere.
const Api = {
  async request(path, { method = 'GET', body } = {}) {
    const res = await fetch(`/api/${path}`, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });

    let data = null;
    try {
      data = await res.json();
    } catch {
      // no body
    }

    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  },

  get(path) { return this.request(path); },
  post(path, body) { return this.request(path, { method: 'POST', body }); },
};
