import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink, readdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(__dirname, 'data');
const uploadsDir = path.join(__dirname, 'uploads', 'videos');
const storePath = path.join(dataDir, 'store.json');

const ADMIN_ACCESS_CODE = process.env.ADMIN_ACCESS_CODE || 'admin';
const AUTH_SECRET = process.env.AUTH_SECRET || 'thanwya-dev-secret';
const ADMIN_TOKEN_TTL_MS = Number(process.env.ADMIN_TOKEN_TTL || 1000 * 60 * 60 * 4);
const STUDENT_TOKEN_TTL_MS = Number(process.env.STUDENT_TOKEN_TTL || 1000 * 60 * 60 * 24 * 7);
const RATE_LIMIT_WINDOW_MS = 1000 * 60 * 5;
const RATE_LIMIT_MAX_FAILS = 5;

const app = express();
const upload = multer({ dest: uploadsDir, limits: { fileSize: 1024 * 1024 * 1024 } });
const rateLimits = new Map();

await mkdir(dataDir, { recursive: true });
await mkdir(uploadsDir, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '20mb' }));

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

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, signature] = token.split('.');
  const expected = createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  if (signature !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return req.query.ticket ? String(req.query.ticket) : '';
}

function requireAuth(roles = []) {
  return (req, res, next) => {
    const payload = verifyToken(extractToken(req));
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    if (roles.length && !roles.includes(payload.role)) return res.status(403).json({ error: 'Forbidden' });
    req.auth = payload;
    next();
  };
}

function rateLimitKey(route, req, identifier = '') {
  return [route, req.ip ?? 'unknown', identifier].join('|');
}

function recordFailedAttempt(route, req, identifier = '') {
  const key = rateLimitKey(route, req, identifier);
  const now = Date.now();
  const current = rateLimits.get(key);
  if (!current || current.expiresAt <= now) {
    rateLimits.set(key, { fails: 1, expiresAt: now + RATE_LIMIT_WINDOW_MS });
    return { limited: false, fails: 1 };
  }

  current.fails += 1;
  current.expiresAt = now + RATE_LIMIT_WINDOW_MS;
  rateLimits.set(key, current);
  return { limited: current.fails > RATE_LIMIT_MAX_FAILS, fails: current.fails };
}

function clearFailedAttempts(route, req, identifier = '') {
  rateLimits.delete(rateLimitKey(route, req, identifier));
}

async function readStore() {
  try {
    const raw = await readFile(storePath, 'utf8');
    return normalizeValue(JSON.parse(raw));
  } catch {
    return {};
  }
}

async function writeStore(store) {
  await writeFile(storePath, JSON.stringify(normalizeValue(store), null, 2), 'utf8');
}

function walkLessons(folders = [], visitor, parent = null, subject = null, teacher = null) {
  for (const folder of folders ?? []) {
    visitor(folder, parent, subject, teacher);
    walkLessons(folder.children ?? [], visitor, folder, subject, teacher);
  }
}

function findLessonById(library, lessonId) {
  let match = null;
  for (const subject of library ?? []) {
    for (const teacher of subject.teachers ?? []) {
      walkLessons(teacher.lessons ?? [], (folder, parent, currentSubject, currentTeacher) => {
        if (!match && folder.id === lessonId) {
          match = { folder, subject: currentSubject, teacher: currentTeacher };
        }
      }, null, subject, teacher);
    }
  }
  return match;
}

function findVideoByAssetId(library, assetId) {
  for (const subject of library ?? []) {
    for (const teacher of subject.teachers ?? []) {
      let found = null;
      walkLessons(teacher.lessons ?? [], (folder, parent, currentSubject, currentTeacher) => {
        if (found) return;
        const video = (folder.videos ?? []).find((item) => item.assetId === assetId || item.id === assetId);
        if (video) {
          found = { video, lesson: folder, subject: currentSubject, teacher: currentTeacher };
        }
      }, null, subject, teacher);
      if (found) return found;
    }
  }
  return null;
}

