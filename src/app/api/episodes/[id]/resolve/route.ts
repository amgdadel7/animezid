import { describeError, fail, ok } from "@/lib/api";
import { resolveEpisode } from "@/lib/importer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const episodeId = Number.parseInt(id, 10);
  if (!Number.isFinite(episodeId)) return fail("معرّف غير صالح");
  try {
    const result = await resolveEpisode(episodeId);
    return result.ok ? ok(result) : fail(result.message, 409, { data: result });
  } catch (err) {
    return fail(describeError(err), 502);
  }
}
