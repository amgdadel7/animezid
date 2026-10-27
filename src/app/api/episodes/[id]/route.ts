import { eq } from "drizzle-orm";
import { db } from "@/db";
import { episodes } from "@/db/schema";
import { bool, describeError, fail, ok, readJson, str } from "@/lib/api";
import { cancelEpisode } from "@/lib/downloader";
import { removeFile } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function parseId(id: string) {
  const n = Number.parseInt(id, 10);
  return Number.isFinite(n) ? n : null;
}

/** PATCH /api/episodes/[id] — rename or pick another resolved source. */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const episodeId = parseId(id);
  if (!episodeId) return fail("معرّف غير صالح");
  const body = await readJson<{ title?: string; selectedSourceIndex?: number }>(req);

  try {
    await db
      .update(episodes)
      .set({
        ...(body.title ? { title: str(body.title) } : {}),
        ...(typeof body.selectedSourceIndex === "number"
          ? { selectedSourceIndex: Math.max(0, body.selectedSourceIndex) }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(episodes.id, episodeId));
    const [row] = await db
      .select()
      .from(episodes)
      .where(eq(episodes.id, episodeId))
      .limit(1);
    return ok(row);
  } catch (err) {
    return fail(describeError(err), 500);
  }
}

/** DELETE /api/episodes/[id]?file=1 — drop the row and its downloaded file. */
export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const episodeId = parseId(id);
  if (!episodeId) return fail("معرّف غير صالح");
  const removeFileToo = bool(new URL(req.url).searchParams.get("file"), true);

  try {
    if (removeFileToo) {
      const [row] = await db
        .select({ filePath: episodes.filePath })
        .from(episodes)
        .where(eq(episodes.id, episodeId))
        .limit(1);
      if (row?.filePath) await removeFile(row.filePath);
    }
    await cancelEpisode(episodeId).catch(() => undefined);
    await db.delete(episodes).where(eq(episodes.id, episodeId));
    return ok({ deleted: episodeId });
  } catch (err) {
    return fail(describeError(err), 500);
  }
}
