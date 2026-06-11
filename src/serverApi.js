import { clearStoredSession, getStoredSession, getStoredToken, setStoredSession } from './authSession.js';

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export function buildApiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
}

export function getAuthToken() {
  return getStoredToken();
}

export function setAuthToken(token) {
  const current = getStoredSession() || { role: 'admin' };
  setStoredSession({ ...current, token });
}

export function clearAuthToken() {
  clearStoredSession();
}

async function requestJson(path, options = {}) {
  const token = options.token ?? getAuthToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(buildApiUrl(path), {
    ...options,
    headers,
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }
  if (!response.ok) {
    const message = data?.error || data?.message || response.statusText || 'Request failed';
    throw new Error(message);
  }
  return data;
}

export async function loginWithCode(code) {
  return requestJson('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ code }),
    token: '',
  });
}

export async function bootstrapAdmin({ bootstrapToken, adminCode }) {
  return requestJson('/api/auth/admin/bootstrap', {
    method: 'POST',
    body: JSON.stringify({ bootstrapToken, adminCode }),
    token: '',
  });
}

export async function fetchAuthConfig() {
  return requestJson('/api/auth/config', {
    token: '',
  });
}

export async function fetchAdminStore() {
  return requestJson('/api/admin/store');
}

export async function saveAdminStore(patch) {
  return requestJson('/api/admin/store', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function claimLessonCode(code) {
  return requestJson('/api/student/lesson-access/claim', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export async function fetchStudentAccess() {
  return requestJson('/api/student/access');
}

export async function requestVideoAccess(assetId) {
  return requestJson(`/api/uploads/video/${encodeURIComponent(assetId)}/access`);
}

export async function refreshAuthSession() {
  return requestJson('/api/auth/me');
}
