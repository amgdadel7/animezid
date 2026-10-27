import path from "node:path";
import { db } from "@/db";
import { activityLog, settings } from "@/db/schema";
import { eq } from "drizzle-orm";

export interface AppSettings {
  siteUsername: string;
  sitePassword: string;
  siteCookie: string;
  concurrency: number;
  downloadDir: string;
  autoResolveOnImport: boolean;
  autoDownloadOnResolve: boolean;
  preferredQuality: string;
}

const DEFAULTS: AppSettings = {
  siteUsername: "",
  sitePassword: "",
  siteCookie: "",
  concurrency: 2,
  downloadDir: path.join(process.cwd(), "downloads"),
  autoResolveOnImport: true,
  autoDownloadOnResolve: false,
  preferredQuality: "highest",
};

const BOOLEAN_KEYS = new Set(["autoResolveOnImport", "autoDownloadOnResolve"]);

export async function getSettings(): Promise<AppSettings> {
  const rows = await db.select().from(settings);
  const out = { ...DEFAULTS } as unknown as Record<string, unknown>;
  for (const row of rows) {
    const raw = row.value ?? "";
    if (row.key === "concurrency") {
      const n = Number.parseInt(raw, 10);
      out[row.key] = Number.isFinite(n) && n > 0 ? Math.min(n, 6) : DEFAULTS.concurrency;
    } else if (BOOLEAN_KEYS.has(row.key)) {
      out[row.key] = raw === "1" || raw === "true";
    } else if (row.key in DEFAULTS) {
      out[row.key] = raw;
    }
  }
  return out as unknown as AppSettings;
}

export async function setSetting(key: string, value: string) {
  await db
    .insert(settings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: new Date() },
    });
}

export async function getSetting(key: string): Promise<string> {
  const row = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return row[0]?.value ?? "";
}

/* ------------------------------------------------------------------ *
 * Provider learning
 *
 * Hosts differ in both reliability and throughput (measured: ~2.9 MB/s from a
 * player's HLS stream vs ~0.29 MB/s from a file host's free tier — a 10x gap).
 * Across a 600-episode library that is the difference between ~11 hours and
 * ~113 hours, so both signals feed the resolve order.
 * ------------------------------------------------------------------ */

export interface ProviderStat {
  ok: number;
  fail: number;
  lastOkAt?: string;
  /** Exponential moving average of observed download throughput, bytes/sec. */
  avgBps?: number;
  samples?: number;
}

const PROVIDER_STATS_KEY = "providerStats";

export async function getProviderStats(): Promise<Record<string, ProviderStat>> {
  try {
    const raw = await getSetting(PROVIDER_STATS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ProviderStat>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function saveProviderStats(stats: Record<string, ProviderStat>) {
  await setSetting(PROVIDER_STATS_KEY, JSON.stringify(stats));
}

export async function recordProviderOutcome(provider: string, ok: boolean) {
  if (!provider) return;
  try {
    const stats = await getProviderStats();
    const cur = stats[provider] ?? { ok: 0, fail: 0 };
    if (ok) {
      cur.ok += 1;
      cur.lastOkAt = new Date().toISOString();
    } else {
      cur.fail += 1;
    }
    stats[provider] = cur;
    await saveProviderStats(stats);
  } catch {
    /* learning is best-effort */
  }
}

/** Fold a measured throughput sample into the provider's moving average. */
export async function recordProviderSpeed(provider: string, bps: number) {
  if (!provider || !Number.isFinite(bps) || bps <= 0) return;
  try {
    const stats = await getProviderStats();
    const cur = stats[provider] ?? { ok: 0, fail: 0 };
    const samples = (cur.samples ?? 0) + 1;
    const prev = cur.avgBps ?? bps;
    // EMA with a cap on how much a single run can swing the estimate.
    cur.avgBps = Math.round(prev * 0.7 + bps * 0.3);
    cur.samples = samples;
    stats[provider] = cur;
    await saveProviderStats(stats);
  } catch {
    /* learning is best-effort */
  }
}

/** Cookie used for authenticated requests, preferring an explicit override. */
export async function resolveSiteCookie(): Promise<string> {
  const s = await getSettings();
  return (s.siteCookie || "").trim();
}

export type LogLevel = "info" | "success" | "warn" | "error";

export async function logEvent(
  level: LogLevel,
  scope: string,
  message: string,
  opts: { episodeId?: number | null; meta?: Record<string, unknown> } = {},
) {
  try {
    await db.insert(activityLog).values({
      level,
      scope,
      message,
      episodeId: opts.episodeId ?? null,
      meta: opts.meta ?? null,
    });
  } catch {
    // Logging must never break a request path.
  }
}
