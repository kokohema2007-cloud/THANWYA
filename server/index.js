import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const configuredDataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const uploadsDir = process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : path.join(__dirname, 'uploads', 'videos');
const storePath = process.env.STORE_FILE_PATH ? path.resolve(process.env.STORE_FILE_PATH) : path.join(configuredDataDir, 'store.json');
const dataDir = path.dirname(storePath);
const storeBackupPath = `${storePath}.bak`;
const storeTempPath = `${storePath}.tmp`;

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';
const AUTH_SECRET = requireSecret('AUTH_SECRET', {
  developmentFallback: 'thanwya-dev-secret-change-me',
});
const ADMIN_BOOTSTRAP_TOKEN = String(process.env.ADMIN_BOOTSTRAP_TOKEN || '').trim();
const ADMIN_TOKEN_TTL_MS = readPositiveInt('ADMIN_TOKEN_TTL', 1000 * 60 * 30);
const STUDENT_TOKEN_TTL_MS = readPositiveInt('STUDENT_TOKEN_TTL', 1000 * 60 * 60 * 12);
const RATE_LIMIT_WINDOW_MS = readPositiveInt('RATE_LIMIT_WINDOW_MS', 1000 * 60 * 5);
const RATE_LIMIT_MAX_FAILS = readPositiveInt('RATE_LIMIT_MAX_FAILS', 5);
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '2mb';
const UPLOAD_MAX_BYTES = readPositiveInt('UPLOAD_MAX_BYTES', 1024 * 1024 * 512);
const UPLOAD_ALLOWED_EXTENSIONS = parseCsv(process.env.UPLOAD_ALLOWED_EXTENSIONS || '.mp4,.webm,.mov').map((item) => item.toLowerCase());
const UPLOAD_ALLOWED_MIME_TYPES = parseCsv(process.env.UPLOAD_ALLOWED_MIME_TYPES || 'video/mp4,video/webm,video/quicktime').map((item) => item.toLowerCase());
const CORS_ORIGINS = parseOrigins(process.env.CORS_ORIGINS || '');
const SERVE_STATIC = String(process.env.SERVE_STATIC || '').toLowerCase() === 'true';
const APP_BASE_PATH = normalizeBasePath(process.env.APP_BASE_PATH || '/');
const AUTH_ISSUER = 'thanwya-api';

const app = express();
const rateLimits = new Map();

await mkdir(dataDir, { recursive: true });
await mkdir(uploadsDir, { recursive: true });

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = String(file.mimetype || '').toLowerCase();
    if (!UPLOAD_ALLOWED_EXTENSIONS.includes(ext)) {
      cb(new HttpError(400, `Unsupported file extension: ${ext || 'unknown'}`));
      return;
    }
    if (!UPLOAD_ALLOWED_MIME_TYPES.includes(mime)) {
      cb(new HttpError(400, `Unsupported file type: ${mime || 'unknown'}`));
      return;
    }
    cb(null, true);
  },
});

app.disable('x-powered-by');
app.use(cors(buildCorsOptions()));
app.use(express.json({ limit: JSON_BODY_LIMIT }));

function log(level, message, meta = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  console.log(line);
}

function buildCorsOptions() {
  return {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (CORS_ORIGINS.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new HttpError(403, `Origin not allowed: ${origin}`));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 60 * 60,
  };
}

function parseOrigins(value) {
  const configured = parseCsv(value);
  if (configured.length > 0) {
    return new Set(configured);
  }
  if (!IS_PRODUCTION) {
    return new Set([
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173',
      'http://localhost:3000',
      'http://localhost:5173',
    ]);
  }
  return new Set();
}

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeBasePath(value) {
  const trimmed = `/${String(value || '/').trim().replace(/^\/+|\/+$/g, '')}`;
  return trimmed === '/' ? '/' : trimmed;
}

