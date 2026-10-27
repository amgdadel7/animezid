import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { episodes } from "@/db/schema";
import { describeError, fail, ok, readJson, str } from "@/lib/api";
import { importFromWatchUrl, resolveEpisode } from "@/lib/importer";
import { listSeriesRows } from "@/lib/queries";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return ok(await listSeriesRows());
  } catch (err) {
    return fail(describeError(err), 500);
  }
}

export async function POST(req: Request) {
  const body = await readJson<{ url: string; autoResolve?: boolean }>(req);
  const url = str(body.url);
  if (!url || !/^https?:\/\//i.test(url)) {
    return fail("أدخل رابط مشاهدة صالحًا يبدأ بـ https://");
  }

  try {
    const summary = await importFromWatchUrl(url);
    const settings = await getSettings();
    const wantResolve =
      typeof body.autoResolve === "boolean" ? body.autoResolve : settings.autoResolveOnImport;

    if (wantResolve) {
      const rows = await db
        .select({ id: episodes.id, resolveStatus: episodes.resolveStatus })
        .from(episodes)
        .where(eq(episodes.seasonId, summary.seasonId))
        .orderBy(asc(episodes.number));
      const pending = rows.filter((r) => r.resolveStatus !== "ready").map((r) => r.id);
      if (pending.length > 0) {
        // Fire and forget: the UI polls /api/state for progress.
        void (async () => {
          for (const id of pending) {
            try {
              await resolveEpisode(id);
            } catch {
              /* handled inside resolveEpisode */
            }
          }
        })();
        summary.warnings.push(
          `جارٍ استخراج مصادر ${pending.length} حلقة في الخلفية`,
        );
      }
    }

    return ok(summary);
  } catch (err) {
    return fail(describeError(err), 502);
  }
}
