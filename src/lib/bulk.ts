import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons } from "@/db/schema";
import type { EpisodeSource } from "@/db/schema";
import { enqueueEpisode } from "@/lib/downloader";
import { resolveEpisode } from "@/lib/importer";
import { logEvent } from "@/lib/settings";

/**
 * Chained bulk runner: resolve → queue, per episode.
 *
 * Resolving a whole season up-front and downloading afterwards does not work
 * here: the signed HLS URLs expire (~4h) and a 40-episode season takes longer
 * than that to pull. So each episode is resolved immediately before it enters
 * the download queue, and the worker's own retry re-resolves anything that
 * still expires while waiting.
 */

export interface BulkRun {
  key: string;
  label: string;
  total: number;
  processed: number;
  queued: number;
  resolved: number;
  skipped: number;
  failed: number;
  startedAt: number;
  running: boolean;
  finishedAt: number | null;
  lastMessage: string;
}

const globalForBulk = globalThis as typeof globalThis & {
  __mirfaBulkRuns?: Map<string, BulkRun>;
};
const runs: Map<string, BulkRun> = (globalForBulk.__mirfaBulkRuns ??= new Map());

export function bulkStatus(): BulkRun[] {
  return [...runs.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 10);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasDirect(sources: EpisodeSource[] | null): boolean {
  if (!Array.isArray(sources)) return false;
  return sources.some(
    (s) => s.kind === "direct" || (!s.kind && /^(mp4|hls|webm)$/.test(s.type)),
  );
}

async function runBulk(key: string, label: string, episodeIds: number[]) {
  const run = runs.get(key);
  if (!run) return;

  for (const id of episodeIds) {
    if (!run.running) break;
    try {
      const [ep] = await db
        .select({
          title: episodes.title,
          resolveStatus: episodes.resolveStatus,
          downloadStatus: episodes.downloadStatus,
          sources: episodes.sources,
        })
        .from(episodes)
        .where(eq(episodes.id, id))
        .limit(1);
      if (!ep) {
        run.skipped += 1;
        continue;
      }

      if (ep.downloadStatus === "done") {
        run.skipped += 1;
        run.lastMessage = `${ep.title}: منزّلة مسبقًا`;
        continue;
      }
      if (ep.downloadStatus === "downloading" || ep.downloadStatus === "queued") {
        run.skipped += 1;
        run.lastMessage = `${ep.title}: في الطابور بالفعل`;
        continue;
      }

      // Resolve only when we don't already hold a usable direct link.
      if (!hasDirect(ep.sources as EpisodeSource[] | null)) {
        const res = await resolveEpisode(id);
        if (res.ok) run.resolved += 1;
        else {
          run.failed += 1;
          run.lastMessage = `${ep.title}: ${res.message}`;
          // Back off a little when the host is throttling us.
          if (res.rateLimited) await sleep(4000);
          else await sleep(600);
          continue;
        }
      }

      const [fresh] = await db
        .select({ sources: episodes.sources })
        .from(episodes)
        .where(eq(episodes.id, id))
        .limit(1);
      if (!hasDirect(fresh?.sources as EpisodeSource[] | null)) {
        run.failed += 1;
        run.lastMessage = `${ep.title}: فُكّت الحماية لكن لا رابط مباشر صالح`;
        await sleep(600);
        continue;
      }

      await enqueueEpisode(id);
      run.queued += 1;
      run.lastMessage = `${ep.title}: أُضيفت إلى الطابور`;
    } catch (err) {
      run.failed += 1;
      run.lastMessage = err instanceof Error ? err.message : "خطأ غير معروف";
    } finally {
      run.processed += 1;
    }
    await sleep(400);
  }

  run.running = false;
  run.finishedAt = Date.now();
  await logEvent(
    run.failed > run.queued ? "warn" : "success",
    "bulk",
    `${label}: أُضيفت ${run.queued} حلقة للتنزيل، فشل ${run.failed}، تخطّي ${run.skipped}`,
    { meta: { key } },
  );
}

async function episodeIdsForSeason(seasonId: number) {
  const rows = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(eq(episodes.seasonId, seasonId))
    .orderBy(asc(episodes.number));
  return rows.map((r) => r.id);
}

/** Start (or restart) a chained resolve+download run for one season. */
export async function startBulkSeason(seasonId: number) {
  const [season] = await db
    .select({ number: seasons.number, title: seasons.title })
    .from(seasons)
    .where(eq(seasons.id, seasonId))
    .limit(1);
  if (!season) throw new Error("الموسم غير موجود");

  const ids = await episodeIdsForSeason(seasonId);
  if (ids.length === 0) throw new Error("لا حلقات في هذا الموسم");

  const key = `season:${seasonId}`;
  const existing = runs.get(key);
  if (existing?.running) return existing;

  const label = `الموسم ${season.number}`;
  const run: BulkRun = {
    key,
    label,
    total: ids.length,
    processed: 0,
    queued: 0,
    resolved: 0,
    skipped: 0,
    failed: 0,
    startedAt: Date.now(),
    running: true,
    finishedAt: null,
    lastMessage: "جارٍ البدء…",
  };
  runs.set(key, run);
  await logEvent("info", "bulk", `بدأت معالجة ${label} (${ids.length} حلقة)`);
  void runBulk(key, label, ids);
  return run;
}

/** Start a chained resolve+download run across every season of a series. */
export async function startBulkSeries(seriesId: number) {
  const seasonRows = await db
    .select({ id: seasons.id, number: seasons.number })
    .from(seasons)
    .where(eq(seasons.seriesId, seriesId))
    .orderBy(asc(seasons.number));
  if (seasonRows.length === 0) throw new Error("لا مواسم في هذه السلسلة");

  const ids = seasonRows.length
    ? await db
        .select({ id: episodes.id, seasonId: episodes.seasonId })
        .from(episodes)
        .where(
          inArray(
            episodes.seasonId,
            seasonRows.map((s) => s.id),
          ),
        )
        .orderBy(asc(episodes.seasonId), asc(episodes.number))
    : [];
  if (ids.length === 0) throw new Error("لا حلقات مستوردة في هذه السلسلة");

  const key = `series:${seriesId}`;
  const existing = runs.get(key);
  if (existing?.running) return existing;

  const label = `السلسلة كاملة (${seasonRows.length} موسم)`;
  const run: BulkRun = {
    key,
    label,
    total: ids.length,
    processed: 0,
    queued: 0,
    resolved: 0,
    skipped: 0,
    failed: 0,
    startedAt: Date.now(),
    running: true,
    finishedAt: null,
    lastMessage: "جارٍ البدء…",
  };
  runs.set(key, run);
  await logEvent("info", "bulk", `بدأت معالجة ${label} — ${ids.length} حلقة`);
  void runBulk(key, label, ids.map((r) => r.id));
  return run;
}

/** Cooperatively stop a running bulk job (queued downloads keep going). */
export function stopBulk(key: string) {
  const run = runs.get(key);
  if (!run) return false;
  run.running = false;
  run.lastMessage = "أُوقفت بطلب المستخدم";
  return true;
}
