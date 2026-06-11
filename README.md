# THANWYA

React + Vite frontend for the student/admin UI, with an Express API for authentication, lesson access, media uploads, and JSON-backed persistence.

## Scripts

```bash
npm install
npm run dev        # frontend only
npm run api        # backend only
npm run dev:full   # frontend + backend
npm run build      # production frontend build
npm test           # smoke test
npm start          # production backend start
```

## Local Setup

1. Create a local env file from `.env.example`.
2. Set at least `AUTH_SECRET` and `ADMIN_BOOTSTRAP_TOKEN`.
3. Start the API with `npm run api` or both apps with `npm run dev:full`.
4. Open the Vite URL, then bootstrap the admin account from the admin screen.
5. After bootstrap, sign in with the admin code you created.

## Authentication

- There are no seeded admin or demo student credentials anymore.
- Admin setup is a one-time bootstrap flow backed by `ADMIN_BOOTSTRAP_TOKEN`.
- Student and admin sessions are refreshed through `/api/auth/me`.
- The frontend keeps auth state in browser session storage so refresh works without leaving long-lived tokens in local storage.

## Required Environment Variables

- `AUTH_SECRET`: HMAC signing secret for session and video tokens.
- `ADMIN_BOOTSTRAP_TOKEN`: one-time bootstrap secret used to create the first admin code.

## Optional Environment Variables

- `PORT`: backend port, default `3001`.
- `NODE_ENV`: set to `production` in deployed environments.
- `ADMIN_TOKEN_TTL`: admin session TTL in milliseconds.
- `STUDENT_TOKEN_TTL`: student session TTL in milliseconds.
- `RATE_LIMIT_WINDOW_MS`: auth/claim rate-limit window.
- `RATE_LIMIT_MAX_FAILS`: max failed attempts within the window.
- `JSON_BODY_LIMIT`: max JSON payload size for API requests.
- `UPLOAD_MAX_BYTES`: max uploaded video size in bytes.
- `UPLOAD_ALLOWED_EXTENSIONS`: comma-separated upload extensions.
- `UPLOAD_ALLOWED_MIME_TYPES`: comma-separated upload MIME types.
- `CORS_ORIGINS`: comma-separated allowed frontend origins.
- `DATA_DIR`: directory used for JSON persistence when `STORE_FILE_PATH` is not set.
- `STORE_FILE_PATH`: explicit path to the JSON store file.
- `UPLOADS_DIR`: directory used for uploaded video files.
- `SERVE_STATIC`: set to `true` only if the backend should also serve `dist`.
- `APP_BASE_PATH`: base path used when `SERVE_STATIC=true`.
- `VITE_API_BASE_URL`: public frontend API base URL, used in production builds.
- `VITE_BASE_PATH`: frontend build base path, default `/`.

## Deployment

### Backend on Railway

1. Deploy the repository or backend service with start command `npm start`.
2. Set `NODE_ENV=production`.
3. Set `AUTH_SECRET`, `ADMIN_BOOTSTRAP_TOKEN`, and `CORS_ORIGINS`.
4. Mount a persistent Railway volume and point:
   - `STORE_FILE_PATH` to a file on that volume.
   - `UPLOADS_DIR` to a directory on that volume.
5. Keep `SERVE_STATIC=false` when the frontend is hosted on Vercel.

### Frontend on Vercel

1. Set build command to `npm run build`.
2. Set output directory to `dist`.
3. Set `VITE_API_BASE_URL` to the Railway backend URL.
4. Leave `VITE_BASE_PATH=/` unless you intentionally deploy under a subpath.

## Security Notes

- Uploads are restricted by extension, MIME type, size, and signature checks.
- CORS is origin-restricted in production through `CORS_ORIGINS`.
- Admin data updates are validated and merged by section; there is no raw full-store overwrite endpoint anymore.
- Video URLs are short-lived signed playback tickets, not permanent public links.

## Testing

`npm test` covers:

- admin bootstrap
- admin login
- student login
- auth refresh for page reload
- lesson access claiming
- signed video access
- secured upload flow
