import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons, series } from "@/db/schema";
import { describeError, fail, ok } from "@/lib/api";
import { importSeriesAllSeasons } from "@/lib/importer";
import { removeFile } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const seriesId = Number.parseInt(id, 10);
  if (!Number.isFinite(seriesId)) return fail("معرّف غير صالح");

  const [row] = await db.select().from(series).where(eq(series.id, seriesId)).limit(1);
  if (!row) return fail("السلسلة غير موجودة", 404);

  const seasonRows = await db
    .select()
    .from(seasons)
    .where(eq(seasons.seriesId, seriesId))
    .orderBy(asc(seasons.number));

  const seasonIds = seasonRows.map((s) => s.id);
  const episodeRows = seasonIds.length
    ? await db
        .select()
        .from(episodes)
        .where(inArray(episodes.seasonId, seasonIds))
        .orderBy(asc(episodes.seasonId), asc(episodes.number))
    : [];

  return ok({
    series: row,
    seasons: seasonRows.map((s) => ({
      ...s,
      episodes: episodeRows.filter((e) => e.seasonId === s.id),
    })),
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const seriesId = Number.parseInt(id, 10);
  if (!Number.isFinite(seriesId)) return fail("معرّف غير صالح");

  try {
    const rows = await db
      .select({ filePath: episodes.filePath })
      .from(episodes)
      .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
      .where(eq(seasons.seriesId, seriesId));
    for (const r of rows) {
      if (r.filePath) await removeFile(r.filePath);
    }
    await db.delete(series).where(eq(series.id, seriesId));
    return ok({ deleted: seriesId });
  } catch (err) {
    return fail(describeError(err), 500);
  }
}

export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const seriesId = Number.parseInt(id, 10);
  if (!Number.isFinite(seriesId)) return fail("معرّف غير صالح");
  try {
    const results = await importSeriesAllSeasons(seriesId);
    return ok({ results });
  } catch (err) {
    return fail(describeError(err), 502);
  }
}
