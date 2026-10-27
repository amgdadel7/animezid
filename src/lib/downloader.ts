import crypto from "node:crypto";
import { createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons, series } from "@/db/schema";
import type { EpisodeSource } from "@/db/schema";
import { getSettings, logEvent, recordProviderSpeed } from "@/lib/settings";
import {
  ensureDir,
  guessExtension,
  humanBytes,
  padNumber,
  removeFile,
  safeName,
  statSize,
} from "@/lib/storage";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

interface QueueState {
  active: Map<number, AbortController>;
  pumping: boolean;
  healed: boolean;
}

const globalForQueue = globalThis as typeof globalThis & {
  __azDownloadQueue?: QueueState;
};

const queue: QueueState = (globalForQueue.__azDownloadQueue ??= {
  active: new Map(),
  pumping: false,
  healed: false,
});

export function queueSnapshot() {
  return {
    activeIds: [...queue.active.keys()],
    activeCount: queue.active.size,
  };
}

/**
 * Recover the queue after a server restart.
 *
 * Two things used to be lost across restarts, which matters enormously for a
 * 600-episode batch:
 *   - rows stuck in "downloading" were marked failed (they are merely
 *     interrupted — we re-queue them, the .part file is rewritten from scratch)
 *   - rows still "queued" never started again, because pump() only runs when
 *     something is enqueued. We now kick the pump on first health check.
 */
export async function healStuckJobs() {
  if (queue.healed) return;
  queue.healed = true;
  try {
    const stale = await db
      .select({ id: episodes.id })
      .from(episodes)
      .where(eq(episodes.downloadStatus, "downloading"));
    let requeued = 0;
    for (const row of stale) {
      if (queue.active.has(row.id)) continue;
      await db
        .update(episodes)
        .set({
          downloadStatus: "queued",
          error: null,
          progress: 0,
          speedBps: 0,
          bytesDone: "0",
          segmentsDone: 0,
          cancelRequested: false,
          updatedAt: new Date(),
        })
        .where(eq(episodes.id, row.id));
      requeued += 1;
    }

    const [pending] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(episodes)
      .where(eq(episodes.downloadStatus, "queued"));
    const pendingCount = Number(pending?.count ?? 0);

    if (requeued > 0 || pendingCount > 0) {
      await logEvent(
        "warn",
        "queue",
        `استئناف الطابور بعد إعادة التشغيل: ${requeued} تنزيل مُقاطع و${pendingCount} في الانتظار`,
      );
      void pump();
    }
  } catch {
    /* non fatal */
  }
}

export async function enqueueEpisode(episodeId: number) {
  await db
    .update(episodes)
    .set({
      downloadStatus: "queued",
      cancelRequested: false,
      error: null,
      progress: 0,
      speedBps: 0,
      updatedAt: new Date(),
    })
    .where(eq(episodes.id, episodeId));
  void pump();
}

export interface EnqueueSeasonResult {
  queued: number;
  noSource: number;
  alreadyDone: number;
  running: number;
}

/**
 * Queue every *downloadable* episode of a season.
 * Episodes without a resolved source are reported, never queued — otherwise the
 * worker would immediately fail all of them and flood the activity log.
 */
export async function enqueueSeason(
  seasonId: number,
  onlyMissing = true,
): Promise<EnqueueSeasonResult> {
  const rows = await db
    .select({
      id: episodes.id,
      downloadStatus: episodes.downloadStatus,
      sources: episodes.sources,
    })
    .from(episodes)
    .where(eq(episodes.seasonId, seasonId))
    .orderBy(asc(episodes.number));

  const result: EnqueueSeasonResult = {
    queued: 0,
    noSource: 0,
    alreadyDone: 0,
    running: 0,
  };
  const ids: number[] = [];

  for (const row of rows) {
    const list = Array.isArray(row.sources) ? row.sources : [];
    // Only a *direct* media URL can be pulled by the worker. Provider landing
    // pages (kind: "landing") are gates that open in the browser instead.
    const hasSource = list.some(
      (s) => s.kind === "direct" || (!s.kind && /^(mp4|hls|webm)$/.test(s.type)),
    );
    if (!hasSource) {
      result.noSource += 1;
      continue;
    }
    if (row.downloadStatus === "done") {
      result.alreadyDone += 1;
      if (onlyMissing) continue;
    }
    if (
      row.downloadStatus === "downloading" ||
      row.downloadStatus === "queued"
    ) {
      result.running += 1;
      continue;
    }
    ids.push(row.id);
  }

  if (ids.length === 0) return result;

  await db
    .update(episodes)
    .set({
      downloadStatus: "queued",
      cancelRequested: false,
      error: null,
      progress: 0,
      speedBps: 0,
      updatedAt: new Date(),
    })
    .where(inArray(episodes.id, ids));
  result.queued = ids.length;
  await logEvent(
    "info",
    "queue",
    `أُضيفت ${ids.length} حلقة إلى طابور التنزيل للموسم ${seasonId}`,
  );
  void pump();
  return result;
}

