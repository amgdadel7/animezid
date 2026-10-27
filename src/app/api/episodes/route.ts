import { eq } from "drizzle-orm";
import { db } from "@/db";
import { episodes } from "@/db/schema";
import { describeError, fail, ok, readJson, str } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/episodes
 *  - action=manual-source → attach a direct media URL to an existing episode
 *  - otherwise           → create a manual episode inside a season
 */
export async function POST(req: Request) {
  const body = await readJson<{
    seasonId?: number;
    title?: string;
    number?: number;
    watchUrl?: string;
    sourceUrl?: string;
    action?: string;
    episodeId?: number;
  }>(req);

  const action = str(body.action, "create");

  if (action === "manual-source") {
    const episodeId = body.episodeId;
    const url = str(body.sourceUrl);
    if (!episodeId || !/^https?:\/\//i.test(url)) {
      return fail("يلزم معرّف الحلقة ورابط مصدر صالح");
    }
    try {
      const { markManualSource } = await import("@/lib/importer");
      const sources = await markManualSource(
        episodeId,
        url,
        str(body.title, "مصدر يدوي") || "مصدر يدوي",
      );
      return ok({ sources });
    } catch (err) {
      return fail(describeError(err), 500);
    }
  }

  const seasonId = body.seasonId;
  const title = str(body.title);
  if (!seasonId || !title) return fail("يلزم الموسم وعنوان الحلقة");

  try {
    const existing = await db
      .select({ number: episodes.number })
      .from(episodes)
      .where(eq(episodes.seasonId, seasonId));
    const nextNumber =
      typeof body.number === "number" && body.number > 0
        ? body.number
        : existing.reduce((max, e) => Math.max(max, e.number), 0) + 1;

    const watch = str(body.watchUrl);
    const vid = watch.match(/[?&]vid=([A-Za-z0-9]+)/)?.[1] ?? null;
    const direct = str(body.sourceUrl);
    const hasDirect = /^https?:\/\//i.test(direct);

    const [row] = await db
      .insert(episodes)
      .values({
        seasonId,
        number: nextNumber,
        title,
        watchUrl: watch || null,
        videoUniq: vid,
        sources: hasDirect
          ? [
              {
                label: "مصدر يدوي",
                url: direct,
                type: /\.m3u8(\?|$)/i.test(direct) ? "hls" : "mp4",
                server: "يدوي",
              },
            ]
          : [],
        resolveStatus: hasDirect ? "ready" : "idle",
      })
      .returning();
    return ok(row);
  } catch (err) {
    return fail(describeError(err), 500);
  }
}
