import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons, series } from "@/db/schema";
import type { EpisodeSource } from "@/db/schema";
import {
  getProviderStats,
  logEvent,
  recordProviderOutcome,
  resolveSiteCookie,
  type ProviderStat,
} from "@/lib/settings";
import {
  PlaybackError,
  type PlaybackSession,
  type PlaybackSourceRef,
  extractDirectFromLanding,
  playbackPausedMs,
  followLaunch,
  openPlaybackSession,
  resolveSourceLaunch,
} from "@/lib/site/playback";
import {
  SITE_ORIGIN,
  type ScrapedEpisodeRef,
  extractVid,
  normalizeSeasonTitle,
  scrapeDirectMedia,
  scrapeSeasonPage,
  scrapeWatchPage,
  seasonUrl,
  seriesUrl,
  siteFetch,
  watchUrl,
} from "@/lib/site/animezid";

export interface ImportSummary {
  seriesId: number;
  seasonId: number;
  seasonNumber: number;
  seriesTitle: string;
  seasonTitle: string;
  episodesAdded: number;
  episodesExisting: number;
  seasonsDiscovered: number;
  posterUrl: string | null;
  warnings: string[];
}

function slugify(input: string) {
  const trimmed = input.trim().toLowerCase();
  const latin = trimmed
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (latin.length >= 3) return latin;
  // Arabic titles: keep a stable hash-ish slug
  let hash = 0;
  for (let i = 0; i < trimmed.length; i++) {
    hash = (hash * 31 + trimmed.charCodeAt(i)) | 0;
  }
  return `series-${Math.abs(hash).toString(36)}`;
}

async function upsertSeries(input: {
  title: string;
  originalTitle?: string | null;
  slug?: string | null;
  sourceUrl?: string | null;
  posterUrl?: string | null;
  synopsis?: string | null;
  genres?: string[];
  year?: string | null;
  language?: string | null;
  quality?: string | null;
}) {
  const existing = input.sourceUrl
    ? await db
        .select()
        .from(series)
        .where(eq(series.sourceUrl, input.sourceUrl))
        .limit(1)
    : [];

  const payload = {
    title: input.title,
    originalTitle: input.originalTitle ?? null,
    slug: input.slug ?? slugify(input.title),
    sourceUrl: input.sourceUrl ?? null,
    posterUrl: input.posterUrl ?? null,
    synopsis: input.synopsis ?? null,
    genres: input.genres ?? [],
    year: input.year ?? null,
    language: input.language ?? null,
    quality: input.quality ?? null,
    updatedAt: new Date(),
  };

  if (existing[0]) {
    await db
      .update(series)
      .set(payload)
      .where(eq(series.id, existing[0].id));
    return existing[0].id;
  }
  const [row] = await db.insert(series).values(payload).returning({ id: series.id });
  return row.id;
}

async function upsertSeason(seriesId: number, number: number, patch: {
  title?: string | null;
  sourceUrl?: string | null;
  episodeCount?: number;
}) {
  const found = await db
    .select()
    .from(seasons)
    .where(and(eq(seasons.seriesId, seriesId), eq(seasons.number, number)))
    .limit(1);
  if (found[0]) {
    await db
      .update(seasons)
      .set({
        title: patch.title ?? found[0].title,
        sourceUrl: patch.sourceUrl ?? found[0].sourceUrl,
        episodeCount:
          patch.episodeCount && patch.episodeCount > 0
            ? patch.episodeCount
            : found[0].episodeCount,
        updatedAt: new Date(),
      })
      .where(eq(seasons.id, found[0].id));
    return found[0].id;
  }
  const [row] = await db
    .insert(seasons)
    .values({
      seriesId,
      number,
      title: patch.title ?? `الموسم ${number}`,
      sourceUrl: patch.sourceUrl ?? null,
      episodeCount: patch.episodeCount ?? 0,
    })
    .returning({ id: seasons.id });
  return row.id;
}

