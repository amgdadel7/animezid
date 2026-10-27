import { desc, gt } from "drizzle-orm";
import { db } from "@/db";
import { activityLog } from "@/db/schema";
import { describeError, fail, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const since = Number.parseInt(url.searchParams.get("since") ?? "0", 10) || 0;
    const limit = Math.min(
      200,
      Math.max(10, Number.parseInt(url.searchParams.get("limit") ?? "60", 10) || 60),
    );
    const rows = await db
      .select()
      .from(activityLog)
      .where(since > 0 ? gt(activityLog.id, since) : undefined)
      .orderBy(desc(activityLog.id))
      .limit(limit);
    return ok(rows.reverse());
  } catch (err) {
    return fail(describeError(err), 500);
  }
}

export async function DELETE() {
  try {
    await db.delete(activityLog);
    return ok({ cleared: true });
  } catch (err) {
    return fail(describeError(err), 500);
  }
}
