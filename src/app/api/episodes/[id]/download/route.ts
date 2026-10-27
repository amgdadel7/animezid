import { eq } from "drizzle-orm";
import { db } from "@/db";
import { episodes } from "@/db/schema";
import { describeError, fail, ok } from "@/lib/api";
import { enqueueEpisode } from "@/lib/downloader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const episodeId = Number.parseInt(id, 10);
  if (!Number.isFinite(episodeId)) return fail("معرّف غير صالح");
  try {
    const [ep] = await db
      .select({ sources: episodes.sources, downloadStatus: episodes.downloadStatus })
      .from(episodes)
      .where(eq(episodes.id, episodeId))
      .limit(1);
    if (!ep) return fail("الحلقة غير موجودة", 404);
    if ((ep.sources ?? []).length === 0) {
      return fail("لا يوجد مصدر فيديو لهذه الحلقة — استخرج المصادر أولًا", 409);
    }
    if (ep.downloadStatus === "downloading") {
      return fail("التنزيل جارٍ بالفعل لهذه الحلقة", 409);
    }
    await enqueueEpisode(episodeId);
    return ok({ queued: episodeId });
  } catch (err) {
    return fail(describeError(err), 500);
  }
}