async function upsertEpisodes(
  seasonId: number,
  refs: ScrapedEpisodeRef[],
): Promise<{ added: number; existing: number }> {
  let added = 0;
  let existing = 0;
  for (const ref of refs) {
    if (ref.watchUrl) {
      const dup = await db
        .select({ id: episodes.id })
        .from(episodes)
        .where(eq(episodes.watchUrl, ref.watchUrl))
        .limit(1);
      if (dup[0]) {
        existing += 1;
        continue;
      }
    }
    const sameNumber = await db
      .select({ id: episodes.id })
      .from(episodes)
      .where(and(eq(episodes.seasonId, seasonId), eq(episodes.number, ref.number)))
      .limit(1);
    if (sameNumber[0]) {
      await db
        .update(episodes)
        .set({
          title: ref.title,
          watchUrl: ref.watchUrl,
          videoUniq: ref.videoUniq,
          posterUrl: ref.posterUrl ?? null,
          updatedAt: new Date(),
        })
        .where(eq(episodes.id, sameNumber[0].id));
      existing += 1;
      continue;
    }
    await db.insert(episodes).values({
      seasonId,
      number: ref.number,
      title: ref.title,
      watchUrl: ref.watchUrl || null,
      videoUniq: ref.videoUniq || null,
      posterUrl: ref.posterUrl,
    });
    added += 1;
  }
  return { added, existing };
}