function readPositiveInt(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function requireSecret(name, { developmentFallback = '' } = {}) {
  const value = String(process.env[name] || '').trim();
  if (value) return value;
  if (!IS_PRODUCTION && developmentFallback) {
    log('warn', `${name} is not set; using development fallback`, { env: name });
    return developmentFallback;
  }
  throw new Error(`${name} is required`);
}

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

function encodeBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function decodeBase64Url(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signToken(payload) {
  const body = encodeBase64Url(JSON.stringify(payload));
  const signature = createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function safeSignatureEquals(signature, expected) {
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, signature] = token.split('.');
  const expected = createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  if (!safeSignatureEquals(signature, expected)) return null;
  try {
    const payload = JSON.parse(decodeBase64Url(body));
    if (payload.type !== 'session' && payload.type !== 'video-ticket') return null;
    if (payload.iss !== AUTH_ISSUER) return null;
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function createSessionToken(payload) {
  const ttl = payload.role === 'admin' ? ADMIN_TOKEN_TTL_MS : STUDENT_TOKEN_TTL_MS;
  return signToken({
    ...payload,
    type: 'session',
    iss: AUTH_ISSUER,
    iat: Date.now(),
    exp: Date.now() + ttl,
  });
}

function createVideoTicket(payload) {
  return signToken({
    ...payload,
    type: 'video-ticket',
    iss: AUTH_ISSUER,
    iat: Date.now(),
    exp: Date.now() + 1000 * 60 * 5,
  });
}

function extractToken(req, { allowQueryTicket = false } = {}) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  if (allowQueryTicket && req.query.ticket) return String(req.query.ticket);
  return '';
}

function requireAuth(roles = [], options = {}) {
  return (req, res, next) => {
    const payload = verifyToken(extractToken(req, options));
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

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

function assert(condition, status, message) {
  if (!condition) {
    throw new HttpError(status, message);
  }
}

function asObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, `${field} must be an object`);
  }
  return value;
}

function asArray(value, field, { max = 1000 } = {}) {
  if (!Array.isArray(value)) {
    throw new HttpError(400, `${field} must be an array`);
  }
  if (value.length > max) {
    throw new HttpError(400, `${field} exceeds max size`);
  }
  return value;
}

function asTrimmedString(value, field, { max = 256, allowEmpty = false } = {}) {
  if (typeof value !== 'string') {
    throw new HttpError(400, `${field} must be a string`);
  }
  const normalized = repairText(value).trim();
  if (!allowEmpty && !normalized) {
    throw new HttpError(400, `${field} is required`);
  }
  if (normalized.length > max) {
    throw new HttpError(400, `${field} is too long`);
  }
  return normalized;
}

function asOptionalString(value, field, { max = 256 } = {}) {
  if (value == null || value === '') return '';
  return asTrimmedString(String(value), field, { max, allowEmpty: true });
}

function asEnum(value, field, allowed, fallback = null) {
  const normalized = String(value ?? '').trim();
  if (allowed.includes(normalized)) return normalized;
  if (fallback != null) return fallback;
  throw new HttpError(400, `${field} must be one of: ${allowed.join(', ')}`);
}

function asIsoDate(value, field, { allowEmpty = true } = {}) {
  if (value == null || value === '') {
    if (allowEmpty) return '';
    throw new HttpError(400, `${field} is required`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `${field} must be a valid ISO date`);
  }
  return date.toISOString();
}

function asPositiveNumber(value, field, { min = 0, max = 100000 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new HttpError(400, `${field} must be a number between ${min} and ${max}`);
  }
  return parsed;
}

function sanitizeQuestion(question, index) {
  const current = asObject(question, `question[${index}]`);
  return {
    id: asOptionalString(current.id, `question[${index}].id`, { max: 128 }) || `q-${index + 1}`,
    text: asTrimmedString(String(current.text ?? ''), `question[${index}].text`, { max: 1000 }),
    options: asArray(current.options ?? [], `question[${index}].options`, { max: 8 })
      .slice(0, 4)
      .map((option, optionIndex) => asTrimmedString(String(option ?? ''), `question[${index}].options[${optionIndex}]`, { max: 300 })),
    correctIndex: Math.round(asPositiveNumber(current.correctIndex ?? 0, `question[${index}].correctIndex`, { min: 0, max: 3 })),
  };
}

function sanitizeVideoResource(video, index) {
  const current = asObject(video, `video[${index}]`);
  const sourceType = asEnum(current.sourceType || 'url', `video[${index}].sourceType`, ['url', 'file']);
  return {
    id: asTrimmedString(String(current.id ?? ''), `video[${index}].id`, { max: 128 }),
    title: asTrimmedString(String(current.title ?? ''), `video[${index}].title`, { max: 200 }),
    duration: asOptionalString(current.duration, `video[${index}].duration`, { max: 100 }),
    poster: asOptionalString(current.poster, `video[${index}].poster`, { max: 2_000_000 }),
    summary: asOptionalString(current.summary, `video[${index}].summary`, { max: 1000 }),
    sourceType,
    source: asOptionalString(current.source, `video[${index}].source`, { max: 2_000_000 }),
    assetId: asOptionalString(current.assetId, `video[${index}].assetId`, { max: 128 }),
    fileName: asOptionalString(current.fileName, `video[${index}].fileName`, { max: 255 }),
  };
}

function sanitizePdfResource(pdf, index) {
  const current = asObject(pdf, `pdf[${index}]`);
  return {
    id: asTrimmedString(String(current.id ?? ''), `pdf[${index}].id`, { max: 128 }),
    title: asTrimmedString(String(current.title ?? ''), `pdf[${index}].title`, { max: 200 }),
    pages: Math.round(asPositiveNumber(current.pages ?? 0, `pdf[${index}].pages`, { min: 0, max: 10000 })),
    summary: asOptionalString(current.summary, `pdf[${index}].summary`, { max: 1000 }),
  };
}

function sanitizeExamResource(exam, index) {
  const current = asObject(exam, `exam[${index}]`);
  const questionsData = current.questionsData == null
    ? []
    : asArray(current.questionsData, `exam[${index}].questionsData`, { max: 200 }).map((question, questionIndex) => sanitizeQuestion(question, questionIndex));

  return {
    id: asTrimmedString(String(current.id ?? ''), `exam[${index}].id`, { max: 128 }),
    title: asTrimmedString(String(current.title ?? ''), `exam[${index}].title`, { max: 200 }),
    questions: Math.round(asPositiveNumber(current.questions ?? questionsData.length, `exam[${index}].questions`, { min: 0, max: 500 })),
    minutes: Math.round(asPositiveNumber(current.minutes ?? 0, `exam[${index}].minutes`, { min: 0, max: 600 })),
    questionsData,
  };
}

function sanitizeFolder(folder, field = 'folder') {
  const current = asObject(folder, field);
  return {
    id: asTrimmedString(String(current.id ?? ''), `${field}.id`, { max: 128 }),
    number: current.number == null ? null : Math.round(asPositiveNumber(current.number, `${field}.number`, { min: 0, max: 10000 })),
    title: asTrimmedString(String(current.title ?? ''), `${field}.title`, { max: 200 }),
    subtitle: asOptionalString(current.subtitle, `${field}.subtitle`, { max: 400 }),
    cover: asOptionalString(current.cover, `${field}.cover`, { max: 2_000_000 }),
    videos: asArray(current.videos ?? [], `${field}.videos`, { max: 300 }).map((video, index) => sanitizeVideoResource(video, index)),
    pdfs: asArray(current.pdfs ?? [], `${field}.pdfs`, { max: 300 }).map((pdf, index) => sanitizePdfResource(pdf, index)),
    exams: asArray(current.exams ?? [], `${field}.exams`, { max: 100 }).map((exam, index) => sanitizeExamResource(exam, index)),
    children: asArray(current.children ?? [], `${field}.children`, { max: 300 }).map((child, index) => sanitizeFolder(child, `${field}.children[${index}]`)),
  };
}

function sanitizeTeacher(teacher, index) {
  const current = asObject(teacher, `teacher[${index}]`);
  return {
    id: asTrimmedString(String(current.id ?? ''), `teacher[${index}].id`, { max: 128 }),
    name: asTrimmedString(String(current.name ?? ''), `teacher[${index}].name`, { max: 200 }),
    role: asOptionalString(current.role, `teacher[${index}].role`, { max: 100 }),
    image: asOptionalString(current.image, `teacher[${index}].image`, { max: 2_000_000 }),
    lessons: asArray(current.lessons ?? [], `teacher[${index}].lessons`, { max: 300 }).map((lesson, lessonIndex) => sanitizeFolder(lesson, `teacher[${index}].lessons[${lessonIndex}]`)),
  };
}

function sanitizeSubject(subject, index) {
  const current = asObject(subject, `subject[${index}]`);
  return {
    id: asTrimmedString(String(current.id ?? ''), `subject[${index}].id`, { max: 128 }),
    name: asTrimmedString(String(current.name ?? ''), `subject[${index}].name`, { max: 200 }),
    label: asOptionalString(current.label, `subject[${index}].label`, { max: 200 }),
    cover: asOptionalString(current.cover, `subject[${index}].cover`, { max: 2_000_000 }),
    year: asOptionalString(current.year, `subject[${index}].year`, { max: 20 }),
    teachers: asArray(current.teachers ?? [], `subject[${index}].teachers`, { max: 300 }).map((teacher, teacherIndex) => sanitizeTeacher(teacher, teacherIndex)),
  };
}

function sanitizeStudentProfile(profile, field = 'profile') {
  const current = asObject(profile, field);
  return {
    name: asTrimmedString(String(current.name ?? ''), `${field}.name`, { max: 120 }),
    level: asTrimmedString(String(current.level ?? ''), `${field}.level`, { max: 64 }),
    track: asOptionalString(current.track, `${field}.track`, { max: 64 }),
    major: asOptionalString(current.major, `${field}.major`, { max: 64 }),
  };
}

function sanitizeStudentCode(code, index) {
  const current = asObject(code, `code[${index}]`);
  return {
    id: asTrimmedString(String(current.id ?? ''), `code[${index}].id`, { max: 128 }),
    value: asTrimmedString(String(current.value ?? ''), `code[${index}].value`, { max: 64 }),
    status: asEnum(current.status || 'unused', `code[${index}].status`, ['unused', 'active', 'disabled'], 'unused'),
    createdAt: asIsoDate(current.createdAt || new Date().toISOString(), `code[${index}].createdAt`, { allowEmpty: false }),
    activatedAt: asIsoDate(current.activatedAt || '', `code[${index}].activatedAt`, { allowEmpty: true }),
    profile: sanitizeStudentProfile(current.profile ?? {}, `code[${index}].profile`),
  };
}

function sanitizeLessonCode(code, index) {
  const current = asObject(code, `lessonCode[${index}]`);
  return {
    id: asTrimmedString(String(current.id ?? ''), `lessonCode[${index}].id`, { max: 128 }),
    value: asTrimmedString(String(current.value ?? ''), `lessonCode[${index}].value`, { max: 64 }),
    lessonId: asOptionalString(current.lessonId, `lessonCode[${index}].lessonId`, { max: 128 }),
    folderId: asOptionalString(current.folderId, `lessonCode[${index}].folderId`, { max: 128 }),
    subjectId: asOptionalString(current.subjectId, `lessonCode[${index}].subjectId`, { max: 128 }),
    subjectName: asOptionalString(current.subjectName, `lessonCode[${index}].subjectName`, { max: 200 }),
    teacherId: asOptionalString(current.teacherId, `lessonCode[${index}].teacherId`, { max: 128 }),
    teacherName: asOptionalString(current.teacherName, `lessonCode[${index}].teacherName`, { max: 200 }),
    lessonTitle: asOptionalString(current.lessonTitle, `lessonCode[${index}].lessonTitle`, { max: 200 }),
    status: asEnum(current.status || 'unused', `lessonCode[${index}].status`, ['unused', 'claimed'], 'unused'),
    createdAt: asIsoDate(current.createdAt || new Date().toISOString(), `lessonCode[${index}].createdAt`, { allowEmpty: false }),
    claimedAt: asIsoDate(current.claimedAt || '', `lessonCode[${index}].claimedAt`, { allowEmpty: true }),
    claimedByStudentCodeId: asOptionalString(current.claimedByStudentCodeId, `lessonCode[${index}].claimedByStudentCodeId`, { max: 128 }),
  };
}

function sanitizeContentItem(item, index) {
  const current = asObject(item, `content[${index}]`);
  return {
    id: asTrimmedString(String(current.id ?? ''), `content[${index}].id`, { max: 128 }),
    type: asEnum(current.type, `content[${index}].type`, ['video', 'pdf']),
    title: asTrimmedString(String(current.title ?? ''), `content[${index}].title`, { max: 200 }),
    subject: asTrimmedString(String(current.subject ?? ''), `content[${index}].subject`, { max: 200 }),
    level: asTrimmedString(String(current.level ?? ''), `content[${index}].level`, { max: 64 }),
    track: asOptionalString(current.track, `content[${index}].track`, { max: 64 }),
    major: asOptionalString(current.major, `content[${index}].major`, { max: 64 }),
    meta: asOptionalString(current.meta, `content[${index}].meta`, { max: 200 }),
    secure: Boolean(current.secure),
    status: asEnum(current.status || 'draft', `content[${index}].status`, ['draft', 'published'], 'draft'),
    url: asOptionalString(current.url, `content[${index}].url`, { max: 2000 }),
    description: asOptionalString(current.description, `content[${index}].description`, { max: 1000 }),
    createdAt: asIsoDate(current.createdAt || new Date().toISOString(), `content[${index}].createdAt`, { allowEmpty: false }),
  };
}

function sanitizeStandaloneExam(exam, index) {
  const current = asObject(exam, `standaloneExam[${index}]`);
  return {
    id: asTrimmedString(String(current.id ?? ''), `standaloneExam[${index}].id`, { max: 128 }),
    title: asTrimmedString(String(current.title ?? ''), `standaloneExam[${index}].title`, { max: 200 }),
    subject: asTrimmedString(String(current.subject ?? ''), `standaloneExam[${index}].subject`, { max: 200 }),
    level: asTrimmedString(String(current.level ?? ''), `standaloneExam[${index}].level`, { max: 64 }),
    track: asOptionalString(current.track, `standaloneExam[${index}].track`, { max: 64 }),
    major: asOptionalString(current.major, `standaloneExam[${index}].major`, { max: 64 }),
    questions: Math.round(asPositiveNumber(current.questions ?? 0, `standaloneExam[${index}].questions`, { min: 0, max: 500 })),
    minutes: Math.round(asPositiveNumber(current.minutes ?? 0, `standaloneExam[${index}].minutes`, { min: 0, max: 600 })),
    status: asEnum(current.status || 'closed', `standaloneExam[${index}].status`, ['open', 'closed'], 'closed'),
    createdAt: asIsoDate(current.createdAt || new Date().toISOString(), `standaloneExam[${index}].createdAt`, { allowEmpty: false }),
  };
}

function sanitizeLessonAccessRecord(item, index) {
  const current = asObject(item, `lessonAccess[${index}]`);
  return {
    id: asTrimmedString(String(current.id ?? ''), `lessonAccess[${index}].id`, { max: 128 }),
    studentCodeId: asTrimmedString(String(current.studentCodeId ?? ''), `lessonAccess[${index}].studentCodeId`, { max: 128 }),
    lessonId: asTrimmedString(String(current.lessonId ?? ''), `lessonAccess[${index}].lessonId`, { max: 128 }),
    folderId: asOptionalString(current.folderId, `lessonAccess[${index}].folderId`, { max: 128 }),
    codeId: asOptionalString(current.codeId, `lessonAccess[${index}].codeId`, { max: 128 }),
    purchasedAt: asIsoDate(current.purchasedAt || new Date().toISOString(), `lessonAccess[${index}].purchasedAt`, { allowEmpty: false }),
  };
}

function sanitizeStoreSections(patch) {
  const current = asObject(patch, 'store');
  const sanitized = {};

  if (current['thanwya.codes'] != null || current.codes != null) {
    const source = current['thanwya.codes'] ?? current.codes;
    sanitized['thanwya.codes'] = asArray(source, 'thanwya.codes', { max: 5000 }).map((code, index) => sanitizeStudentCode(code, index));
  }
  if (current['thanwya.lessonCodes'] != null || current.lessonCodes != null) {
    const source = current['thanwya.lessonCodes'] ?? current.lessonCodes;
    sanitized['thanwya.lessonCodes'] = asArray(source, 'thanwya.lessonCodes', { max: 5000 }).map((code, index) => sanitizeLessonCode(code, index));
  }
  if (current['thanwya.content'] != null || current.content != null) {
    const source = current['thanwya.content'] ?? current.content;
    sanitized['thanwya.content'] = asArray(source, 'thanwya.content', { max: 5000 }).map((item, index) => sanitizeContentItem(item, index));
  }
  if (current['thanwya.exams'] != null || current.exams != null) {
    const source = current['thanwya.exams'] ?? current.exams;
    sanitized['thanwya.exams'] = asArray(source, 'thanwya.exams', { max: 1000 }).map((exam, index) => sanitizeStandaloneExam(exam, index));
  }
  if (current['thanwya.library'] != null || current.library != null) {
    const source = current['thanwya.library'] ?? current.library;
    sanitized['thanwya.library'] = asArray(source, 'thanwya.library', { max: 500 }).map((subject, index) => sanitizeSubject(subject, index));
  }
  if (current['thanwya.theme'] != null || current.theme != null) {
    const theme = current['thanwya.theme'] ?? current.theme;
    sanitized['thanwya.theme'] = asEnum(theme || 'light', 'thanwya.theme', ['light', 'dark'], 'light');
  }

  return sanitized;
}

function sanitizeStoreShape(store) {
  const current = asObject(store, 'store');
  return {
    'thanwya.meta': sanitizeMeta(current['thanwya.meta']),
    'thanwya.codes': asArray(current['thanwya.codes'] ?? [], 'thanwya.codes', { max: 5000 }).map((code, index) => sanitizeStudentCode(code, index)),
    'thanwya.lessonCodes': asArray(current['thanwya.lessonCodes'] ?? [], 'thanwya.lessonCodes', { max: 5000 }).map((code, index) => sanitizeLessonCode(code, index)),
    'thanwya.lessonAccess': asArray(current['thanwya.lessonAccess'] ?? [], 'thanwya.lessonAccess', { max: 10000 }).map((item, index) => sanitizeLessonAccessRecord(item, index)),
    'thanwya.content': asArray(current['thanwya.content'] ?? [], 'thanwya.content', { max: 5000 }).map((item, index) => sanitizeContentItem(item, index)),
    'thanwya.exams': asArray(current['thanwya.exams'] ?? [], 'thanwya.exams', { max: 1000 }).map((exam, index) => sanitizeStandaloneExam(exam, index)),
    'thanwya.library': asArray(current['thanwya.library'] ?? [], 'thanwya.library', { max: 500 }).map((subject, index) => sanitizeSubject(subject, index)),
    'thanwya.theme': asEnum(current['thanwya.theme'] || 'light', 'thanwya.theme', ['light', 'dark'], 'light'),
  };
}

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return {
      admin: null,
      version: 2,
      updatedAt: '',
    };
  }

  const admin = meta.admin && typeof meta.admin === 'object' && !Array.isArray(meta.admin)
    ? {
        salt: asOptionalString(meta.admin.salt, 'thanwya.meta.admin.salt', { max: 128 }),
        hash: asOptionalString(meta.admin.hash, 'thanwya.meta.admin.hash', { max: 256 }),
        createdAt: asIsoDate(meta.admin.createdAt || '', 'thanwya.meta.admin.createdAt', { allowEmpty: true }),
        updatedAt: asIsoDate(meta.admin.updatedAt || '', 'thanwya.meta.admin.updatedAt', { allowEmpty: true }),
      }
    : null;

  return {
    admin: admin?.salt && admin?.hash ? admin : null,
    version: 2,
    updatedAt: asIsoDate(meta.updatedAt || '', 'thanwya.meta.updatedAt', { allowEmpty: true }),
  };
}

