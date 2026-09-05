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
  del(path, body) { return this.request(path, { method: 'DELETE', body }); },

  // For endpoints that return a binary file (e.g. contacts-export) rather
  // than JSON. Triggers a normal browser "Save As" download.
  async download(path, body, filenameFallback) {
    const res = await fetch(`/api/${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) {
      let msg = `Request failed (${res.status})`;
      try { msg = (await res.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = (match && match[1]) || filenameFallback || 'download';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