/** Import (or refresh) the season that a watch URL belongs to. */
export async function importFromWatchUrl(input: string): Promise<ImportSummary> {
  const vid = extractVid(input);
  if (!vid) {
    throw new Error("الرابط لا يحتوي معرّف حلقة صالح (vid=...)");
  }
  const cookie = await resolveSiteCookie();
  const url = watchUrl(vid);
  const { html } = await siteFetch(url, { cookie, referer: `${SITE_ORIGIN}/` });
  const page = scrapeWatchPage(html, vid);

  if (!page.title) {
    throw new Error("تعذّر قراءة بيانات الصفحة — قد يكون الرابط محذوفًا");
  }

  const warnings: string[] = [];
  const slug = page.seriesSlug ?? slugify(page.seriesTitle ?? page.title);
  const seriesTitle = page.seriesTitle ?? page.title.replace(/\s*الحلقة.*$/, "").trim();
  const genres = [page.category, page.meta.genres].filter(
    (v): v is string => Boolean(v),
  );

  const seriesId = await upsertSeries({
    title: seriesTitle || page.title,
    originalTitle: page.originalTitle,
    slug,
    sourceUrl: page.seriesSlug ? seriesUrl(page.seriesSlug) : url,
    posterUrl: page.posterUrl,
    synopsis: page.synopsis,
    genres,
    year: page.meta.years ?? null,
    language: page.meta.languages ?? null,
    quality: page.meta.resolution ?? page.meta.quality ?? null,
  });

  // Discover every season referenced from the watch page.
  const discovered = page.seasons.length
    ? page.seasons
    : [{ number: page.seasonNumber, title: `الموسم ${page.seasonNumber}`, url: "", episodeCount: 0, active: true }];

  for (const s of discovered) {
    await upsertSeason(seriesId, s.number, {
      title: normalizeSeasonTitle(s.title ?? "", s.number),
      sourceUrl:
        s.url || (page.seriesSlug ? seasonUrl(page.seriesSlug, s.number) : null),
      episodeCount: s.episodeCount,
    });
  }

  const seasonNumber = page.seasonNumber || discovered[0].number || 1;
  const seasonId = await upsertSeason(seriesId, seasonNumber, {
    sourceUrl: page.seriesSlug ? seasonUrl(page.seriesSlug, seasonNumber) : null,
  });

  // The season page is the authoritative episode list: the watch page mixes in
  // unrelated recommendation rails (movies, other series).
  let refs: ScrapedEpisodeRef[] = [];
  let seasonPageTitle: string | null = null;

  if (page.seriesSlug) {
    try {
      const seasonPage = await siteFetch(
        seasonUrl(page.seriesSlug, seasonNumber),
        { cookie,
          referer: url },
      );
      const parsed = scrapeSeasonPage(seasonPage.html);
      refs = parsed.episodes.filter((e) => e.number > 0);
      seasonPageTitle = parsed.title || null;
    } catch (err) {
      warnings.push(
        `تعذّر جلب صفحة الموسم: ${err instanceof Error ? err.message : "خطأ غير معروف"}`,
      );
    }
  }

  if (refs.length === 0) {
    refs = page.episodes.filter((e) => e.number > 0);
    // Drop recommendation-rail entries (movies / other series) when the page
    // clearly carries a numbered episode rail.
    const numbered = refs.filter((e) => /الحلقة/.test(e.title));
    if (numbered.length > 0 && numbered.length < refs.length) {
      refs = numbered;
      warnings.push("تُجاهلت عناصر مقترحة ليست حلقات لهذا الموسم");
    }
  }

  if (refs.length === 0) {
    refs = [
      {
        number: 1,
        title: page.title,
        watchUrl: url,
        videoUniq: page.videoUniq,
        posterUrl: page.posterUrl,
      },
    ];
    warnings.push("لم تُرصد قائمة حلقات، أُضيفت الحلقة الحالية فقط");
  }

  const { added, existing } = await upsertEpisodes(seasonId, refs);

  await db
    .update(seasons)
    .set({
      imported: true,
      episodeCount: Math.max(refs.length, added + existing),
      ...(seasonPageTitle
        ? { title: normalizeSeasonTitle(seasonPageTitle, seasonNumber) }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(seasons.id, seasonId));

  await logEvent(
    "success",
    "import",
    `استيراد «${seriesTitle}» — الموسم ${seasonNumber}: ${added} حلقة جديدة`,
    { meta: { seriesId, seasonId, added, existing } },
  );

  if (warnings.length) {
    await logEvent("warn", "import", warnings.join(" • "), { meta: { seriesId } });
  }

  return {
    seriesId,
    seasonId,
    seasonNumber,
    seriesTitle,
    episodesAdded: added,
    episodesExisting: existing,
    seasonsDiscovered: discovered.length,
    seasonTitle: seasonPageTitle
      ? normalizeSeasonTitle(seasonPageTitle, seasonNumber)
      : `الموسم ${seasonNumber}`,
    posterUrl: page.posterUrl,
    warnings,
  };
}

/** Crawl a season page directly (used by "refresh season"). */
export async function refreshSeason(seasonId: number) {
  const [season] = await db
    .select()
    .from(seasons)
    .where(eq(seasons.id, seasonId))
    .limit(1);
  if (!season) throw new Error("الموسم غير موجود");
  if (!season.sourceUrl) throw new Error("لا يوجد رابط مصدر لهذا الموسم");

  const cookie = await resolveSiteCookie();
  const { html } = await siteFetch(season.sourceUrl, {
    cookie,
    referer: `${SITE_ORIGIN}/`,
  });
  const page = scrapeSeasonPage(html);
  if (page.episodes.length === 0) {
    throw new Error("لم تُعثر على حلقات في صفحة الموسم");
  }
  const { added, existing } = await upsertEpisodes(seasonId, page.episodes);
  await db
    .update(seasons)
    .set({
      imported: true,
      title: page.title || season.title,
      episodeCount: Math.max(page.episodeCount, page.episodes.length),
      updatedAt: new Date(),
    })
    .where(eq(seasons.id, seasonId));
  await logEvent("success", "import", `تحديث الموسم ${season.number}: +${added} حلقة`, {
    meta: { seasonId, added, existing },
  });
  return { added, existing, total: page.episodes.length };
}

/** Import every season of a series page. */
export async function importSeriesAllSeasons(seriesId: number) {
  const [row] = await db.select().from(series).where(eq(series.id, seriesId)).limit(1);
  if (!row?.sourceUrl) throw new Error("لا يوجد رابط مصدر للسلسلة");
  const cookie = await resolveSiteCookie();
  const { html } = await siteFetch(row.sourceUrl, {
    cookie,
    referer: `${SITE_ORIGIN}/`,
  });
  const seasonRefs = scrapeWatchPage(html, "").seasons;
  const results: { season: number; added: number; existing: number }[] = [];

  for (const ref of seasonRefs) {
    const url =
      ref.url || (row.slug ? seasonUrl(row.slug, ref.number) : "");
    if (!url) continue;
    const sid = await upsertSeason(seriesId, ref.number, {
      title: ref.title,
      sourceUrl: url,
      episodeCount: ref.episodeCount,
    });
    try {
      const { html: seasonHtml } = await siteFetch(url, {
        cookie,
        referer: row.sourceUrl,
      });
      const page = scrapeSeasonPage(seasonHtml);
      const { added, existing } = await upsertEpisodes(sid, page.episodes);
      await db
        .update(seasons)
        .set({
          imported: true,
          episodeCount: Math.max(page.episodeCount, page.episodes.length),
          updatedAt: new Date(),
        })
        .where(eq(seasons.id, sid));
      results.push({ season: ref.number, added, existing });
    } catch (err) {
      await logEvent(
        "warn",
        "import",
        `تعذّر استيراد الموسم ${ref.number}: ${err instanceof Error ? err.message : "خطأ"}`,
        { meta: { seriesId, season: ref.number } },
      );
    }
  }

  if (results.length === 0) throw new Error("لم تُكتشف مواسم في صفحة السلسلة");
  return results;
}

function sourceScore(s: EpisodeSource): number {
  let score = 0;
  const heightMatch =
    s.quality?.match(/(\d{3,4})/) ?? s.label.match(/(\d{3,4})\s*p/);
  const height = heightMatch ? Number.parseInt(heightMatch[1], 10) : 0;
  score += height;
  if (s.kind === "direct") score += 100_000;
  if (s.type === "mp4") score += 4000;
  if (s.type === "hls") score += 2000;
  if (s.sourceType === "download") score += 800;
  if (s.kind === "landing") score -= 50_000;
  return score;
}

function rankSources(sources: EpisodeSource[]): EpisodeSource[] {
  return [...sources]
    .map((source, index) => ({ source, index, score: sourceScore(source) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((r) => r.source);
}

function typeFromUrl(url: string): EpisodeSource["type"] {
  if (/\.m3u8(?![A-Za-z0-9_-])/i.test(url)) return "hls";
  if (/\.webm(?![A-Za-z0-9_-])/i.test(url)) return "webm";
  if (/\.(mp4|m4v|mov)(?![A-Za-z0-9_-])/i.test(url)) return "mp4";
  return "unknown";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ *
 * Adaptive provider ordering
 *
 * Hosts differ wildly in usefulness: some serve live files, many are purged
 * (HTTP 200 with Content-Length: 0), others sit behind Cloudflare. Probing them
 * in the site's fixed order wasted the whole budget on dead hosts and never
 * reached the players that actually expose a working HLS stream.
 *
 * We learn per-provider hit rates and try the most productive host first, so a
 * 600-episode season resolves in ~1 probe per episode instead of 7.
 * ------------------------------------------------------------------ */

/**
 * Rank a host by reliability *and* measured throughput.
 *
 * Throughput is weighted heavily on purpose: every host that works is equally
 * "correct", but a 2.9 MB/s player stream finishes a 600-episode library in
 * ~11h while a 0.29 MB/s file-host free tier needs ~113h.
 */
function providerScore(provider: string, stats: Record<string, ProviderStat>): number {
  const s = stats[provider];
  if (!s) return 0.5; // unknown host: neutral, worth one try

  const total = s.ok + s.fail;
  const rate = total === 0 ? 0.5 : (s.ok + 0.5) / (total + 1);
  const fresh = s.lastOkAt
    ? Math.max(0, 1 - (Date.now() - new Date(s.lastOkAt).getTime()) / 86_400_000)
    : 0;

  // Neutral (1.0) until we have measured this host at least once.
  const speedWeight = s.avgBps && s.avgBps > 0
    ? Math.min(3, Math.max(0.2, s.avgBps / 1_000_000))
    : 1;

  return rate * speedWeight + fresh * 0.1;
}

function orderProviders(
  refs: PlaybackSourceRef[],
  stats: Record<string, ProviderStat>,
): PlaybackSourceRef[] {
  return [...refs].sort((a, b) => {
    const d = providerScore(b.provider, stats) - providerScore(a.provider, stats);
    if (Math.abs(d) > 1e-6) return d;
    // Tie-break: a single-file MP4 beats a segmented stream on equal footing.
    const typeRank = (t: string) => (t === "download" ? 0 : 1);
    return typeRank(a.type) - typeRank(b.type);
  });
}

/**
 * Resolve every playable/downloadable source of one episode using the site's
 * real playback contract (see lib/site/playback.ts), then follow each
 * single-use launch grant to the provider and try to lift a direct media URL.
 */
export async function resolveEpisode(
  episodeId: number,
): Promise<{
  ok: boolean;
  message: string;
  sources: EpisodeSource[];
  rateLimited?: boolean;
}> {
  const [ep] = await db
    .select()
    .from(episodes)
    .where(eq(episodes.id, episodeId))
    .limit(1);
  if (!ep) throw new Error("الحلقة غير موجودة");

  const vid = ep.videoUniq ?? extractVid(ep.watchUrl ?? "");
  if (!vid) {
    await db
      .update(episodes)
      .set({
        resolveStatus: "failed",
        resolveError: "لا يوجد معرّف فيديو لهذه الحلقة",
        updatedAt: new Date(),
      })
      .where(eq(episodes.id, episodeId));
    return { ok: false, message: "لا يوجد معرّف فيديو", sources: [] };
  }

  await db
    .update(episodes)
    .set({ resolveStatus: "resolving", resolveError: null, updatedAt: new Date() })
    .where(eq(episodes.id, episodeId));

  const cookie = await resolveSiteCookie();

  // ── 1. open a playback session (retry on rate-limit / expired grant) ──
  let session: PlaybackSession | null = null;
  let sessionError = "";
  for (let attempt = 0; attempt < 3 && !session; attempt++) {
    try {
      session = await openPlaybackSession(vid, { cookie });
    } catch (err) {
      if (err instanceof PlaybackError && err.kind === "rate_limited") {
        sessionError = err.message;
        await sleep(2500 * (attempt + 1));
        continue;
      }
      sessionError = err instanceof Error ? err.message : "خطأ غير معروف";
      if (err instanceof PlaybackError && err.kind === "gone") continue;
      break;
    }
  }

  if (!session) {
    const needsAuth = /403|forbidden|الجلسة|session/i.test(sessionError);
    const status = needsAuth ? "needs_auth" : "failed";
    await db
      .update(episodes)
      .set({
        resolveStatus: status,
        resolveError: sessionError || "تعذّر إنشاء جلسة تشغيل",
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(episodes.id, episodeId));
    await logEvent(needsAuth ? "warn" : "error", "resolve", `${ep.title}: ${sessionError}`, {
      episodeId,
    });
    return { ok: false, message: sessionError, sources: [] };
  }

  // ── 2. walk the provider list, most productive host first ──
  const stats = await getProviderStats();
  const ordered = orderProviders(session.sources, stats);

  const collected: EpisodeSource[] = [];
  const notes: string[] = [];
  let probes = 0;
  let directFound = false;
  let rateLimited = false;

  for (const ref of ordered) {
    if (directFound) break;
    probes += 1;

    const base = {
      provider: ref.provider,
      sourceId: ref.id,
      sourceType: ref.type,
      quality: ref.quality,
      server: ref.provider,
      label: [ref.provider, ref.quality ? `${ref.quality}p` : ref.label ?? ""]
        .filter(Boolean)
        .join(" · "),
    };

    try {
      const { launchUrl } = await resolveSourceLaunch(session, ref.id);
      const landingUrl = await followLaunch(session, launchUrl);

      const report = await extractDirectFromLanding(landingUrl);
      if (report.direct) {
        collected.push({
          ...base,
          label: `${base.label} (رابط مباشر)`.trim(),
          url: report.direct.url,
          type: report.direct.kind === "mkv" ? "unknown" : report.direct.kind,
          kind: "direct",
          via: report.direct.via,
          gate: "none",
          note: report.note,
        });
        directFound = true;
        await recordProviderOutcome(ref.provider, true);
      } else {
        collected.push({
          ...base,
          url: landingUrl,
          type: typeFromUrl(landingUrl),
          kind: "landing",
          via: `provider-page:${report.gate}`,
          gate: report.gate,
          note: report.note,
        });
        notes.push(`${ref.provider}: ${report.note}`);
        await recordProviderOutcome(ref.provider, false);
      }
    } catch (err) {
      if (err instanceof PlaybackError && err.kind === "rate_limited") {
        rateLimited = true;
        notes.push(`${ref.provider}: ${err.message}`);
        // Honour the global cooldown instead of hammering on.
        await sleep(playbackPausedMs() + 400);
        break;
      }
      notes.push(
        `${ref.provider}: ${err instanceof Error ? err.message : "تعذّر الاستخراج"}`,
      );
      // Don't punish a host for our own rate limiting or a dead grant.
      if (!(err instanceof PlaybackError && err.kind === "rate_limited")) {
        await recordProviderOutcome(ref.provider, false);
      }
    }
  }

  // ── 3. last-resort: media embedded in the watch page itself ──
  if (collected.length === 0) {
    try {
      const { html } = await siteFetch(watchUrl(vid), { cookie });
      for (const m of scrapeDirectMedia(html)) {
        collected.push({ ...m, kind: "direct", via: "watch-page" });
      }
    } catch {
      /* ignore */
    }
  }

  if (collected.length === 0) {
    const message =
      notes.join(" • ") || "لم يُعثر على أي مصدر قابل للتشغيل لهذه الحلقة";
    // A 429 is transient: leaving the row as "failed" would permanently poison
    // a whole season during bulk resolution. Park it as retryable instead.
    const status = rateLimited ? "idle" : "failed";
    await db
      .update(episodes)
      .set({
        resolveStatus: status,
        resolveError: rateLimited
          ? "توقّف مؤقت: الموقع حدّ من الطلبات (429) — أعد المحاولة بعد قليل"
          : message,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(episodes.id, episodeId));
    await logEvent(rateLimited ? "warn" : "error", "resolve", `${ep.title}: ${message}`, {
      episodeId,
      meta: { rateLimited },
    });
    return { ok: false, message, sources: [], rateLimited };
  }

  const ranked = rankSources(collected);
  const directCount = ranked.filter((s) => s.kind === "direct").length;
  const hasDirect = directCount > 0;
  const message = hasDirect
    ? `تم استخراج ${directCount} رابط مباشر من ${session.sources.length} مصدرًا متاحًا`
    : `فُكّت حماية ${ranked.length} مزوّد وصفحاتهم جاهزة، لكن الرابط المباشر يُكشف داخل المتصفح (جدار إعلانات/JS مشوّش)`;

  await db
    .update(episodes)
    .set({
      // "partial" is a success state for the user: the protected session was
      // cracked and real provider pages are available, the host just gates the
      // final link behind client-side JS.
      resolveStatus: hasDirect ? "ready" : "partial",
      resolveError: null,
      sources: ranked,
      selectedSourceIndex: 0,
      resolvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(episodes.id, episodeId));

  await logEvent(hasDirect ? "success" : "warn", "resolve", `${ep.title}: ${message}`, {
    episodeId,
    meta: { providers: ranked.map((r) => r.provider), notes: notes.slice(0, 6) },
  });

  return { ok: hasDirect, message, sources: ranked };
}

/**
 * Resolve a batch sequentially (never in parallel: the host rate-limits).
 *
 * Stops early after repeated 429s so a bulk run cannot mark a whole season as
 * failed — the untouched rows stay `idle` and can be retried later.
 */
export async function resolveMany(episodeIds: number[]) {
  const ids = episodeIds.slice(0, 500);
  let ok = 0;
  let failed = 0;
  let rateLimited = 0;
  let consecutiveLimits = 0;
  let stopped = false;

  for (const id of ids) {
    if (consecutiveLimits >= 3) {
      stopped = true;
      break;
    }
    try {
      const res = await resolveEpisode(id);
      if (res.ok) {
        ok += 1;
        consecutiveLimits = 0;
      } else {
        failed += 1;
        if (res.rateLimited) {
          rateLimited += 1;
          consecutiveLimits += 1;
          // Extra breathing room between episodes during a throttle wave.
          await sleep(Math.max(1500, playbackPausedMs()));
        } else {
          consecutiveLimits = 0;
        }
      }
    } catch {
      failed += 1;
      consecutiveLimits = 0;
    }
    await sleep(350);
  }

  const remaining = stopped ? ids.length - (ok + failed) : 0;
  if (stopped) {
    await logEvent(
      "warn",
      "resolve",
      `أُوقفت الدفعة بسبب الحدّ المؤقت (429) — بقيت ${remaining} حلقة دون معالجة، أعد المحاولة لاحقًا`,
      { meta: { ok, failed, remaining } },
    );
  }
  return { ok, failed, rateLimited, remaining, stopped, total: ids.length };
}

export async function markManualSource(
  episodeId: number,
  url: string,
  label = "مصدر يدوي",
) {
  const type: EpisodeSource["type"] = /\.m3u8(\?|$)/i.test(url)
    ? "hls"
    : /\.webm(\?|$)/i.test(url)
      ? "webm"
      : /\.mp4(\?|$)/i.test(url)
        ? "mp4"
        : "unknown";
  const source: EpisodeSource = { label, url, type, server: "يدوي" };
  const [ep] = await db
    .select({ sources: episodes.sources })
    .from(episodes)
    .where(eq(episodes.id, episodeId))
    .limit(1);
  const existing = (ep?.sources ?? []) as EpisodeSource[];
  const next = [source, ...existing.filter((s) => s.url !== url)];
  await db
    .update(episodes)
    .set({
      sources: next,
      selectedSourceIndex: 0,
      resolveStatus: "ready",
      resolveError: null,
      resolvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(episodes.id, episodeId));
  await logEvent("success", "resolve", "أُضيف مصدر فيديو يدوي", { episodeId });
  return next;
}

export async function libraryStats() {
  const [row] = await db
    .select({
      seriesCount: sql<number>`count(distinct ${series.id})`,
    })
    .from(series);
  const [seasonRow] = await db
    .select({ count: sql<number>`count(*)::int` }).from(seasons);
  const perStatus = await db
    .select({
      status: episodes.downloadStatus,
      count: sql<number>`count(*)::int`,
    })
    .from(episodes)
    .groupBy(episodes.downloadStatus);
  const resolveStatus = await db
    .select({ status: episodes.resolveStatus, count: sql<number>`count(*)::int` })
    .from(episodes)
    .groupBy(episodes.resolveStatus);
  const [totals] = await db
    .select({
      episodes: sql<number>`count(*)::int`,
      bytes: sql<string>`coalesce(sum(cast(${episodes.fileSize} as bigint)), 0)::text`,
    })
    .from(episodes);

  return {
    seriesCount: Number(row?.seriesCount ?? 0),
    seasonCount: Number(seasonRow?.count ?? 0),
    episodeCount: Number(totals?.episodes ?? 0),
    totalBytes: totals?.bytes ?? "0",
    downloadByStatus: Object.fromEntries(
      perStatus.map((r) => [r.status, Number(r.count)]),
    ) as Record<string, number>,
    resolveByStatus: Object.fromEntries(
      resolveStatus.map((r) => [r.status, Number(r.count)]),
    ) as Record<string, number>,
  };
}