function collectLessonCodesFromLibrary(library) {
  const lessonCodes = [];
  for (const subject of library ?? []) {
    for (const teacher of subject.teachers ?? []) {
      walkLessons(teacher.lessons ?? [], (folder, parent, currentSubject, currentTeacher) => {
        if (folder.accessCode) {
          lessonCodes.push({
            id: folder.accessCodeId || `legacy-${folder.id}`,
            value: folder.accessCode,
            lessonId: folder.id,
            folderId: folder.id,
            subjectId: currentSubject.id,
            subjectName: currentSubject.name,
            teacherId: currentTeacher.id,
            teacherName: currentTeacher.name,
            lessonTitle: folder.title,
            status: folder.accessStatus === 'expired' ? 'claimed' : 'unused',
            createdAt: folder.accessGeneratedAt || folder.createdAt || new Date().toISOString(),
            claimedAt: folder.accessUsedAt || '',
            claimedByStudentCodeId: folder.accessStudentCodeId || '',
          });
        }
      }, null, subject, teacher);
    }
  }
  return lessonCodes;
}

function migrateStore(store) {
  const next = { ...store };
  next['thanwya.lessonAccess'] = Array.isArray(next['thanwya.lessonAccess']) ? next['thanwya.lessonAccess'] : [];
  next['thanwya.lessonCodes'] = Array.isArray(next['thanwya.lessonCodes']) ? next['thanwya.lessonCodes'] : [];
  next['thanwya.codes'] = Array.isArray(next['thanwya.codes']) ? next['thanwya.codes'] : [];
  next['thanwya.library'] = Array.isArray(next['thanwya.library']) ? next['thanwya.library'] : [];

  const lessonCodeMap = new Map(next['thanwya.lessonCodes'].map((code) => [String(code.value ?? '').trim().toUpperCase(), code]));
  for (const legacyCode of collectLessonCodesFromLibrary(next['thanwya.library'])) {
    const normalized = String(legacyCode.value ?? '').trim().toUpperCase();
    if (!lessonCodeMap.has(normalized)) {
      lessonCodeMap.set(normalized, legacyCode);
    } else {
      const current = lessonCodeMap.get(normalized);
      if (!current.lessonId && legacyCode.lessonId) {
        lessonCodeMap.set(normalized, { ...current, ...legacyCode });
      }
    }
  }
  next['thanwya.lessonCodes'] = Array.from(lessonCodeMap.values());

  for (const code of next['thanwya.codes']) {
    if (!code.status) code.status = 'unused';
  }

  return next;
}

function isAdminAuth(req) {
  const payload = verifyToken(extractToken(req));
  return payload?.role === 'admin';
}

function createAuthToken(payload) {
  const ttl = payload.role === 'admin' ? ADMIN_TOKEN_TTL_MS : STUDENT_TOKEN_TTL_MS;
  return signToken({ ...payload, exp: Date.now() + ttl });
}

function findStudentCode(store, codeValue) {
  const normalized = String(codeValue ?? '').trim().toUpperCase();
  return store['thanwya.codes'].find((item) => {
    const itemValue = String(item.value ?? '').trim().toUpperCase();
    const itemId = String(item.id ?? '').trim().toUpperCase();
    return itemValue === normalized || itemId === normalized;
  }) ?? null;
}

function buildStudentAccessList(store, studentCodeId) {
  return store['thanwya.lessonAccess']
    .filter((item) => item.studentCodeId === studentCodeId)
    .map((item) => ({ ...item }));
}

function studentHasLessonAccess(store, studentCodeId, lessonId) {
  return store['thanwya.lessonAccess'].some((item) => item.studentCodeId === studentCodeId && item.lessonId === lessonId);
}

app.post('/api/auth/login', async (req, res) => {
  const code = String(req.body?.code ?? '').trim();
  const store = migrateStore(await readStore());
  const rateKey = code.toLowerCase() === ADMIN_ACCESS_CODE.toLowerCase()
    ? `admin:${code.toLowerCase()}`
    : `student:${code.toUpperCase()}`;

  if (!code) {
    return res.status(400).json({ error: 'Missing code' });
  }

  if (code.toLowerCase() === ADMIN_ACCESS_CODE.toLowerCase()) {
    clearFailedAttempts('/api/auth/login', req, rateKey);
    return res.json({
      role: 'admin',
      token: createAuthToken({ role: 'admin' }),
    });
  }

  const studentCode = findStudentCode(store, code);
  if (!studentCode || studentCode.status === 'disabled') {
    const attempt = recordFailedAttempt('/api/auth/login', req, rateKey);
    if (attempt.limited) {
      return res.status(429).json({ error: 'Too many attempts' });
    }
    return res.status(401).json({ error: 'Invalid code' });
  }

  clearFailedAttempts('/api/auth/login', req, rateKey);

  const tokenPayload = {
    role: 'student',
    studentCodeId: studentCode.id,
    studentCodeValue: studentCode.value,
    studentName: studentCode.profile?.name ?? 'Student',
  };

  return res.json({
    role: 'student',
    token: createAuthToken(tokenPayload),
    profile: {
      ...studentCode.profile,
      codeId: studentCode.id,
      code: studentCode.value,
      createdAt: studentCode.createdAt,
      activatedAt: studentCode.activatedAt || new Date().toISOString(),
      status: studentCode.status,
    },
    access: buildStudentAccessList(store, studentCode.id),
  });
});

