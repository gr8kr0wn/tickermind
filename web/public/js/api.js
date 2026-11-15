// Thin fetch wrapper around /api with the wallet session token.
const KEY = 'tm_session';

export const session = {
  get() { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } },
  set(v) { localStorage.setItem(KEY, JSON.stringify(v)); window.dispatchEvent(new Event('tm:session')); },
  clear() { localStorage.removeItem(KEY); window.dispatchEvent(new Event('tm:session')); },
};

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function call(method, path, body) {
  const headers = { Accept: 'application/json' };
  const s = session.get();
  if (s?.token) headers.Authorization = `Bearer ${s.token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && s) session.clear();
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  get: (path) => call('GET', path),
  post: (path, body) => call('POST', path, body),
};

let configPromise;
export const getConfig = () => (configPromise ||= api.get('config'));