function hashSecret(secret, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(secret, salt, 64).toString('hex');
  return { salt, hash };
}

function verifySecret(secret, hash, salt) {
  const next = scryptSync(secret, salt, 64).toString('hex');
  return safeSignatureEquals(next, hash);
}

async function readStore() {
  const candidates = [storePath, storeBackupPath];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const raw = await readFile(candidate, 'utf8');
      const parsed = normalizeValue(JSON.parse(raw));
      return migrateStore(sanitizeStoreShape(parsed));
    } catch (error) {
      log('warn', 'Failed to read store candidate', {
        path: candidate,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return migrateStore({
    'thanwya.meta': sanitizeMeta(null),
    'thanwya.codes': [],
    'thanwya.lessonCodes': [],
    'thanwya.lessonAccess': [],
    'thanwya.content': [],
    'thanwya.exams': [],
    'thanwya.library': [],
    'thanwya.theme': 'light',
  });
}

async function writeStore(store) {
  const sanitized = migrateStore(sanitizeStoreShape(store));
  sanitized['thanwya.meta'] = {
    ...sanitizeMeta(sanitized['thanwya.meta']),
    updatedAt: new Date().toISOString(),
  };

  const serialized = JSON.stringify(normalizeValue(sanitized), null, 2);
  await writeFile(storeTempPath, serialized, 'utf8');
  if (existsSync(storePath)) {
    await copyFile(storePath, storeBackupPath);
  }
  await copyFile(storeTempPath, storePath);
  await unlink(storeTempPath).catch(() => {});
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
      walkLessons(teacher.lessons ?? [], (folder, _parent, currentSubject, currentTeacher) => {
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
      walkLessons(teacher.lessons ?? [], (folder, _parent, currentSubject, currentTeacher) => {
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

function migrateStore(store) {
  const next = { ...store };
  next['thanwya.meta'] = sanitizeMeta(next['thanwya.meta']);
  next['thanwya.codes'] = Array.isArray(next['thanwya.codes']) ? next['thanwya.codes'] : [];
  next['thanwya.lessonCodes'] = Array.isArray(next['thanwya.lessonCodes']) ? next['thanwya.lessonCodes'] : [];
  next['thanwya.lessonAccess'] = Array.isArray(next['thanwya.lessonAccess']) ? next['thanwya.lessonAccess'] : [];
  next['thanwya.content'] = Array.isArray(next['thanwya.content']) ? next['thanwya.content'] : [];
  next['thanwya.exams'] = Array.isArray(next['thanwya.exams']) ? next['thanwya.exams'] : [];
  next['thanwya.library'] = Array.isArray(next['thanwya.library']) ? next['thanwya.library'] : [];
  next['thanwya.theme'] = next['thanwya.theme'] === 'dark' ? 'dark' : 'light';
  return next;
}

function isAdminConfigured(store) {
  return Boolean(store['thanwya.meta']?.admin?.hash && store['thanwya.meta']?.admin?.salt);
}

function buildStudentAccessList(store, studentCodeId) {
  return store['thanwya.lessonAccess']
    .filter((item) => item.studentCodeId === studentCodeId)
    .map((item) => ({ ...item }));
}

function studentHasLessonAccess(store, studentCodeId, lessonId) {
  return store['thanwya.lessonAccess'].some((item) => item.studentCodeId === studentCodeId && item.lessonId === lessonId);
}

function findStudentCode(store, codeValue) {
  const normalized = String(codeValue ?? '').trim().toUpperCase();
  return store['thanwya.codes'].find((item) => {
    const itemValue = String(item.value ?? '').trim().toUpperCase();
    const itemId = String(item.id ?? '').trim().toUpperCase();
    return itemValue === normalized || itemId === normalized;
  }) ?? null;
}

function buildStudentPayload(studentCode) {
  return {
    role: 'student',
    studentCodeId: studentCode.id,
    studentCodeValue: studentCode.value,
    studentName: studentCode.profile?.name ?? 'Student',
  };
}

function serializeStudentProfile(studentCode) {
  return {
    ...studentCode.profile,
    codeId: studentCode.id,
    code: studentCode.value,
    createdAt: studentCode.createdAt,
    activatedAt: studentCode.activatedAt || '',
    status: studentCode.status,
  };
}

function serializeAdminStore(store) {
  return {
    'thanwya.codes': store['thanwya.codes'],
    'thanwya.lessonCodes': store['thanwya.lessonCodes'],
    'thanwya.content': store['thanwya.content'],
    'thanwya.exams': store['thanwya.exams'],
    'thanwya.library': store['thanwya.library'],
    'thanwya.theme': store['thanwya.theme'],
  };
}

async function validateUploadedFile(file) {
  assert(Boolean(file), 400, 'Missing file');

  const ext = path.extname(file.originalname || '').toLowerCase();
  const mime = String(file.mimetype || '').toLowerCase();
  assert(UPLOAD_ALLOWED_EXTENSIONS.includes(ext), 400, `Unsupported file extension: ${ext || 'unknown'}`);
  assert(UPLOAD_ALLOWED_MIME_TYPES.includes(mime), 400, `Unsupported file type: ${mime || 'unknown'}`);

  const chunk = await readFile(file.path);
  const signature = chunk.subarray(0, 16);
  const hasFtyp = chunk.includes(Buffer.from('ftyp'));
  const isWebm = signature.length >= 4
    && signature[0] === 0x1a
    && signature[1] === 0x45
    && signature[2] === 0xdf
    && signature[3] === 0xa3;

  if (ext === '.webm') {
    assert(isWebm, 400, 'Uploaded WEBM signature is invalid');
    return;
  }

  assert(hasFtyp, 400, 'Uploaded MP4/MOV signature is invalid');
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    environment: NODE_ENV,
    adminBootstrapEnabled: Boolean(ADMIN_BOOTSTRAP_TOKEN),
  });
});

app.get('/api/auth/config', async (_req, res) => {
  const store = await readStore();
  res.json({
    adminConfigured: isAdminConfigured(store),
    bootstrapEnabled: Boolean(ADMIN_BOOTSTRAP_TOKEN),
  });
});

app.post('/api/auth/admin/bootstrap', async (req, res) => {
  const body = asObject(req.body ?? {}, 'body');
  const bootstrapToken = asTrimmedString(String(body.bootstrapToken ?? ''), 'bootstrapToken', { max: 256 });
  const adminCode = asTrimmedString(String(body.adminCode ?? ''), 'adminCode', { max: 256 });
  const store = await readStore();

  assert(Boolean(ADMIN_BOOTSTRAP_TOKEN), 503, 'Admin bootstrap is disabled');
  assert(!isAdminConfigured(store), 409, 'Admin is already configured');
  assert(safeSignatureEquals(bootstrapToken, ADMIN_BOOTSTRAP_TOKEN), 401, 'Invalid bootstrap token');
  assert(adminCode.length >= 12, 400, 'Admin access code must be at least 12 characters');

  const { salt, hash } = hashSecret(adminCode);
  store['thanwya.meta'] = {
    ...store['thanwya.meta'],
    admin: {
      salt,
      hash,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };

  await writeStore(store);
  log('info', 'Admin bootstrap completed');
  res.status(201).json({ ok: true });
});

app.post('/api/auth/login', async (req, res) => {
  const body = asObject(req.body ?? {}, 'body');
  const code = asTrimmedString(String(body.code ?? ''), 'code', { max: 256 });
  const store = await readStore();
  const adminConfigured = isAdminConfigured(store);
  const rateKey = `login:${code.toLowerCase()}`;

  if (adminConfigured) {
    const adminConfig = store['thanwya.meta'].admin;
    if (verifySecret(code, adminConfig.hash, adminConfig.salt)) {
      clearFailedAttempts('/api/auth/login', req, rateKey);
      const token = createSessionToken({ role: 'admin' });
      return res.json({
        role: 'admin',
        token,
      });
    }
  }

  const studentCode = findStudentCode(store, code);
  if (!studentCode || studentCode.status === 'disabled') {
    const attempt = recordFailedAttempt('/api/auth/login', req, rateKey);
    if (attempt.limited) {
      return res.status(429).json({ error: 'Too many attempts' });
    }

    if (!adminConfigured && !studentCode) {
      return res.status(401).json({ error: 'Invalid code or admin is not configured yet' });
    }

    return res.status(401).json({ error: 'Invalid code' });
  }

  clearFailedAttempts('/api/auth/login', req, rateKey);

  const activatedAt = studentCode.activatedAt || new Date().toISOString();
  if (!studentCode.activatedAt || studentCode.status === 'unused') {
    store['thanwya.codes'] = store['thanwya.codes'].map((item) => (
      item.id === studentCode.id
        ? { ...item, status: 'active', activatedAt }
        : item
    ));
    await writeStore(store);
  }

  const refreshedStore = await readStore();
  const refreshedCode = findStudentCode(refreshedStore, code);
  const token = createSessionToken(buildStudentPayload(refreshedCode));

  return res.json({
    role: 'student',
    token,
    profile: serializeStudentProfile(refreshedCode),
    access: buildStudentAccessList(refreshedStore, refreshedCode.id),
  });
});

app.get('/api/auth/me', requireAuth(), async (req, res) => {
  const store = await readStore();
  if (req.auth.role === 'admin') {
    return res.json({
      role: 'admin',
      token: createSessionToken({ role: 'admin' }),
    });
  }

  const studentCode = store['thanwya.codes'].find((item) => item.id === req.auth.studentCodeId);
  if (!studentCode || studentCode.status === 'disabled') {
    return res.status(401).json({ error: 'Student session is no longer valid' });
  }

  return res.json({
    role: 'student',
    token: createSessionToken(buildStudentPayload(studentCode)),
    profile: serializeStudentProfile(studentCode),
    access: buildStudentAccessList(store, studentCode.id),
  });
});

app.get('/api/admin/store', requireAuth(['admin']), async (_req, res) => {
  res.json(serializeAdminStore(await readStore()));
});

app.patch('/api/admin/store', requireAuth(['admin']), async (req, res) => {
  const patch = sanitizeStoreSections(req.body ?? {});
  assert(Object.keys(patch).length > 0, 400, 'No valid store sections provided');

  const current = await readStore();
  const next = {
    ...current,
    ...patch,
  };

  await writeStore(next);
  log('info', 'Admin store sections updated', { sections: Object.keys(patch) });
  res.json({
    ok: true,
    updated: Object.keys(patch),
    store: serializeAdminStore(await readStore()),
  });
});

app.post('/api/lesson-codes', requireAuth(['admin']), async (req, res) => {
  const body = asObject(req.body ?? {}, 'body');
  const lessonId = asTrimmedString(String(body.lessonId ?? ''), 'lessonId', { max: 128 });
  const store = await readStore();
  const lesson = findLessonById(store['thanwya.library'], lessonId);
  if (!lesson) return res.status(400).json({ error: 'Invalid lesson' });

  const code = sanitizeLessonCode({
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
  }, 0);

  store['thanwya.lessonCodes'] = [code, ...store['thanwya.lessonCodes'].filter((item) => String(item.lessonId) !== String(lesson.folder.id))];
  await writeStore(store);
  res.json({ code });
});

app.get('/api/student/access', requireAuth(['student']), async (req, res) => {
  const store = await readStore();
  res.json({ access: buildStudentAccessList(store, req.auth.studentCodeId) });
});

app.post('/api/student/lesson-access/claim', requireAuth(['student']), async (req, res) => {
  const body = asObject(req.body ?? {}, 'body');
  const codeValue = asTrimmedString(String(body.code ?? ''), 'code', { max: 64 });
  const store = await readStore();
  const rateKey = `claim:${req.auth.studentCodeId}:${codeValue.toUpperCase()}`;
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

  const access = sanitizeLessonAccessRecord({
    id: `access-${randomUUID()}`,
    studentCodeId: req.auth.studentCodeId,
    lessonId: lessonCode.lessonId,
    folderId: lessonCode.folderId || lessonCode.lessonId,
    codeId: lessonCode.id,
    purchasedAt: new Date().toISOString(),
  }, 0);

  store['thanwya.lessonAccess'] = [access, ...store['thanwya.lessonAccess']];
  store['thanwya.lessonCodes'] = store['thanwya.lessonCodes'].map((item) => (
    item.id === lessonCode.id
      ? { ...item, status: 'claimed', claimedAt: access.purchasedAt, claimedByStudentCodeId: req.auth.studentCodeId }
      : item
  ));
  await writeStore(store);
  clearFailedAttempts('/api/student/lesson-access/claim', req, rateKey);
  res.json({ ok: true, unlocked: true, access });
});

app.get('/api/uploads/video/:id/access', requireAuth(), async (req, res) => {
  const store = await readStore();
  const assetId = asTrimmedString(String(req.params.id ?? ''), 'assetId', { max: 128 });
  const asset = findVideoByAssetId(store['thanwya.library'], assetId);
  if (!asset) return res.status(404).json({ error: 'Not found' });

  if (req.auth.role !== 'admin' && !studentHasLessonAccess(store, req.auth.studentCodeId, asset.lesson.id)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const ticket = createVideoTicket({
    role: req.auth.role,
    videoId: assetId,
    lessonId: asset.lesson.id,
    studentCodeId: req.auth.studentCodeId || '',
  });

  res.json({ url: `/api/uploads/video/${encodeURIComponent(assetId)}?ticket=${encodeURIComponent(ticket)}` });
});

app.get('/api/uploads/video/:id', requireAuth([], { allowQueryTicket: true }), async (req, res) => {
  const assetId = asTrimmedString(String(req.params.id ?? ''), 'assetId', { max: 128 });
  const store = await readStore();
  const asset = findVideoByAssetId(store['thanwya.library'], assetId);
  const payload = req.auth;

  if (!asset) return res.status(404).end();

  if (payload.type === 'video-ticket') {
    if (payload.videoId !== assetId || payload.lessonId !== asset.lesson.id) {
      return res.status(403).end();
    }
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
  await validateUploadedFile(req.file);
  const assetId = `video-${randomUUID()}`;
  const ext = path.extname(req.file.originalname || '.mp4') || '.mp4';
  const finalName = `${assetId}${ext}`;
  const finalPath = path.join(uploadsDir, finalName);
  await rename(req.file.path, finalPath);
  res.status(201).json({
    id: assetId,
    fileName: req.file.originalname,
    url: `/api/uploads/video/${assetId}`,
  });
});

app.delete('/api/uploads/video/:id', requireAuth(['admin']), async (req, res) => {
  const assetId = asTrimmedString(String(req.params.id ?? ''), 'assetId', { max: 128 });
  const files = await readdir(uploadsDir);
  const file = files.find((name) => name.startsWith(`${assetId}.`) || name === assetId);
  if (file) {
    await unlink(path.join(uploadsDir, file));
  }
  res.json({ ok: true });
});

if (SERVE_STATIC && existsSync(path.join(rootDir, 'dist'))) {
  app.use(APP_BASE_PATH, express.static(path.join(rootDir, 'dist')));
  app.get(`${APP_BASE_PATH === '/' ? '' : APP_BASE_PATH}/*`, (_req, res) => {
    res.sendFile(path.join(rootDir, 'dist', 'index.html'));
  });
}

app.use((error, req, res, _next) => {
  if (req.file?.path) {
    unlink(req.file.path).catch(() => {});
  }

  const status = error instanceof HttpError
    ? error.status
    : error?.name === 'MulterError'
      ? 400
      : 500;

  const message = error instanceof HttpError
    ? error.message
    : error?.name === 'MulterError'
      ? error.message
      : 'Internal server error';

  log(status >= 500 ? 'error' : 'warn', 'Request failed', {
    method: req.method,
    path: req.originalUrl,
    status,
    error: error instanceof Error ? error.message : String(error),
  });

  res.status(status).json({ error: message });
});

const port = Number(process.env.PORT || 3001);

if (process.argv[1] === __filename) {
  app.listen(port, () => {
    log('info', 'Thanwya API running', {
      url: `http://127.0.0.1:${port}`,
      env: NODE_ENV,
      serveStatic: SERVE_STATIC,
      basePath: APP_BASE_PATH,
    });
  });
}

export default app;
