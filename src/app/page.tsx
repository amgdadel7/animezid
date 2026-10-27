import { pingDatabase, type DbTarget } from "@/db";
import { Dashboard } from "@/components/Dashboard";
import { healStuckJobs } from "@/lib/downloader";
import { listSeriesRows, storageSummary } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function HomePage() {
  let series: Awaited<ReturnType<typeof listSeriesRows>> = [];
  let storage = { episodes: 0, bytes: "0", seasons: 0 };
  let dbOnline = true;
  let dbError = "";
  let dbTarget: DbTarget | null = null;

  const ping = await pingDatabase({ retries: 2 });
  dbTarget = ping.target;
  dbOnline = ping.ok;

  // Recover the download queue on every page load too, so a restart never
  // leaves rows stranded in "downloading"/"queued" with no worker behind them.
  if (ping.ok) void healStuckJobs();

  if (!ping.ok) {
    dbError = ping.message;
    console.error(
      `[mirfa] database unreachable (${ping.target.origin} ${ping.target.host}:${ping.target.port}/${ping.target.database}) after ${ping.attempts} attempt(s): ${ping.message}`,
    );
  } else {
    try {
      [series, storage] = await Promise.all([listSeriesRows(), storageSummary()]);
    } catch (err) {
      dbOnline = false;
      dbError = err instanceof Error ? err.message : String(err);
      console.error("[mirfa] library query failed:", dbError);
    }
  }

  return (
    <Dashboard
      initialSeries={series}
      initialStorage={storage}
      dbOnline={dbOnline}
      dbError={dbError}
      dbTarget={dbTarget}
    />
  );
}