export async function cancelEpisode(episodeId: number) {
  const controller = queue.active.get(episodeId);
  if (controller) controller.abort();
  await db
    .update(episodes)
    .set({ cancelRequested: true, updatedAt: new Date() })
    .where(eq(episodes.id, episodeId));
  const [row] = await db
    .select({ status: episodes.downloadStatus })
    .from(episodes)
    .where(eq(episodes.id, episodeId))
    .limit(1);
  if (row && row.status === "queued") {
    await db
      .update(episodes)
      .set({ downloadStatus: "canceled", speedBps: 0, updatedAt: new Date() })
      .where(eq(episodes.id, episodeId));
  }
}

async function pump() {
  if (queue.pumping) return;
  queue.pumping = true;
  try {
    const settings = await getSettings();
    const limit = Math.max(1, Math.min(6, settings.concurrency || 2));
    while (queue.active.size < limit) {
      const [next] = await db
        .select({ id: episodes.id })
        .from(episodes)
        .where(eq(episodes.downloadStatus, "queued"))
        .orderBy(asc(episodes.seasonId), asc(episodes.number))
        .limit(1);
      if (!next) break;
      const controller = new AbortController();
      queue.active.set(next.id, controller);
      // Mark as claimed synchronously-ish to avoid double pickup.
      await db
        .update(episodes)
        .set({ downloadStatus: "downloading", startedAt: new Date(), updatedAt: new Date() })
        .where(eq(episodes.id, next.id));
      void runJob(next.id, controller.signal).finally(() => {
        queue.active.delete(next.id);
        void pump();
      });
    }
  } catch (err) {
    await logEvent("error", "queue", `تعذّر تشغيل الطابور: ${describe(err)}`);
  } finally {
    queue.pumping = false;
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

async function markFailed(episodeId: number, message: string) {
  await db
    .update(episodes)
    .set({
      downloadStatus: "failed",
      error: message,
      speedBps: 0,
      progress: 0,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(episodes.id, episodeId));
  await logEvent("error", "download", message, { episodeId });
}

async function markDone(
  episodeId: number,
  filePath: string,
  size: number,
  mime: string,
  telemetry?: { provider?: string; elapsedMs?: number },
) {
  await db
    .update(episodes)
    .set({
      downloadStatus: "done",
      progress: 100,
      filePath,
      fileSize: String(size),
      mimeType: mime,
      error: null,
      speedBps: 0,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(episodes.id, episodeId));
  // Feed the measured throughput back into provider ranking so the next
  // episode prefers the host that actually delivered fastest.
  if (telemetry?.provider && telemetry.elapsedMs && telemetry.elapsedMs > 0) {
    const bps = Math.round((size / telemetry.elapsedMs) * 1000);
    await recordProviderSpeed(telemetry.provider, bps);
  }

  await logEvent(
    "success",
    "download",
    `اكتمل التنزيل — ${humanBytes(size)}`,
    { episodeId, meta: { path: filePath, provider: telemetry?.provider ?? null } },
  );
}

interface TargetInfo {
  dir: string;
  baseName: string;
  episodeTitle: string;
}

async function resolveTarget(episodeId: number): Promise<TargetInfo | null> {
  const settings = await getSettings();
  const rows = await db
    .select({
      epNumber: episodes.number,
      epTitle: episodes.title,
      seasonNumber: seasons.number,
      seasonTitle: seasons.title,
      seriesTitle: series.title,
      seriesSlug: series.slug,
    })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .innerJoin(series, eq(seasons.seriesId, series.id))
    .where(eq(episodes.id, episodeId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const root = settings.downloadDir?.trim()
    ? path.resolve(settings.downloadDir.trim())
    : path.join(process.cwd(), "downloads");
  const seriesFolder = safeName(row.seriesSlug || row.seriesTitle, "series");
  const seasonFolder = `الموسم ${padNumber(row.seasonNumber)}`;
  const dir = path.join(root, seriesFolder, seasonFolder);
  await ensureDir(dir);

  const episodeTitle = safeName(row.epTitle, `الحلقة ${row.epNumber}`);
  const baseName = safeName(
    `S${padNumber(row.seasonNumber)}E${padNumber(row.epNumber)} — ${episodeTitle}`,
    "episode",
  );
  return { dir, baseName, episodeTitle };
}

async function runJob(episodeId: number, signal: AbortSignal) {
  const [ep] = await db
    .select()
    .from(episodes)
    .where(eq(episodes.id, episodeId))
    .limit(1);
  if (!ep) return;

  const sources = (ep.sources ?? []) as EpisodeSource[];
  const source: EpisodeSource | undefined =
    sources[ep.selectedSourceIndex] ?? sources[0];

  if (!source) {
    await markFailed(episodeId, "لا يوجد مصدر فيديو — استخرج المصادر أولًا");
    return;
  }

  const target = await resolveTarget(episodeId);
  if (!target) {
    await markFailed(episodeId, "تعذّر تحديد مسار الحفظ للسلسلة/الموسم");
    return;
  }

  await db
    .update(episodes)
    .set({
      attempts: ep.attempts + 1,
      bytesDone: "0",
      bytesTotal: "0",
      segmentsDone: 0,
      segmentsTotal: 0,
      updatedAt: new Date(),
    })
    .where(eq(episodes.id, episodeId));

  await logEvent(
    "info",
    "download",
    `بدأ تنزيل «${ep.title}» من ${source.server ?? source.label}`,
    { episodeId },
  );

  const attempt = async (src: EpisodeSource) => {
    if (src.type === "hls" || /\.m3u8(\?|$)/i.test(src.url)) {
      await downloadHls(episodeId, src, target, signal);
    } else {
      await downloadDirect(episodeId, src, target, signal);
    }
  };

  try {
    await attempt(source);
  } catch (err) {
    if (signal.aborted || (await wasCanceled(episodeId))) {
      await db
        .update(episodes)
        .set({
          downloadStatus: "canceled",
          speedBps: 0,
          error: "أُلغي التنزيل بطلب المستخدم",
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(episodes.id, episodeId));
      await logEvent("warn", "download", `أُلغي تنزيل «${ep.title}»`, {
        episodeId,
      });
      return;
    }

    const message = describe(err);
    // Signed stream URLs expire (the HLS token here lives ~4h). A big season
    // queued in one go WILL hit this, so re-resolve and retry once.
    const looksExpired =
      /HTTP (403|404|410)|forbidden|expired|gone|انتهت الصلاحية|تعذّر جلب المقطع/i.test(
        message,
      );

    if (looksExpired && ep.attempts < 2) {
      await logEvent(
        "warn",
        "download",
        `انتهت صلاحية الرابط — جارٍ استخراج مصدر جديد لـ«${ep.title}»`,
        { episodeId },
      );
      try {
        const { resolveEpisode } = await import("@/lib/importer");
        const res = await resolveEpisode(episodeId);
        const fresh = res.sources[0];
        if (res.ok && fresh?.url) {
          await db
            .update(episodes)
            .set({
              downloadStatus: "downloading",
              error: null,
              progress: 0,
              speedBps: 0,
              updatedAt: new Date(),
            })
            .where(eq(episodes.id, episodeId));
          await attempt(fresh);
          return;
        }
        await markFailed(
          episodeId,
          `${message} — ولم يُعثر على مصدر بديل صالح`,
        );
        return;
      } catch (retryErr) {
        await markFailed(
          episodeId,
          `${message} — وفشلت إعادة الاستخراج: ${describe(retryErr)}`,
        );
        return;
      }
    }

    await markFailed(episodeId, message);
  }
}

async function wasCanceled(episodeId: number) {
  const [row] = await db
    .select({ cancelRequested: episodes.cancelRequested })
    .from(episodes)
    .where(eq(episodes.id, episodeId))
    .limit(1);
  return Boolean(row?.cancelRequested);
}

/** Throttled DB writer for progress updates. */
function createProgressWriter(episodeId: number) {
  let lastWrite = 0;
  let lastPercent = -1;
  return async function write(
    payload: {
      progress?: number;
      bytesDone?: number;
      bytesTotal?: number;
      speedBps?: number;
      segmentsDone?: number;
      segmentsTotal?: number;
    },
    force = false,
  ) {
    const now = Date.now();
    const percent = Math.round(payload.progress ?? lastPercent);
    if (!force && now - lastWrite < 600 && percent === lastPercent) return;
    lastWrite = now;
    lastPercent = percent;
    await db
      .update(episodes)
      .set({
        ...(payload.progress !== undefined
          ? { progress: Math.max(0, Math.min(100, percent)) }
          : {}),
        ...(payload.bytesDone !== undefined
          ? { bytesDone: String(Math.round(payload.bytesDone)) }
          : {}),
        ...(payload.bytesTotal !== undefined
          ? { bytesTotal: String(Math.round(payload.bytesTotal)) }
          : {}),
        ...(payload.speedBps !== undefined
          ? { speedBps: Math.max(0, Math.round(payload.speedBps)) }
          : {}),
        ...(payload.segmentsDone !== undefined
          ? { segmentsDone: payload.segmentsDone }
          : {}),
        ...(payload.segmentsTotal !== undefined
          ? { segmentsTotal: payload.segmentsTotal }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(episodes.id, episodeId));
  };
}

/**
 * CDNs validate the Referer against their *own* player origin, not the anime
 * site's. Sending `Referer: animezid.org` to `strm1.uqload.vc` gets a 403, so
 * the headers are derived from the media URL itself.
 */
function mediaHeadersFor(url: string, referer?: string): Record<string, string> {
  let origin = "https://animezid.org";
  try {
    origin = new URL(url).origin;
  } catch {
    /* keep default */
  }
  return {
    "User-Agent": UA,
    Referer: referer ?? `${origin}/`,
    Origin: origin,
    Accept: "*/*",
    "Accept-Language": "ar,en;q=0.8",
  };
}

const MEDIA_HEADERS: Record<string, string> = mediaHeadersFor("https://animezid.org/");



/** Inactivity limit for a single stream read before we declare it stalled. */
const IDLE_TIMEOUT_MS = 45_000;

/**
 * Abort a transfer that stops delivering bytes.
 *
 * File hosts routinely stall a connection without closing it, which leaves
 * `reader.read()` pending forever: the row stayed "downloading" at a fixed byte
 * count indefinitely and blocked a queue slot. The watchdog turns that into a
 * normal failure so the retry path can re-resolve and continue.
 */
function createWatchdog(external: AbortSignal, idleMs = IDLE_TIMEOUT_MS) {
  const ctrl = new AbortController();
  let last = Date.now();
  let stalled = false;

  const timer = setInterval(() => {
    if (ctrl.signal.aborted) return;
    if (Date.now() - last > idleMs) {
      stalled = true;
      ctrl.abort();
    }
  }, 2000);

  const onExternal = () => ctrl.abort();
  if (external.aborted) ctrl.abort();
  else external.addEventListener("abort", onExternal, { once: true });

  return {
    signal: ctrl.signal,
    touch: () => {
      last = Date.now();
    },
    wasStalled: () => stalled,
    dispose: () => {
      clearInterval(timer);
      external.removeEventListener("abort", onExternal);
    },
  };
}

async function downloadDirect(
  episodeId: number,
  source: EpisodeSource,
  target: TargetInfo,
  signal: AbortSignal,
) {
  const write = createProgressWriter(episodeId);
  const watch = createWatchdog(signal);
  let res = await fetch(source.url, {
    headers: mediaHeadersFor(source.url),
    signal: watch.signal,
  });
  watch.touch();
  if (!res.ok || !res.body) {
    throw new Error(`رفض خادم الفيديو الطلب (HTTP ${res.status})`);
  }
  const rawMime = res.headers.get("content-type") ?? "";
  let total = Number.parseInt(res.headers.get("content-length") ?? "0", 10) || 0;
  const ext = guessExtension(source.url, rawMime);
  // Hosts often serve video as application/octet-stream; normalise it so the
  // stored type can drive inline browser playback.
  const mime =
    !rawMime || /octet-stream/i.test(rawMime)
      ? ext === ".webm"
        ? "video/webm"
        : ext === ".mkv"
          ? "video/x-matroska"
          : ext === ".ts"
            ? "video/mp2t"
            : "video/mp4"
      : rawMime.split(";")[0].trim();
  const finalPath = path.join(target.dir, `${target.baseName}${ext}`);
  const partPath = `${finalPath}.part`;

  /*
   * Resume support.
   *
   * A 190 MB pull at a file host's ~0.29 MB/s takes ~11 minutes, so any server
   * restart used to throw that work away and start from zero. If a partial file
   * survives and the host honours Range, we continue where we left off.
   */
  let done = 0;
  let openMode: "w" | "a" = "w";
  const existing = await statSize(partPath);

  if (existing > 0 && total > 0 && existing < total) {
    // Drop the full-body response we already opened, then ask for the tail.
    await res.body?.cancel().catch(() => undefined);
    const ranged = await fetch(source.url, {
      headers: { ...mediaHeadersFor(source.url), Range: `bytes=${existing}-` },
      signal: watch.signal,
    });
    watch.touch();
    if (ranged.status === 206 && ranged.body) {
      res = ranged;
      done = existing;
      openMode = "a";
      const rangeTotal = Number.parseInt(
        (ranged.headers.get("content-range") ?? "").split("/")[1] ?? "0",
        10,
      );
      if (rangeTotal > 0) total = rangeTotal;
      await logEvent(
        "info",
        "download",
        `استئناف التنزيل من ${humanBytes(existing)} من ${humanBytes(total)}`,
        { episodeId },
      );
    } else {
      // Host ignored Range (200) — start clean with the fresh response.
      await ranged.body?.cancel().catch(() => undefined);
      await removeFile(partPath);
    }
  } else if (existing >= total && total > 0) {
    // Part file is already complete; just promote it.
    await res.body?.cancel().catch(() => undefined);
    await fs.rename(partPath, finalPath);
    const size = await statSize(finalPath);
    await write({ progress: 100, bytesDone: size, bytesTotal: size, speedBps: 0 }, true);
    await markDone(episodeId, finalPath, size, mime, {
      provider: source.provider ?? source.server,
      elapsedMs: 1,
    });
    return;
  }

  await write({ bytesDone: done, bytesTotal: total, progress: total > 0 ? (done / total) * 100 : 0 }, true);

  const fileHandle = await fs.open(partPath, openMode);
  const out = createWriteStream("", { fd: fileHandle.fd, autoClose: true });
  const reader = res.body!.getReader();
  const startedAt = Date.now();
  const resumedFrom = done;

  try {
    for (;;) {
      if (signal.aborted) throw new Error("canceled");
      if (watch.wasStalled()) {
        throw new Error(
          `توقّف المضيف عن إرسال البيانات لأكثر من ${Math.round(
            IDLE_TIMEOUT_MS / 1000,
          )} ثانية`,
        );
      }
      const chunk = await reader.read();
      if (chunk.done) break;
      watch.touch();
      const bytes = Buffer.from(chunk.value.buffer, chunk.value.byteOffset, chunk.value.byteLength);
      await new Promise<void>((resolve, reject) => {
        out.write(bytes, (err) => (err ? reject(err) : resolve()));
      });
      done += bytes.byteLength;
      const elapsed = Math.max(0.25, (Date.now() - startedAt) / 1000);
      await write({
        bytesDone: done,
        bytesTotal: total,
        progress: total > 0 ? (done / total) * 100 : 0,
        // Measure only this attempt's bytes, or a resumed run reports a
        // meaningless inflated speed.
        speedBps: (done - resumedFrom) / elapsed,
      });
      if (await wasCanceled(episodeId)) throw new Error("canceled");
    }
  } catch (err) {
    if (watch.wasStalled() && !String((err as Error)?.message ?? "").includes("توقّف المضيف")) {
      throw new Error(
        `توقّف المضيف عن إرسال البيانات لأكثر من ${Math.round(
          IDLE_TIMEOUT_MS / 1000,
        )} ثانية`,
      );
    }
    throw err;
  } finally {
    watch.dispose();
    await new Promise<void>((resolve) => out.end(() => resolve()));
  }

  if (signal.aborted || (await wasCanceled(episodeId))) {
    await removeFile(partPath);
    throw new Error("canceled");
  }

  await fs.rename(partPath, finalPath);
  const size = await statSizeSafe(finalPath);
  await write({ progress: 100, bytesDone: size, bytesTotal: size, speedBps: 0 }, true);
  await markDone(episodeId, finalPath, size, mime, {
    provider: source.provider ?? source.server,
    elapsedMs: Date.now() - startedAt,
  });
}

async function statSizeSafe(p: string) {
  try {
    const s = await fs.stat(p);
    return s.size;
  } catch {
    return 0;
  }
}

interface HlsKey {
  method: string;
  uri: string | null;
  iv: Buffer | null;
}

interface HlsSegment {
  uri: string;
  key: HlsKey | null;
  sequence: number;
}

function parseAttributeList(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    out[m[1].toUpperCase()] = m[2].replace(/^"|"$/g, "");
  }
  return out;
}

function resolveUri(base: string, uri: string) {
  if (/^https?:\/\//i.test(uri)) return uri;
  return new URL(uri, base).toString();
}

async function fetchText(url: string, signal: AbortSignal) {
  const res = await fetch(url, { headers: mediaHeadersFor(url), signal });
  if (!res.ok) throw new Error(`تعذّر جلب قائمة التشغيل (HTTP ${res.status})`);
  return res.text();
}

async function downloadHls(
  episodeId: number,
  source: EpisodeSource,
  target: TargetInfo,
  signal: AbortSignal,
) {
  const write = createProgressWriter(episodeId);
  const settings = await getSettings();
  const watch = createWatchdog(signal);
  let playlistUrl = source.url;
  let playlist = await fetchText(playlistUrl, watch.signal);
  watch.touch();
  // Segments inherit the playlist's origin as Referer (player-style request).
  const playlistOrigin = (() => {
    try {
      return `${new URL(playlistUrl).origin}/`;
    } catch {
      return undefined;
    }
  })();

  // Master playlist → choose a variant rendition.
  if (playlist.includes("#EXT-X-STREAM-INF")) {
    const variants: { bandwidth: number; resolution: string; url: string }[] = [];
    const lines = playlist.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line.startsWith("#EXT-X-STREAM-INF")) continue;
      const attrs = parseAttributeList(line);
      const next = lines[i + 1]?.trim();
      if (!next || next.startsWith("#")) continue;
      variants.push({
        bandwidth: Number.parseInt(attrs["BANDWIDTH"] ?? "0", 10) || 0,
        resolution: attrs["RESOLUTION"] ?? "",
        url: resolveUri(playlistUrl, next),
      });
    }
    if (variants.length === 0) throw new Error("قائمة رئيسية بلا مسارات فرعية");
    variants.sort((a, b) => b.bandwidth - a.bandwidth);
    const preferred =
      settings.preferredQuality === "lowest"
        ? variants[variants.length - 1]
        : variants[0];
    playlistUrl = preferred.url;
    playlist = await fetchText(playlistUrl, watch.signal);
    watch.touch();
  }

  const segments: HlsSegment[] = [];
  let currentKey: HlsKey | null = null;
  let sequence = 0;
  const lines = playlist.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE")) {
      sequence = Number.parseInt(line.split(":")[1] ?? "0", 10) || 0;
      continue;
    }
    if (line.startsWith("#EXT-X-KEY")) {
      const attrs = parseAttributeList(line);
      const method = (attrs["METHOD"] ?? "NONE").toUpperCase();
      if (method === "NONE") {
        currentKey = null;
      } else {
        currentKey = {
          method,
          uri: attrs["URI"] ? resolveUri(playlistUrl, attrs["URI"]) : null,
          iv: attrs["IV"] ? Buffer.from(attrs["IV"].replace(/^0x/i, ""), "hex") : null,
        };
      }
      continue;
    }
    if (line.startsWith("#")) continue;
    segments.push({ uri: resolveUri(playlistUrl, line), key: currentKey, sequence });
    sequence += 1;
  }

  if (segments.length === 0) throw new Error("لم تُعثر على مقاطع داخل قائمة التشغيل");

  // `.m2ts`, not `.ts`: identical MPEG-TS container, but a `.ts` video inside
  // the project tree gets picked up by TypeScript/ESLint as source code.
  const finalPath = path.join(target.dir, `${target.baseName}.m2ts`);
  const partPath = `${finalPath}.part`;
  const out = await fs.open(partPath, "w");
  const keyCache = new Map<string, Buffer>();
  let doneBytes = 0;
  const startedAt = Date.now();

  await write(
    { segmentsTotal: segments.length, segmentsDone: 0, progress: 0 },
    true,
  );

  try {
    for (let i = 0; i < segments.length; i++) {
      if (signal.aborted || (await wasCanceled(episodeId))) {
        throw new Error("canceled");
      }
      const seg = segments[i];
      if (watch.wasStalled()) {
        throw new Error(
          `توقّف المضيف عن إرسال البيانات لأكثر من ${Math.round(
            IDLE_TIMEOUT_MS / 1000,
          )} ثانية`,
        );
      }
      const res = await fetch(seg.uri, {
        headers: mediaHeadersFor(seg.uri, playlistOrigin),
        signal: watch.signal,
      });
      if (!res.ok) {
        throw new Error(`فشل جلب المقطع ${i + 1} (HTTP ${res.status})`);
      }
      let buf = Buffer.from(await res.arrayBuffer());
      watch.touch();

      if (seg.key && seg.key.method === "AES-128" && seg.key.uri) {
        let key = keyCache.get(seg.key.uri);
        if (!key) {
          const keyRes = await fetch(seg.key.uri, {
            headers: mediaHeadersFor(seg.key.uri, playlistOrigin),
            signal: watch.signal,
          });
          if (!keyRes.ok) throw new Error("تعذّر جلب مفتاح فك التشفير");
          key = Buffer.from(await keyRes.arrayBuffer());
          if (key.length !== 16) throw new Error("مفتاح تشفير غير صالح");
          keyCache.set(seg.key.uri, key);
        }
        const iv =
          seg.key.iv ??
          Buffer.concat([Buffer.alloc(8), Buffer.from(String(seg.sequence))])
            .subarray(0, 16);
        const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
        buf = Buffer.concat([decipher.update(buf), decipher.final()]);
      } else if (seg.key && seg.key.method && seg.key.method !== "NONE") {
        throw new Error(`طريقة تشفير غير مدعومة: ${seg.key.method}`);
      }

      await out.write(buf);
      doneBytes += buf.byteLength;
      const elapsed = Math.max(0.25, (Date.now() - startedAt) / 1000);
      await write({
        segmentsDone: i + 1,
        segmentsTotal: segments.length,
        bytesDone: doneBytes,
        progress: ((i + 1) / segments.length) * 100,
        speedBps: doneBytes / elapsed,
      });
    }
  } finally {
    watch.dispose();
    await out.close();
  }

  if (signal.aborted || (await wasCanceled(episodeId))) {
    await removeFile(partPath);
    throw new Error("canceled");
  }

  await fs.rename(partPath, finalPath);
  const size = await statSizeSafe(finalPath);
  await write(
    {
      progress: 100,
      bytesDone: size,
      bytesTotal: size,
      speedBps: 0,
      segmentsDone: segments.length,
    },
    true,
  );
  await markDone(episodeId, finalPath, size, "video/mp2t", {
    provider: source.provider ?? source.server,
    elapsedMs: Date.now() - startedAt,
  });
}
