import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const storePath = path.join(rootDir, 'server', 'data', 'store.json');
const appPath = path.join(rootDir, 'src', 'App.jsx');
const dataPath = path.join(rootDir, 'src', 'data.js');
const port = 4181;
const baseUrl = `http://127.0.0.1:${port}`;

const originalStore = await readFile(storePath, 'utf8');

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
    proc.off('error', onError);
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

let server;
try {
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: String(port),
      ADMIN_ACCESS_CODE: 'admin',
      AUTH_SECRET: 'smoke-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await waitForServer(server);

  for (let i = 0; i < 5; i += 1) {
    const failedLogin = await requestJson(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'definitely-wrong' }),
    });
    assert.equal(failedLogin.response.status, 401);
  }
  const limitedLogin = await requestJson(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'definitely-wrong' }),
  });
  assert.equal(limitedLogin.response.status, 429);

  const loginAdmin = await requestJson(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'admin' }),
  });
  assert.equal(loginAdmin.response.ok, true);
  const adminToken = loginAdmin.data.token;

  const storeResp = await requestJson(`${baseUrl}/api/store`, {
    headers: authHeaders(adminToken),
  });
  assert.equal(storeResp.response.ok, true);
  const store = storeResp.data;
  const lessonRef = findFirstLesson(store['thanwya.library']);
  assert.ok(lessonRef, 'expected at least one lesson in the store');

  const createCode = await requestJson(`${baseUrl}/api/lesson-codes`, {
    method: 'POST',
    headers: authHeaders(adminToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ lessonId: lessonRef.lesson.id }),
  });
  assert.equal(createCode.response.ok, true);
  assert.equal(createCode.data.code.lessonId, lessonRef.lesson.id);
  assert.ok(createCode.data.code.value);

  const loginStudent = await requestJson(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'test' }),
  });
  assert.equal(loginStudent.response.ok, true);
  const studentToken = loginStudent.data.token;

  for (let i = 0; i < 5; i += 1) {
    const failedClaim = await requestJson(`${baseUrl}/api/student/lesson-access/claim`, {
      method: 'POST',
      headers: authHeaders(studentToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ code: 'bad-lesson-code' }),
    });
    assert.equal(failedClaim.response.status, 400);
  }
  const limitedClaim = await requestJson(`${baseUrl}/api/student/lesson-access/claim`, {
    method: 'POST',
    headers: authHeaders(studentToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ code: 'bad-lesson-code' }),
  });
  assert.equal(limitedClaim.response.status, 429);

  const claim = await requestJson(`${baseUrl}/api/student/lesson-access/claim`, {
    method: 'POST',
    headers: authHeaders(studentToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ code: createCode.data.code.value }),
  });
  assert.equal(claim.response.ok, true);
  assert.equal(claim.data.unlocked, true);

  const access = await requestJson(`${baseUrl}/api/student/access`, {
    headers: authHeaders(studentToken),
  });
  assert.ok(access.data.access.some((item) => item.lessonId === lessonRef.lesson.id));

  const storeWithSecondStudent = await requestJson(`${baseUrl}/api/store`, {
    headers: authHeaders(adminToken),
  });
  const secondStudentCode = {
    id: 'smoke-student-2',
    value: 'test2',
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
  storeWithSecondStudent.data['thanwya.codes'] = [secondStudentCode, ...storeWithSecondStudent.data['thanwya.codes']];
  const updateStore = await requestJson(`${baseUrl}/api/store`, {
    method: 'PUT',
    headers: authHeaders(adminToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(storeWithSecondStudent.data),
  });
  assert.equal(updateStore.response.ok, true);

  const loginStudent2 = await requestJson(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'test2' }),
  });
  assert.equal(loginStudent2.response.ok, true);
  const student2Token = loginStudent2.data.token;

  const secondClaim = await fetch(`${baseUrl}/api/student/lesson-access/claim`, {
    method: 'POST',
    headers: authHeaders(student2Token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ code: createCode.data.code.value }),
  });
  assert.equal(secondClaim.status, 409);

  const uploadForm = new FormData();
  uploadForm.append('file', new Blob([Buffer.from('fake video')], { type: 'video/mp4' }), 'smoke.mp4');
  const upload = await fetch(`${baseUrl}/api/uploads/video`, {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: uploadForm,
  });
  assert.equal(upload.ok, true);
  const uploadData = await upload.json();

  const storeForVideo = await requestJson(`${baseUrl}/api/store`, {
    headers: authHeaders(adminToken),
  });
  storeForVideo.data['thanwya.library'][0].teachers[0].lessons[0].videos = [
    ...(storeForVideo.data['thanwya.library'][0].teachers[0].lessons[0].videos ?? []),
    {
      id: 'smoke-video',
      title: 'Smoke Video',
      duration: '1 minute',
      sourceType: 'file',
      source: '',
      assetId: uploadData.id,
      fileName: 'smoke.mp4',
      poster: storeForVideo.data['thanwya.library'][0].teachers[0].lessons[0].cover,
      summary: 'Smoke test video',
    },
  ];
  await requestJson(`${baseUrl}/api/store`, {
    method: 'PUT',
    headers: authHeaders(adminToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(storeForVideo.data),
  });

  const unauthorizedVideo = await fetch(`${baseUrl}/api/uploads/video/${encodeURIComponent(uploadData.id)}/access`, {
    headers: authHeaders(student2Token),
  });
  assert.equal(unauthorizedVideo.status, 403);

  const authorizedVideo = await requestJson(`${baseUrl}/api/uploads/video/${encodeURIComponent(uploadData.id)}/access`, {
    headers: authHeaders(studentToken),
  });
  assert.equal(authorizedVideo.response.ok, true);
  assert.ok(authorizedVideo.data.url.includes('/api/uploads/video/'));

  const videoFetch = await fetch(`${baseUrl}${authorizedVideo.data.url}`);
  assert.equal(videoFetch.ok, true);

  const appSource = await readFile(appPath, 'utf8');
  const dataSource = await readFile(dataPath, 'utf8');
  assert.equal(appSource.includes('???'), false);
  assert.equal(dataSource.includes('???'), false);

  console.log('smoke ok');
} finally {
  if (server) server.kill('SIGTERM');
  await writeFile(storePath, originalStore, 'utf8');
}
