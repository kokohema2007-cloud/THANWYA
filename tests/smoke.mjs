import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 4181;
const baseUrl = `http://127.0.0.1:${port}`;

function waitForServer(proc) {
  return new Promise((resolve, reject) => {
    const onData = (chunk) => {
      const text = String(chunk);
      if (text.includes('Thanwya API running')) {
        cleanup();
        resolve();
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      proc.stdout.off('data', onData);
      proc.stderr.off('data', onData);
      proc.off('error', onError);
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', onError);
  });
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  return { response, data };
}

function authHeaders(token, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    ...extra,
  };
}

function findFirstLesson(library) {
  for (const subject of library ?? []) {
    for (const teacher of subject.teachers ?? []) {
      const stack = [...(teacher.lessons ?? [])];
      while (stack.length) {
        const lesson = stack.shift();
        if (lesson) return { subject, teacher, lesson };
        stack.push(...(lesson?.children ?? []));
      }
    }
  }
  return null;
}

function findFirstExam(library) {
  const lessonRef = findFirstLesson(library);
  const exam = lessonRef?.lesson?.exams?.[0] ?? null;
  return exam ? { ...lessonRef, exam } : null;
}

function createFakeStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

const fakeMp4 = Buffer.from([
  0x00, 0x00, 0x00, 0x18,
  0x66, 0x74, 0x79, 0x70,
  0x69, 0x73, 0x6f, 0x6d,
  0x00, 0x00, 0x02, 0x00,
  0x69, 0x73, 0x6f, 0x6d,
  0x69, 0x73, 0x6f, 0x32,
]);

const fakePdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'utf8');

