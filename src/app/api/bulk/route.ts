import { describeError, fail, ok, int } from "@/lib/api";
import { bulkStatus, startBulkSeason, startBulkSeries, stopBulk } from "@/lib/bulk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/bulk              → status of every bulk run
 * POST /api/bulk              → start { seasonId } or { seriesId }
 * DELETE /api/bulk?key=...    → cooperatively stop a run
 */
export async function GET() {
  return ok(bulkStatus());
}

export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.clone().json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const seasonId = int(body.seasonId, 0);
  const seriesId = int(body.seriesId, 0);

  try {
    if (seasonId > 0) return ok(await startBulkSeason(seasonId));
    if (seriesId > 0) return ok(await startBulkSeries(seriesId));
    return fail("يلزم seasonId أو seriesId");
  } catch (err) {
    return fail(describeError(err), 502);
  }
}

export async function DELETE(req: Request) {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (!key) return fail("يلزم مفتاح العملية");
  return stopBulk(key) ? ok({ stopped: key }) : fail("لا توجد عملية جارية بهذا المفتاح", 404);
}
