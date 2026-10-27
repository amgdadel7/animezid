import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import * as schema from "@/db/schema";
import { ensureSchema } from "@/db/bootstrap";

export type Db = NodePgDatabase<typeof schema>;

export interface DbTarget {
  /** Where the connection points, for diagnostics (never includes the password). */
  label: string;
  host: string;
  port: number;
  database: string;
  user: string;
  ssl: boolean;
  origin: "DATABASE_URL" | "SUPABASE_ENV" | "PG_ENV" | "default-local";
}

function mask(connectionString: string) {
  return connectionString.replace(/:\/\/([^:@/]+):([^@]+)@/, "://$1:****@");
}

function parseTarget(connectionString: string, origin: DbTarget["origin"]): DbTarget {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return {
      label: mask(connectionString),
      host: "?",
      port: 5432,
      database: "?",
      user: "?",
      ssl: false,
      origin,
    };
  }
  const sslParam =
    url.searchParams.get("sslmode") ?? url.searchParams.get("ssl") ?? "";
  const host = url.hostname;
  const isRemote = !["localhost", "127.0.0.1", "::1", ""].includes(host);
  return {
    label: mask(connectionString),
    host: host || "localhost",
    port: url.port ? Number.parseInt(url.port, 10) : 5432,
    database: url.pathname.replace(/^\//, "") || "postgres",
    user: decodeURIComponent(url.username || "postgres"),
    ssl: isRemote || /^(require|verify-full|verify-ca|prefer)$/.test(sslParam),
    origin,
  };
}

/** Compose a connection string from discrete host/port/user/password parts. */
function composeUrl(parts: {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}) {
  const enc = (v: string) => encodeURIComponent(v);
  return `postgresql://${enc(parts.user)}:${enc(parts.password)}@${parts.host}:${parts.port}/${enc(parts.database)}?sslmode=require`;
}

function env(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return "";
}

/**
 * Resolve the connection target.
 *
 * Priority:
 *   1. DATABASE_URL (what the platform provisions)
 *   2. Supabase vars — SUPABASE_DB_* / PG* with a password present
 *   3. local Postgres fallback
 *
 * A Supabase project is only used when its password is available: the
 * `SUPABASE_SECRET_KEY` (`sb_secret_…`) is an API key and is NOT a Postgres
 * password, so it is never used for the database connection.
 */
export function resolveConnectionString(): {
  connectionString: string;
  target: DbTarget;
  reason?: string;
} {
  const explicit = env("DATABASE_URL", "POSTGRES_URL", "PG_URL");
  if (explicit) {
    const target = parseTarget(explicit, "DATABASE_URL");
    return { connectionString: explicit, target };
  }

  const sbHost = env("SUPABASE_DB_HOST", "SUPABASE_DB_URL_HOST", "PGHOST");
  const sbUser = env("SUPABASE_DB_USER", "SUPABASE_DB_USERNAME", "PGUSER");
  const sbPassword = env(
    "SUPABASE_DB_PASSWORD",
    "SUPABASE_DB_PASS",
    "POSTGRES_PASSWORD",
    "PGPASSWORD",
  );
  const sbDatabase = env("SUPABASE_DB_NAME", "SUPABASE_DB_DATABASE", "PGDATABASE") || "postgres";
  const sbPort = Number.parseInt(env("SUPABASE_DB_PORT", "PGPORT") || "6543", 10);

  if (sbHost && sbUser) {
    if (!sbPassword) {
      return {
        connectionString: "",
        target: {
          label: `${sbUser}@${sbHost}:${sbPort || 6543}/${sbDatabase}`,
          host: sbHost,
          port: sbPort || 6543,
          database: sbDatabase,
          user: sbUser,
          ssl: true,
          origin: "SUPABASE_ENV",
        },
        reason:
          "وجدت إعدادات Supabase لكن كلمة مرور قاعدة البيانات ناقصة (SUPABASE_DB_PASSWORD). مفتاح sb_secret_ هو مفتاح API وليس كلمة مرور Postgres.",
      };
    }
    const connectionString = composeUrl({
      host: sbHost,
      port: sbPort || 6543,
      user: sbUser,
      password: sbPassword,
      database: sbDatabase,
    });
    return {
      connectionString,
      target: parseTarget(connectionString, "SUPABASE_ENV"),
    };
  }

  const fallback = "postgresql://postgres:postgres@127.0.0.1:5432/app_db";
  return { connectionString: fallback, target: parseTarget(fallback, "default-local") };
}

const globalForDb = globalThis as typeof globalThis & {
  __mirfaPool?: Pool;
  __mirfaDb?: Db;
  __mirfaTarget?: DbTarget;
  __mirfaConfiguredFor?: string;
};

