import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons, series } from "@/db/schema";
import type { SeriesRow } from "@/lib/types";

interface SeriesAgg {
  seriesId: number;
  seasonCount: number;
  episodeCount: number;
  doneCount: number;
  activeCount: number;
  totalBytes: string;
}

/** One grouped pass — avoids correlated subqueries and ambiguous column refs. */
async function aggregateBySeries(): Promise<Map<number, SeriesAgg>> {
  const rows = await db
    .select({
      seriesId: series.id,
      seasonCount: sql<number>`count(distinct ${seasons.id})::int`,
      episodeCount: sql<number>`count(${episodes.id})::int`,
      doneCount: sql<number>`count(${episodes.id}) filter (where ${episodes.downloadStatus} = 'done')::int`,
      activeCount: sql<number>`count(${episodes.id}) filter (where ${episodes.downloadStatus} in ('queued','downloading'))::int`,
      totalBytes: sql<string>`coalesce(sum(cast(${episodes.fileSize} as bigint)) filter (where ${episodes.downloadStatus} = 'done'), 0)::text`,
    })
    .from(series)
    .leftJoin(seasons, eq(seasons.seriesId, series.id))
    .leftJoin(episodes, eq(episodes.seasonId, seasons.id))
    .groupBy(series.id);

  return new Map(
    rows.map((r) => [
      r.seriesId,
      {
        seriesId: r.seriesId,
        seasonCount: Number(r.seasonCount ?? 0),
        episodeCount: Number(r.episodeCount ?? 0),
        doneCount: Number(r.doneCount ?? 0),
        activeCount: Number(r.activeCount ?? 0),
        totalBytes: r.totalBytes ?? "0",
      },
    ]),
  );
}

export async function listSeriesRows(): Promise<SeriesRow[]> {
  const [rows, agg] = await Promise.all([
    db.select().from(series).orderBy(desc(series.updatedAt)),
    aggregateBySeries(),
  ]);

  return rows.map((r) => {
    const a = agg.get(r.id);
    return {
      id: r.id,
      title: r.title,
      originalTitle: r.originalTitle,
      slug: r.slug,
      posterUrl: r.posterUrl,
      sourceUrl: r.sourceUrl,
      year: r.year,
      language: r.language,
      quality: r.quality,
      genres: r.genres,
      createdAt: r.createdAt.toISOString(),
      seasonCount: a?.seasonCount ?? 0,
      episodeCount: a?.episodeCount ?? 0,
      doneCount: a?.doneCount ?? 0,
      activeCount: a?.activeCount ?? 0,
      totalBytes: a?.totalBytes ?? "0",
    };
  });
}

export async function storageSummary() {
  const [[row], [seasonRow]] = await Promise.all([
    db
      .select({
        episodes: sql<number>`count(*)::int`,
        bytes: sql<string>`coalesce(sum(cast(${episodes.fileSize} as bigint)),0)::text`,
      })
      .from(episodes)
      .where(eq(episodes.downloadStatus, "done")),
    db.select({ count: sql<number>`count(*)::int` }).from(seasons),
  ]);
  return {
    episodes: Number(row?.episodes ?? 0),
    bytes: row?.bytes ?? "0",
    seasons: Number(seasonRow?.count ?? 0),
  };
}
