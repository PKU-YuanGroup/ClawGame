import type { Env } from "../types";

type KvListResult = { keys: Array<{ name: string }> };
type KvGetType = "text" | "json";

let schemaReady = false;

async function ensureDb(env: Env): Promise<D1Database> {
  if (!env.DB) {
    throw new Error("D1 binding 'DB' is required");
  }
  return env.DB;
}

async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  const db = await ensureDb(env);

  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS app_kv (k TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER)",
    )
    .run();
  await db
    .prepare("CREATE INDEX IF NOT EXISTS idx_app_kv_expires_at ON app_kv(expires_at)")
    .run();

  schemaReady = true;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export async function storeGet(env: Env, key: string): Promise<string | null>;
export async function storeGet(env: Env, key: string, type: "text"): Promise<string | null>;
export async function storeGet<T = unknown>(env: Env, key: string, type: "json"): Promise<T | null>;
export async function storeGet<T = unknown>(env: Env, key: string, type: KvGetType = "text"): Promise<T | string | null> {
  await ensureSchema(env);
  const db = await ensureDb(env);
  const row = await db
    .prepare("SELECT value, expires_at FROM app_kv WHERE k = ? LIMIT 1")
    .bind(key)
    .first<{ value: string; expires_at: number | null }>();

  if (!row) return null;
  if (row.expires_at !== null && row.expires_at <= nowSec()) {
    await storeDelete(env, key);
    return null;
  }

  if (type === "json") {
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  }
  return row.value;
}

export async function storePut(
  env: Env,
  key: string,
  value: string,
  options?: { expirationTtl?: number },
): Promise<void> {
  await ensureSchema(env);
  const db = await ensureDb(env);
  const expiresAt = options?.expirationTtl ? nowSec() + options.expirationTtl : null;
  await db
    .prepare(
      "INSERT INTO app_kv (k, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at",
    )
    .bind(key, value, expiresAt)
    .run();
}

export async function storeDelete(env: Env, key: string): Promise<void> {
  await ensureSchema(env);
  const db = await ensureDb(env);
  await db.prepare("DELETE FROM app_kv WHERE k = ?").bind(key).run();
}

export async function storeList(env: Env, opts: { prefix: string }): Promise<KvListResult> {
  await ensureSchema(env);
  const db = await ensureDb(env);
  const rows = await db
    .prepare(
      "SELECT k FROM app_kv WHERE k LIKE ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY k LIMIT 1000",
    )
    .bind(`${opts.prefix}%`, nowSec())
    .all<{ k: string }>();

  return {
    keys: (rows.results || []).map((r) => ({ name: r.k })),
  };
}
