import { SEED_CODES, SEED_CONTENT, SEED_EXAMS } from './data.js';
import { normalizeTeacherLibrary } from './libraryFolders.js';
import { createSeedLibrary } from './studentLibrary.js';
import { localTeacherImageFor } from './teacherImages.js';

const KEYS = {
  codes: 'thanwya.codes',
  lessonCodes: 'thanwya.lessonCodes',
  content: 'thanwya.content',
  exams: 'thanwya.exams',
  library: 'thanwya.library',
  theme: 'thanwya.theme',
};

const AUTH_TOKEN_KEY = 'thanwya.authToken';

const REMOTE_KEYS = Object.values(KEYS);

function shouldRepairText(value) {
  return /[ØÙÃÂð\u00bf]/.test(value);
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

function getAuthToken() {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

function migrateCodes(codes) {
  if (!Array.isArray(codes)) return codes;

  return codes.map((code) => {
    if (code.id === 'code-demo' || String(code.value ?? '').toUpperCase() === 'THANWYA-DEMO') {
      return {
        ...code,
        id: 'test',
        value: 'test',
      };
    }
    return code;
  });
}

function hasRemoteApi() {
  return typeof window !== 'undefined' && typeof fetch === 'function';
}

export function loadStore(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? normalizeValue(JSON.parse(stored)) : fallback;
  } catch {
    return fallback;
  }
}

export function saveStore(key, value, { syncRemote = true } = {}) {
  const normalized = normalizeValue(value);
  localStorage.setItem(key, JSON.stringify(normalized));
  if (syncRemote) void syncStoreToRemote();
}

function readLocalSnapshot() {
  return REMOTE_KEYS.reduce((acc, key) => {
    acc[key] = loadStore(key, null);
    return acc;
  }, {});
}

export async function syncStoreToRemote() {
  if (!hasRemoteApi()) return;
  const token = getAuthToken();
  if (!token) return;
  try {
    await fetch('/api/store', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(normalizeValue(readLocalSnapshot())),
    });
  } catch {
    // Remote sync is best-effort; local storage remains the fallback.
  }
}

export async function hydrateStoreFromRemote() {
  if (!hasRemoteApi()) return null;
  const token = getAuthToken();
  if (!token) return null;
  try {
    const response = await fetch('/api/store', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const remoteStore = await response.json();
    for (const key of REMOTE_KEYS) {
      if (remoteStore?.[key] != null) {
        const value = key === KEYS.codes ? migrateCodes(normalizeValue(remoteStore[key])) : normalizeValue(remoteStore[key]);
        localStorage.setItem(key, JSON.stringify(value));
      }
    }
    return remoteStore;
  } catch {
    return null;
  }
}

export function bootstrapStore() {
  if (!localStorage.getItem(KEYS.codes)) saveStore(KEYS.codes, SEED_CODES, { syncRemote: false });
  if (!localStorage.getItem(KEYS.lessonCodes)) saveStore(KEYS.lessonCodes, [], { syncRemote: false });
  if (!localStorage.getItem(KEYS.content)) saveStore(KEYS.content, SEED_CONTENT, { syncRemote: false });
  if (!localStorage.getItem(KEYS.exams)) saveStore(KEYS.exams, SEED_EXAMS, { syncRemote: false });

  const codes = loadStore(KEYS.codes, []);
  const migratedCodes = migrateCodes(codes);
  if (JSON.stringify(migratedCodes) !== JSON.stringify(codes)) {
    saveStore(KEYS.codes, migratedCodes, { syncRemote: false });
  }

  const seedLibrary = createSeedLibrary();
  const library = loadStore(KEYS.library, null);
  if (!library) {
    saveStore(KEYS.library, seedLibrary, { syncRemote: false });
    return;
  }

  const migrated = library.map((subject) => ({
    ...subject,
    teachers: subject.teachers.map((teacher) =>
      normalizeTeacherLibrary({
        ...teacher,
        image: localTeacherImageFor(teacher.name) ?? teacher.image,
      }),
    ),
  }));

  const chemistry = migrated.find((subject) => subject.name === 'كيمياء');
  if (chemistry && !chemistry.teachers.some((teacher) => teacher.name === 'Ashraf ElShenawy')) {
    chemistry.teachers.push({
      id: 'kimeya-ashraf-elshenawy',
      name: 'Ashraf ElShenawy',
      role: 'مدرس المادة',
      image: '/teacher-images/Ashraf ElShenawy.png',
      lessons: chemistry.teachers[0]?.lessons ? chemistry.teachers[0].lessons.map((lesson) => ({
        ...lesson,
        id: lesson.id.replace(/^[^-]+/, 'ashraf'),
        title: lesson.title,
        children: Array.isArray(lesson.children) ? lesson.children : [],
      })) : [],
    });
  }

  for (const seedSubject of seedLibrary) {
    if (!migrated.some((subject) => subject.name === seedSubject.name)) {
      migrated.push(seedSubject);
    }
  }

  saveStore(KEYS.library, migrated, { syncRemote: false });
}

export { KEYS };
