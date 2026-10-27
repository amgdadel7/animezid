import { describeError, fail, ok } from "@/lib/api";
import { cancelEpisode } from "@/lib/downloader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const episodeId = Number.parseInt(id, 10);
  if (!Number.isFinite(episodeId)) return fail("معرّف غير صالح");
  try {
    await cancelEpisode(episodeId);
    return ok({ canceled: episodeId });
  } catch (err) {
    return fail(describeError(err), 500);
  }
}
