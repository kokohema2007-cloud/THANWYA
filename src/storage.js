import { SEED_CONTENT, SEED_EXAMS } from './data.js';
import { createSeedLibrary } from './studentLibrary.js';
import { buildApiUrl, getAuthToken } from './serverApi.js';
import { getStoredSession } from './authSession.js';

const KEYS = {
  codes: 'thanwya.codes',
  lessonCodes: 'thanwya.lessonCodes',
  content: 'thanwya.content',
  exams: 'thanwya.exams',
  library: 'thanwya.library',
  theme: 'thanwya.theme',
};

const REMOTE_KEYS = Object.values(KEYS);

function shouldRepairText(value) {
  return /[Ã˜Ã™ÃƒÃ‚Ã°\u00bf]/.test(value);
}

function repairText(value) {
  if (!shouldRepairText(value)) return value;
  try {
    return new TextDecoder('utf-8').decode(Uint8Array.from(value, (character) => character.charCodeAt(0)));
  } catch {
    return value;
  }
}

function normalizeValue(value) {
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeValue(item)]));
  }
  if (typeof value === 'string') return repairText(value);
  return value;
}

function migrateCodes(codes) {
  if (!Array.isArray(codes)) return codes;
  return codes.filter((code) => {
    const id = String(code?.id ?? '').trim().toLowerCase();
    const value = String(code?.value ?? '').trim().toLowerCase();
    return !['code-demo', 'test'].includes(id) && !['thanwya-demo', 'test'].includes(value);
  });
}

function createDefaultCache() {
  return new Map([
    [KEYS.codes, []],
    [KEYS.lessonCodes, []],
    [KEYS.content, SEED_CONTENT],
    [KEYS.exams, SEED_EXAMS],
    [KEYS.library, createSeedLibrary()],
    [KEYS.theme, 'light'],
  ]);
}

const storeCache = createDefaultCache();

function setCacheFromStore(store) {
  if (!store || typeof store !== 'object') return;
  for (const key of REMOTE_KEYS) {
    if (store[key] == null) continue;
    const value = key === KEYS.codes ? migrateCodes(normalizeValue(store[key])) : normalizeValue(store[key]);
    storeCache.set(key, value);
  }
}

function cacheSnapshot() {
  return REMOTE_KEYS.reduce((acc, key) => {
    acc[key] = storeCache.get(key);
    return acc;
  }, {});
}

function hasRemoteApi() {
  return typeof window !== 'undefined' && typeof fetch === 'function';
}

export function loadStore(key, fallback) {
  return storeCache.has(key) ? storeCache.get(key) : fallback;
}

export function saveStore(key, value, { syncRemote = true } = {}) {
  const normalized = normalizeValue(value);
  storeCache.set(key, normalized);
  if (syncRemote) void syncStoreToRemote(key, normalized).catch(() => {});
}

export async function syncStoreToRemote(key, value) {
  if (!hasRemoteApi()) return;
  if (getStoredSession()?.role !== 'admin') return;
  const token = getAuthToken();
  if (!token) return;

  const patch = key ? { [key]: value } : cacheSnapshot();
  await fetch(buildApiUrl('/api/admin/store'), {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(patch),
  });
}

export async function hydratePublicStore() {
  if (!hasRemoteApi()) return null;
  try {
    const response = await fetch(buildApiUrl('/api/public/state'));
    if (!response.ok) return null;
    const remoteStore = await response.json();
    console.info('[exam-flow] public-state-response', {
      ok: response.ok,
      subjectCount: Array.isArray(remoteStore?.[KEYS.library]) ? remoteStore[KEYS.library].length : 0,
    });
    setCacheFromStore(remoteStore);
    return remoteStore;
  } catch {
    return null;
  }
}

export async function hydrateStoreFromRemote() {
  if (!hasRemoteApi()) return null;
  if (getStoredSession()?.role !== 'admin') return null;
  const token = getAuthToken();
  if (!token) return null;
  try {
    const response = await fetch(buildApiUrl('/api/admin/store'), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const remoteStore = await response.json();
    setCacheFromStore(remoteStore);
    return remoteStore;
  } catch {
    return null;
  }
}

export function bootstrapStore() {
  return null;
}

export { KEYS };
