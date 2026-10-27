import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { activityLog, episodes, seasons, series } from "@/db/schema";
import { describeError, fail, ok } from "@/lib/api";
import { bulkStatus } from "@/lib/bulk";
import { healStuckJobs, queueSnapshot } from "@/lib/downloader";
import { libraryStats } from "@/lib/importer";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await healStuckJobs();
    const url = new URL(req.url);
    const sinceId = Number.parseInt(url.searchParams.get("since") ?? "0", 10) || 0;
    const seasonParam = url.searchParams.get("season");
    const seasonId = seasonParam ? Number.parseInt(seasonParam, 10) : null;

    const stats = await libraryStats();
    const settings = await getSettings();

    // Live progress for anything that is moving.
    const moving = await db
      .select({
        id: episodes.id,
        progress: episodes.progress,
        downloadStatus: episodes.downloadStatus,
        resolveStatus: episodes.resolveStatus,
        bytesDone: episodes.bytesDone,
        bytesTotal: episodes.bytesTotal,
        speedBps: episodes.speedBps,
        segmentsDone: episodes.segmentsDone,
        segmentsTotal: episodes.segmentsTotal,
        error: episodes.error,
      })
      .from(episodes)
      .where(
        or(
          inArray(episodes.downloadStatus, ["queued", "downloading"]),
          eq(episodes.resolveStatus, "resolving"),
        ),
      )
      .limit(400);

    const recentLog = await db
      .select()
      .from(activityLog)
      .where(sql`${activityLog.id} > ${sinceId}`)
      .orderBy(desc(activityLog.id))
      .limit(60);

    const needsAttention = await db
      .select({
        id: episodes.id,
        title: episodes.title,
        resolveStatus: episodes.resolveStatus,
        resolveError: episodes.resolveError,
        downloadStatus: episodes.downloadStatus,
        error: episodes.error,
        seasonId: episodes.seasonId,
      })
      .from(episodes)
      .where(
        or(
          eq(episodes.resolveStatus, "needs_auth"),
          eq(episodes.resolveStatus, "failed"),
          eq(episodes.downloadStatus, "failed"),
        ),
      )
      .orderBy(desc(episodes.updatedAt))
      .limit(25);

    const ready = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(episodes)
      .where(
        and(
          eq(episodes.resolveStatus, "ready"),
          eq(episodes.downloadStatus, "idle"),
          seasonId ? eq(episodes.seasonId, seasonId) : isNotNull(episodes.seasonId),
        ),
      );

    const seasonTitles = await db
      .select({ id: seasons.id, title: seasons.title, number: seasons.number, seriesTitle: series.title })
      .from(seasons)
      .innerJoin(series, eq(seasons.seriesId, series.id));
    const titleMap = new Map(seasonTitles.map((s) => [s.id, s]));

    return ok({
      stats,
      queue: queueSnapshot(),
      bulk: bulkStatus(),
      moving,
      readyToDownload: Number(ready[0]?.count ?? 0),
      needsAttention: needsAttention.map((n) => ({
        ...n,
        seasonTitle: titleMap.get(n.seasonId)?.title ?? null,
        seriesTitle: titleMap.get(n.seasonId)?.seriesTitle ?? null,
      })),
      log: recentLog.reverse(),
      settings: {
        concurrency: settings.concurrency,
        downloadDir: settings.downloadDir,
        autoResolveOnImport: settings.autoResolveOnImport,
        autoDownloadOnResolve: settings.autoDownloadOnResolve,
        preferredQuality: settings.preferredQuality,
        hasCookie: Boolean(settings.siteCookie.trim()),
        hasCredentials: Boolean(settings.siteUsername.trim()),
      },
    });
  } catch (err) {
    return fail(describeError(err), 500);
  }
}