let server;
try {
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: String(port),
      AUTH_SECRET: 'smoke-secret',
      ADMIN_BOOTSTRAP_TOKEN: 'smoke-bootstrap-token',
      CORS_ORIGINS: 'http://127.0.0.1:5173',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await waitForServer(server);

  const configBefore = await requestJson(`${baseUrl}/api/auth/config`);
  assert.equal(configBefore.response.ok, true);
  assert.equal(configBefore.data.adminConfigured, false);
  assert.equal(configBefore.data.bootstrapEnabled, true);

  const bootstrap = await requestJson(`${baseUrl}/api/auth/admin/bootstrap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bootstrapToken: 'smoke-bootstrap-token',
      adminCode: 'super-secure-admin-code',
    }),
  });
  assert.equal(bootstrap.response.status, 201);

  const configAfter = await requestJson(`${baseUrl}/api/auth/config`);
  assert.equal(configAfter.data.adminConfigured, true);

  const adminLogin = await requestJson(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'super-secure-admin-code' }),
  });
  assert.equal(adminLogin.response.ok, true);
  assert.equal(adminLogin.data.role, 'admin');
  const adminToken = adminLogin.data.token;

  await new Promise((resolve) => setTimeout(resolve, 5));
  const adminRefresh = await requestJson(`${baseUrl}/api/auth/me`, {
    headers: authHeaders(adminToken),
  });
  assert.equal(adminRefresh.response.ok, true);
  assert.equal(adminRefresh.data.role, 'admin');
  assert.ok(adminRefresh.data.token);
  const refreshedAdminToken = adminRefresh.data.token;

  const adminStore = await requestJson(`${baseUrl}/api/admin/store`, {
    headers: authHeaders(refreshedAdminToken),
  });
  assert.equal(adminStore.response.ok, true);
  const lessonRef = findFirstLesson(adminStore.data['thanwya.library']);
  assert.ok(lessonRef, 'expected at least one lesson in the library');
  const examRef = findFirstExam(adminStore.data['thanwya.library']);
  assert.ok(examRef, 'expected at least one lesson exam in the library');
  assert.ok(examRef.exam.id, 'expected lesson exam to have an id');
  assert.ok(Array.isArray(examRef.exam.questionsData), 'expected lesson exam questionsData array');
  assert.ok(examRef.exam.questionsData.length > 0, 'expected lesson exam questionsData to be populated');

  const studentCode = {
    id: 'smoke-student-1',
    value: '50000001',
    status: 'unused',
    createdAt: new Date().toISOString(),
    activatedAt: '',
    profile: {
      name: 'Smoke Student',
      level: 'secondary-3',
      track: 'science',
      major: 'math',
    },
  };

  const syncCodes = await requestJson(`${baseUrl}/api/admin/store`, {
    method: 'PATCH',
    headers: authHeaders(refreshedAdminToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      'thanwya.codes': [studentCode],
    }),
  });
  assert.equal(syncCodes.response.ok, true);

  const createCode = await requestJson(`${baseUrl}/api/lesson-codes`, {
    method: 'POST',
    headers: authHeaders(refreshedAdminToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ lessonId: lessonRef.lesson.id }),
  });
  assert.equal(createCode.response.ok, true);
  assert.ok(createCode.data.code.value);

  const studentLogin = await requestJson(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: studentCode.value }),
  });
  assert.equal(studentLogin.response.ok, true);
  assert.equal(studentLogin.data.role, 'student');
  const studentToken = studentLogin.data.token;
  assert.equal(studentLogin.data.profile.code, studentCode.value);

  await new Promise((resolve) => setTimeout(resolve, 5));
  const studentRefresh = await requestJson(`${baseUrl}/api/auth/me`, {
    headers: authHeaders(studentToken),
  });
  assert.equal(studentRefresh.response.ok, true);
  assert.equal(studentRefresh.data.role, 'student');
  assert.ok(Array.isArray(studentRefresh.data.access));
  const refreshedStudentToken = studentRefresh.data.token;

  global.sessionStorage = createFakeStorage();
  const authSessionUrl = new URL('../src/authSession.js', import.meta.url);
  const authSession = await import(authSessionUrl.href);
  authSession.setStoredSession({
    role: 'student',
    token: refreshedStudentToken,
    profile: studentRefresh.data.profile,
    access: studentRefresh.data.access,
  });
  assert.equal(authSession.getStoredSession()?.token, refreshedStudentToken);
  authSession.clearStoredSession();
  assert.equal(authSession.getStoredSession(), null);

  for (let i = 0; i < 5; i += 1) {
    const failedClaim = await requestJson(`${baseUrl}/api/student/lesson-access/claim`, {
      method: 'POST',
      headers: authHeaders(refreshedStudentToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ code: 'bad-lesson-code' }),
    });
    assert.equal(failedClaim.response.status, 400);
  }
  const limitedClaim = await requestJson(`${baseUrl}/api/student/lesson-access/claim`, {
    method: 'POST',
    headers: authHeaders(refreshedStudentToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ code: 'bad-lesson-code' }),
  });
  assert.equal(limitedClaim.response.status, 429);

  const claim = await requestJson(`${baseUrl}/api/student/lesson-access/claim`, {
    method: 'POST',
    headers: authHeaders(refreshedStudentToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ code: createCode.data.code.value }),
  });
  assert.equal(claim.response.ok, true);
  assert.equal(claim.data.unlocked, true);

  const freshBrowserLogin = await requestJson(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: studentCode.value }),
  });
  assert.equal(freshBrowserLogin.response.ok, true);
  const freshBrowserToken = freshBrowserLogin.data.token;

  const studentAccess = await requestJson(`${baseUrl}/api/student/access`, {
    headers: authHeaders(freshBrowserToken),
  });
  assert.ok(studentAccess.data.access.some((item) => item.lessonId === lessonRef.lesson.id));

  const publicState = await requestJson(`${baseUrl}/api/public/state`);
  assert.equal(publicState.response.ok, true);
  const publicExamRef = findFirstExam(publicState.data['thanwya.library']);
  assert.ok(publicExamRef, 'expected public lesson exam to be present');
  assert.equal(publicExamRef.lesson.id, lessonRef.lesson.id);
  assert.ok(publicExamRef.exam.id, 'expected public lesson exam id');
  assert.ok(Array.isArray(publicExamRef.exam.questionsData), 'expected public lesson exam questionsData array');
  assert.ok(publicExamRef.exam.questionsData.length > 0, 'expected public lesson exam to expose questionsData');

  const uploadForm = new FormData();
  uploadForm.append('file', new Blob([fakeMp4], { type: 'video/mp4' }), 'smoke.mp4');
  const upload = await fetch(`${baseUrl}/api/uploads/video`, {
    method: 'POST',
    headers: authHeaders(refreshedAdminToken),
    body: uploadForm,
  });
  assert.equal(upload.ok, true);
  const uploadData = await upload.json();

  const updatedLibrary = structuredClone(adminStore.data['thanwya.library']);
  updatedLibrary[0].teachers[0].lessons[0].videos = [
    ...(updatedLibrary[0].teachers[0].lessons[0].videos ?? []),
    {
      id: 'smoke-video',
      title: 'Smoke Video',
      duration: '1 minute',
      sourceType: 'file',
      source: '',
      assetId: uploadData.id,
      fileName: 'smoke.mp4',
      poster: updatedLibrary[0].teachers[0].lessons[0].cover,
      summary: 'Smoke test video',
    },
  ];

  const syncLibrary = await requestJson(`${baseUrl}/api/admin/store`, {
    method: 'PATCH',
    headers: authHeaders(refreshedAdminToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      'thanwya.library': updatedLibrary,
    }),
  });
  assert.equal(syncLibrary.response.ok, true);

  const pdfForm = new FormData();
  pdfForm.append('file', new Blob([fakePdf], { type: 'application/pdf' }), 'smoke.pdf');
  const pdfUpload = await fetch(`${baseUrl}/api/uploads/pdf`, {
    method: 'POST',
    headers: authHeaders(refreshedAdminToken),
    body: pdfForm,
  });
  assert.equal(pdfUpload.ok, true);
  const pdfUploadData = await pdfUpload.json();

  const libraryWithPdf = structuredClone(syncLibrary.data.store['thanwya.library']);
  libraryWithPdf[0].teachers[0].lessons[0].pdfs = [
    ...(libraryWithPdf[0].teachers[0].lessons[0].pdfs ?? []),
    {
      id: 'smoke-pdf',
      title: 'Smoke PDF',
      pages: 1,
      summary: 'Smoke test PDF',
      assetId: pdfUploadData.id,
      fileName: 'smoke.pdf',
    },
  ];

  const syncLibraryWithPdf = await requestJson(`${baseUrl}/api/admin/store`, {
    method: 'PATCH',
    headers: authHeaders(refreshedAdminToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      'thanwya.library': libraryWithPdf,
    }),
  });
  assert.equal(syncLibraryWithPdf.response.ok, true);

  const secondStudentCode = {
    id: 'smoke-student-2',
    value: '50000002',
    status: 'unused',
    createdAt: new Date().toISOString(),
    activatedAt: '',
    profile: {
      name: 'Smoke Student 2',
      level: 'secondary-3',
      track: 'science',
      major: 'math',
    },
  };

  await requestJson(`${baseUrl}/api/admin/store`, {
    method: 'PATCH',
    headers: authHeaders(refreshedAdminToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      'thanwya.codes': [studentCode, secondStudentCode],
    }),
  });

  const secondStudentLogin = await requestJson(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: secondStudentCode.value }),
  });
  const secondStudentToken = secondStudentLogin.data.token;

  const unauthorizedVideo = await fetch(`${baseUrl}/api/uploads/video/${encodeURIComponent(uploadData.id)}/access`, {
    headers: authHeaders(secondStudentToken),
  });
  assert.equal(unauthorizedVideo.status, 403);

  const authorizedVideo = await requestJson(`${baseUrl}/api/uploads/video/${encodeURIComponent(uploadData.id)}/access`, {
    headers: authHeaders(freshBrowserToken),
  });
  assert.equal(authorizedVideo.response.ok, true);
  assert.ok(authorizedVideo.data.url.includes('/api/uploads/video/'));

  const videoFetch = await fetch(`${baseUrl}${authorizedVideo.data.url}`);
  assert.equal(videoFetch.ok, true);
  assert.match(videoFetch.headers.get('content-type') || '', /^video\//);
  const fetchedVideoBytes = Buffer.from(await videoFetch.arrayBuffer());
  assert.equal(fetchedVideoBytes.length, fakeMp4.length);

  const unauthorizedPdf = await fetch(`${baseUrl}/api/uploads/pdf/${encodeURIComponent(pdfUploadData.id)}/access`, {
    headers: authHeaders(secondStudentToken),
  });
  assert.equal(unauthorizedPdf.status, 403);

  const authorizedPdf = await requestJson(`${baseUrl}/api/uploads/pdf/${encodeURIComponent(pdfUploadData.id)}/access`, {
    headers: authHeaders(freshBrowserToken),
  });
  assert.equal(authorizedPdf.response.ok, true);
  assert.ok(authorizedPdf.data.url.includes('/api/uploads/pdf/'));

  const pdfFetch = await fetch(`${baseUrl}${authorizedPdf.data.url}`);
  assert.equal(pdfFetch.ok, true);
  assert.equal(pdfFetch.headers.get('content-type'), 'application/pdf');
  const fetchedPdfBytes = Buffer.from(await pdfFetch.arrayBuffer());
  assert.equal(fetchedPdfBytes.length, fakePdf.length);

  console.log('smoke ok');
} finally {
  if (server) server.kill('SIGTERM');
}