function buildPool(connectionString: string, target: DbTarget) {
  const config: PoolConfig = {
    connectionString,
    max: target.ssl ? 4 : 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 12_000,
    allowExitOnIdle: false,
  };
  if (target.ssl) {
    // Supabase/Supavisor present a valid cert, but self-signed proxies are common.
    config.ssl = { rejectUnauthorized: false };
  }
  const pool = new Pool(config);
  pool.on("error", (err) => {
    console.error("[mirfa] idle client error:", err.message);
  });
  return pool;
}

function getClient(): { pool: Pool; db: Db; target: DbTarget } {
  const { connectionString, target, reason } = resolveConnectionString();

  if (!connectionString) {
    throw new Error(reason ?? "DATABASE_URL غير مضبوط");
  }

  // Rebuild the pool if the target changed (e.g. env edited at runtime).
  if (globalForDb.__mirfaPool && globalForDb.__mirfaConfiguredFor === connectionString) {
    return {
      pool: globalForDb.__mirfaPool,
      db: globalForDb.__mirfaDb as Db,
      target: globalForDb.__mirfaTarget as DbTarget,
    };
  }

  if (globalForDb.__mirfaPool && globalForDb.__mirfaConfiguredFor !== connectionString) {
    void globalForDb.__mirfaPool.end().catch(() => undefined);
    globalForDb.__mirfaPool = undefined;
    globalForDb.__mirfaDb = undefined;
  }

  const pool = buildPool(connectionString, target);
  const db = drizzle(pool, { schema }) as Db;
  globalForDb.__mirfaPool = pool;
  globalForDb.__mirfaDb = db;
  globalForDb.__mirfaTarget = target;
  globalForDb.__mirfaConfiguredFor = connectionString;
  return { pool, db, target };
}

/** Drizzle client — created lazily so a bad URL never crashes module import. */
export const db = new Proxy({} as Db, {
  get(_t, prop) {
    const { db: real } = getClient();
    const value = (real as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? value.bind(real) : value;
  },
});

/** Raw pool for diagnostics. */
export function getPool(): Pool {
  return getClient().pool;
}

export function getDbTarget(): DbTarget {
  return getClient().target;
}

export interface PingResult {
  ok: boolean;
  target: DbTarget;
  message: string;
  attempts: number;
  durationMs: number;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Verify connectivity (with a short retry so a database that is still booting
 * does not produce a false "offline" screen) and make sure the schema exists.
 */
export async function pingDatabase(
  { retries = 2, ensure = true }: { retries?: number; ensure?: boolean } = {},
): Promise<PingResult> {
  const started = Date.now();
  let lastError = "";
  let target: DbTarget;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const client = getClient();
      target = client.target;
      await client.pool.query("select 1");
      if (ensure) await ensureSchema(client.db);
      return {
        ok: true,
        target,
        message: "الاتصال بقاعدة البيانات سليم",
        attempts: attempt + 1,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < retries) await sleep(450 * (attempt + 1));
    }
  }

  // Re-resolve for the error report even when pool construction itself failed.
  try {
    target = getClient().target;
  } catch {
    const { target: resolved } = (() => {
      try {
        return { target: resolveConnectionString().target };
      } catch {
        return {
          target: {
            label: "غير معروف",
            host: "?",
            port: 0,
            database: "?",
            user: "?",
            ssl: false,
            origin: "default-local" as const,
          },
        };
      }
    })();
    target = resolved;
  }

  return {
    ok: false,
    target,
    message: humanizeDbError(lastError),
    attempts: retries + 1,
    durationMs: Date.now() - started,
  };
}

/** Turn raw pg errors into something the operator can act on. */
export function humanizeDbError(message: string): string {
  if (!message) return "خطأ غير معروف";
  if (/DATABASE_URL غير مضبوط|ناقص/.test(message)) return message;
  if (/password authentication failed/i.test(message))
    return `فشلت المصادقة: كلمة مرور قاعدة البيانات غير صحيحة. ${message}`;
  if (/getaddrinfo|ENOTFOUND/i.test(message))
    return `تعذّر حل اسم المضيف (DNS). تحقّق من HOST في DATABASE_URL. ${message}`;
  if (/ECONNREFUSED/i.test(message))
    return `رُفض الاتصال: لا توجد قاعدة بيانات تستمع على هذا المنفذ. ${message}`;
  if (/timeout|ETIMEDOUT/i.test(message))
    return `انتهت مهلة الاتصال — قد تكون الشبكة أو المنفذ (6543 مقابل 5432) محجوبًا. ${message}`;
  if (/ssl/i.test(message))
    return `مشكلة في TLS/SSL: أضف ?sslmode=require لاتصالات Supabase. ${message}`;
  if (/does not exist/i.test(message))
    return `كائن غير موجود في قاعدة البيانات: ${message}`;
  if (/too many clients|remaining connection slots/i.test(message))
    return `استُنفدت منافذ الاتصال المتاحة — قلّل عدد الاتصالات المتزامنة. ${message}`;
  return message;
}
