const AUTH_TOKEN_KEY = 'thanwya.authToken';

export function getAuthToken() {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setAuthToken(token) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

async function requestJson(path, options = {}) {
  const token = options.token ?? getAuthToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(path, {
    ...options,
    headers,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
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

export async function loadAdminStore() {
  return requestJson('/api/store');
}

export async function saveAdminStore(store) {
  return requestJson('/api/store', {
    method: 'PUT',
    body: JSON.stringify(store),
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
