import { NextResponse } from "next/server";
import { pingDatabase, resolveConnectionString } from "@/db";
import { healStuckJobs } from "@/lib/downloader";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Health + database diagnostics.
 * Reports where the app is trying to connect and, when it fails, the actionable
 * reason instead of a bare boolean.
 */
export async function GET(req: Request) {
  const verbose = new URL(req.url).searchParams.get("verbose") === "1";
  const started = Date.now();

  // The platform probes this endpoint on every start, which makes it the
  // reliable place to recover the download queue: rows left "downloading" by a
  // previous process are re-queued and the pump is kicked, resuming from the
  // bytes already on disk.
  void healStuckJobs();

  try {
    const ping = await pingDatabase({ retries: 1 });
    const { reason } = resolveConnectionString();

    if (!ping.ok) {
      return NextResponse.json(
        {
          ok: false,
          stage: "database",
          target: ping.target,
          attempts: ping.attempts,
          durationMs: Date.now() - started,
          error: ping.message,
          hint: reason ?? null,
        },
        { status: 503 },
      );
    }

    const target = verbose ? ping.target : { ...ping.target, label: "connected" };
    return NextResponse.json({
      ok: true,
      stage: "ready",
      target,
      attempts: ping.attempts,
      durationMs: Date.now() - started,
      hint: reason ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, stage: "exception", error: message },
      { status: 500 },
    );
  }
}


