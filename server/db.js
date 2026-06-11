import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required');
}

const pool = new Pool({
  connectionString,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : undefined,
});

let initPromise = null;

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS thanwya_state (
      id text PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS thanwya_assets (
      id text PRIMARY KEY,
      asset_kind text NOT NULL DEFAULT 'video',
      file_name text NOT NULL,
      display_name text NOT NULL DEFAULT '',
      mime_type text NOT NULL,
      size_bytes integer NOT NULL,
      sha256 text NOT NULL,
      visibility text NOT NULL DEFAULT 'private',
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      data bytea NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`ALTER TABLE thanwya_assets ADD COLUMN IF NOT EXISTS asset_kind text NOT NULL DEFAULT 'video';`);
  await pool.query(`ALTER TABLE thanwya_assets ADD COLUMN IF NOT EXISTS display_name text NOT NULL DEFAULT '';`);
  await pool.query(`ALTER TABLE thanwya_assets ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';`);
  await pool.query(`ALTER TABLE thanwya_assets ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;`);
}

export async function initDb() {
  if (!initPromise) {
    initPromise = ensureSchema();
  }
  return initPromise;
}

export async function readState() {
  await initDb();
  const result = await pool.query('SELECT data FROM thanwya_state WHERE id = $1', ['singleton']);
  return result.rows[0]?.data ?? null;
}

export async function writeState(data) {
  await initDb();
  await pool.query(
    `
      INSERT INTO thanwya_state (id, data, updated_at)
      VALUES ($1, $2::jsonb, now())
      ON CONFLICT (id)
      DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
    `,
    ['singleton', JSON.stringify(data)],
  );
}

export async function readAsset(assetId) {
  await initDb();
  const result = await pool.query(
    'SELECT id, asset_kind, file_name, display_name, mime_type, size_bytes, sha256, visibility, metadata, data FROM thanwya_assets WHERE id = $1',
    [assetId],
  );
  return result.rows[0] ?? null;
}

export async function writeAsset(asset) {
  await initDb();
  await pool.query(
    `
      INSERT INTO thanwya_assets (id, asset_kind, file_name, display_name, mime_type, size_bytes, sha256, visibility, metadata, data)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
      ON CONFLICT (id)
      DO UPDATE SET
        asset_kind = EXCLUDED.asset_kind,
        file_name = EXCLUDED.file_name,
        display_name = EXCLUDED.display_name,
        mime_type = EXCLUDED.mime_type,
        size_bytes = EXCLUDED.size_bytes,
        sha256 = EXCLUDED.sha256,
        visibility = EXCLUDED.visibility,
        metadata = EXCLUDED.metadata,
        data = EXCLUDED.data
    `,
    [
      asset.id,
      asset.assetKind || 'video',
      asset.fileName,
      asset.displayName || asset.fileName,
      asset.mimeType,
      asset.sizeBytes,
      asset.sha256,
      asset.visibility || 'private',
      JSON.stringify(asset.metadata || {}),
      asset.data,
    ],
  );
}

export async function deleteAsset(assetId) {
  await initDb();
  await pool.query('DELETE FROM thanwya_assets WHERE id = $1', [assetId]);
}

export async function listAssetIds() {
  await initDb();
  const result = await pool.query('SELECT id FROM thanwya_assets');
  return result.rows.map((row) => row.id);
}

export { pool };