app.get('/api/auth/me', requireAuth(), async (req, res) => {
  const store = migrateStore(await readStore());
  if (req.auth.role === 'admin') {
    return res.json({ role: 'admin' });
  }
  return res.json({
    role: 'student',
    access: buildStudentAccessList(store, req.auth.studentCodeId),
  });
});

app.get('/api/store', requireAuth(['admin']), async (_req, res) => {
  res.json(migrateStore(await readStore()));
});

app.put('/api/store', requireAuth(['admin']), async (req, res) => {
  await writeStore(migrateStore(req.body ?? {}));
  res.json({ ok: true });
});

app.post('/api/lesson-codes', requireAuth(['admin']), async (req, res) => {
  const { lessonId } = req.body ?? {};
  const store = migrateStore(await readStore());
  const lesson = lessonId ? findLessonById(store['thanwya.library'], lessonId) : null;
  if (!lesson) return res.status(400).json({ error: 'Invalid lesson' });

  const code = {
    id: `lesson-code-${randomUUID()}`,
    value: `LSN-${randomUUID().slice(0, 8).toUpperCase()}`,
    lessonId: lesson.folder.id,
    folderId: lesson.folder.id,
    subjectId: lesson.subject.id,
    subjectName: lesson.subject.name,
    teacherId: lesson.teacher.id,
    teacherName: lesson.teacher.name,
    lessonTitle: lesson.folder.title,
    status: 'unused',
    createdAt: new Date().toISOString(),
    claimedAt: '',
    claimedByStudentCodeId: '',
  };

  store['thanwya.lessonCodes'] = [code, ...store['thanwya.lessonCodes'].filter((item) => String(item.lessonId) !== String(lesson.folder.id))];
  await writeStore(store);
  res.json({ code });
});

app.get('/api/student/access', requireAuth(['student']), async (req, res) => {
  const store = migrateStore(await readStore());
  res.json({ access: buildStudentAccessList(store, req.auth.studentCodeId) });
});

app.post('/api/student/lesson-access/claim', requireAuth(['student']), async (req, res) => {
  const codeValue = String(req.body?.code ?? '').trim();
  const store = migrateStore(await readStore());
  const rateKey = `student:${req.auth.studentCodeId}:${codeValue.toUpperCase()}`;
  const lessonCode = store['thanwya.lessonCodes'].find((item) => {
    const itemValue = String(item.value ?? '').trim().toUpperCase();
    const itemId = String(item.id ?? '').trim().toUpperCase();
    return itemValue === codeValue.toUpperCase() || itemId === codeValue.toUpperCase();
  }) ?? null;
  if (!lessonCode || !lessonCode.lessonId) {
    const attempt = recordFailedAttempt('/api/student/lesson-access/claim', req, rateKey);
    if (attempt.limited) {
      return res.status(429).json({ error: 'Too many attempts' });
    }
    return res.status(400).json({ error: 'Invalid lesson code' });
  }

  const existingAccess = store['thanwya.lessonAccess'].find((item) => item.studentCodeId === req.auth.studentCodeId && item.lessonId === lessonCode.lessonId);
  if (existingAccess) {
    clearFailedAttempts('/api/student/lesson-access/claim', req, rateKey);
    return res.json({ ok: true, alreadyOwned: true, access: existingAccess, lessonCode });
  }

  if (lessonCode.status === 'claimed' && lessonCode.claimedByStudentCodeId && lessonCode.claimedByStudentCodeId !== req.auth.studentCodeId) {
    const attempt = recordFailedAttempt('/api/student/lesson-access/claim', req, rateKey);
    if (attempt.limited) {
      return res.status(429).json({ error: 'Too many attempts' });
    }
    return res.status(409).json({ error: 'Code already used' });
  }

  if (lessonCode.status === 'claimed' && lessonCode.claimedByStudentCodeId === req.auth.studentCodeId) {
    clearFailedAttempts('/api/student/lesson-access/claim', req, rateKey);
    return res.status(409).json({ error: 'Lesson already linked' });
  }

  const access = {
    id: `access-${randomUUID()}`,
    studentCodeId: req.auth.studentCodeId,
    lessonId: lessonCode.lessonId,
    folderId: lessonCode.folderId || lessonCode.lessonId,
    codeId: lessonCode.id,
    purchasedAt: new Date().toISOString(),
  };

  store['thanwya.lessonAccess'] = [access, ...store['thanwya.lessonAccess']];
  store['thanwya.lessonCodes'] = store['thanwya.lessonCodes'].map((item) =>
    item.id === lessonCode.id
      ? { ...item, status: 'claimed', claimedAt: access.purchasedAt, claimedByStudentCodeId: req.auth.studentCodeId }
      : item,
  );
  await writeStore(store);
  clearFailedAttempts('/api/student/lesson-access/claim', req, rateKey);
  res.json({ ok: true, unlocked: true, access });
});

