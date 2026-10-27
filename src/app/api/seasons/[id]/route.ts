import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { episodes } from "@/db/schema";
import { describeError, fail, ok, readJson, bool } from "@/lib/api";
import { enqueueSeason } from "@/lib/downloader";
import { refreshSeason, resolveMany } from "@/lib/importer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function seasonEpisodeIds(seasonId: number) {
  const rows = await db
    .select({ id: episodes.id, resolveStatus: episodes.resolveStatus })
    .from(episodes)
    .where(eq(episodes.seasonId, seasonId))
    .orderBy(asc(episodes.number));
  return rows;
}

/** POST /api/seasons/[id] — refresh the season's episode list from the source. */
export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const seasonId = Number.parseInt(id, 10);
  if (!Number.isFinite(seasonId)) return fail("معرّف غير صالح");
  try {
    const result = await refreshSeason(seasonId);
    return ok(result);
  } catch (err) {
    return fail(describeError(err), 502);
  }
}

/** PUT /api/seasons/[id]?action=resolve|download */
export async function PUT(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const seasonId = Number.parseInt(id, 10);
  if (!Number.isFinite(seasonId)) return fail("معرّف غير صالح");

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "resolve";
  const body = await readJson<{ force?: boolean; onlyMissing?: boolean }>(req);

  try {
    if (action === "download") {
      const onlyMissing = bool(body.onlyMissing, true);
      const result = await enqueueSeason(seasonId, onlyMissing);
      if (result.queued === 0) {
        if (result.noSource > 0 && result.alreadyDone === 0 && result.running === 0) {
          return fail(
            `لا توجد مصادر فيديو لـ ${result.noSource} حلقة — شغّل «استخراج مصادر الموسم» أولًا، أو أضف بيانات الدخول في الإعدادات إن كانت الحلقات محمية.`,
            409,
            { data: { ...result, seasonId } },
          );
        }
        if (result.alreadyDone > 0 && result.noSource === 0) {
          return fail("كل حلقات هذا الموسم منزّلة بالفعل", 409, {
            data: { ...result, seasonId },
          });
        }
        return fail("لا توجد حلقات قابلة للتنزيل حاليًا في هذا الموسم", 409, {
          data: { ...result, seasonId },
        });
      }
      return ok({ ...result, seasonId });
    }

    const rows = await seasonEpisodeIds(seasonId);
    const targets = bool(body.force, false)
      ? rows.map((r) => r.id)
      : rows.filter((r) => r.resolveStatus !== "ready").map((r) => r.id);
    if (targets.length === 0) {
      return ok({ queued: 0, skipped: rows.length });
    }
    // Mark immediately so the UI shows live feedback, then resolve in background.
    for (const episodeId of targets) {
      await db
        .update(episodes)
        .set({ resolveStatus: "resolving", resolveError: null, updatedAt: new Date() })
        .where(eq(episodes.id, episodeId));
    }
    void (async () => {
      for (const episodeId of targets) {
        try {
          await resolveMany([episodeId]);
        } catch {
          /* per-episode errors are persisted */
        }
      }
    })();
    return ok({ queued: targets.length, skipped: rows.length - targets.length });
  } catch (err) {
    return fail(describeError(err), 502);
  }
}
