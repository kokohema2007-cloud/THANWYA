const AUTH_SESSION_KEY = 'thanwya.authSession';

function getStorage() {
  if (typeof sessionStorage !== 'undefined') return sessionStorage;
  if (typeof localStorage !== 'undefined') return localStorage;
  return null;
}

export function getStoredSession() {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(AUTH_SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session || typeof session !== 'object' || !session.token || !session.role) return null;
    return session;
  } catch {
    return null;
  }
}

export function setStoredSession(session) {
  const storage = getStorage();
  if (!storage || !session || typeof session !== 'object' || !session.token || !session.role) return;
  storage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
}

export function clearStoredSession() {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(AUTH_SESSION_KEY);
}

export function getStoredToken() {
  return getStoredSession()?.token ?? '';
}