app.get('/api/uploads/video/:id/access', requireAuth(), async (req, res) => {
  const store = migrateStore(await readStore());
  const assetId = req.params.id;
  const asset = findVideoByAssetId(store['thanwya.library'], assetId);
  if (!asset) return res.status(404).json({ error: 'Not found' });

  if (req.auth.role !== 'admin' && !studentHasLessonAccess(store, req.auth.studentCodeId, asset.lesson.id)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const ticket = signToken({
    role: req.auth.role,
    videoId: assetId,
    lessonId: asset.lesson.id,
    studentCodeId: req.auth.studentCodeId || '',
    exp: Date.now() + 1000 * 60 * 10,
  });

  res.json({ url: `/api/uploads/video/${encodeURIComponent(assetId)}?ticket=${encodeURIComponent(ticket)}` });
});

app.get('/api/uploads/video/:id', async (req, res) => {
  const assetId = req.params.id;
  const store = migrateStore(await readStore());
  const asset = findVideoByAssetId(store['thanwya.library'], assetId);
  const token = req.query.ticket ? String(req.query.ticket) : '';
  const payload = verifyToken(token);

  if (!asset) return res.status(404).end();
  if (!payload || payload.videoId !== assetId || (payload.lessonId && payload.lessonId !== asset.lesson.id)) {
    return res.status(403).end();
  }
  if (payload.role === 'student' && !studentHasLessonAccess(store, payload.studentCodeId, asset.lesson.id)) {
    return res.status(403).end();
  }

  const files = await readdir(uploadsDir);
  const file = files.find((name) => name.startsWith(`${assetId}.`) || name === assetId);
  if (!file) return res.status(404).end();
  res.sendFile(path.join(uploadsDir, file));
});

app.post('/api/uploads/video', requireAuth(['admin']), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Missing file' });
  const assetId = `video-${randomUUID()}`;
  const ext = path.extname(req.file.originalname || '.mp4') || '.mp4';
  const finalName = `${assetId}${ext}`;
  const finalPath = path.join(uploadsDir, finalName);
  await rename(req.file.path, finalPath);
  res.json({
    id: assetId,
    fileName: req.file.originalname,
    url: `/api/uploads/video/${assetId}`,
  });
});

app.delete('/api/uploads/video/:id', requireAuth(['admin']), async (req, res) => {
  const assetId = req.params.id;
  const files = await readdir(uploadsDir);
  const file = files.find((name) => name.startsWith(`${assetId}.`) || name === assetId);
  if (file) {
    await unlink(path.join(uploadsDir, file));
  }
  res.json({ ok: true });
});

if (existsSync(path.join(rootDir, 'dist'))) {
  app.use(express.static(path.join(rootDir, 'dist')));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(rootDir, 'dist', 'index.html'));
  });
}

const port = Number(process.env.PORT || 3001);

if (process.argv[1] === __filename) {
  app.listen(port, () => {
    console.log(`Thanwya API running on http://127.0.0.1:${port}`);
  });
}

export default app;
