import * as cheerio from "cheerio";

export const SITE_ORIGIN = "https://animezid.org";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export interface FetchOptions {
  cookie?: string;
  referer?: string;
  timeoutMs?: number;
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
}

export class SiteError extends Error {
  status: number;
  detail?: string;
  constructor(message: string, status = 502, detail?: string) {
    super(message);
    this.name = "SiteError";
    this.status = status;
    this.detail = detail;
  }
}

/** Minimal cookie jar: merges Set-Cookie headers into a single header value. */
export class CookieJar {
  private store = new Map<string, string>();

  seed(raw?: string | null) {
    if (!raw) return this;
    for (const part of raw.split(/;\s*/)) {
      const idx = part.indexOf("=");
      if (idx <= 0) continue;
      this.store.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim());
    }
    return this;
  }

  absorb(headers: Headers) {
    const collected =
      typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : [headers.get("set-cookie")].filter(Boolean) as string[];
    for (const cookie of collected) {
      const first = cookie.split(";")[0];
      const idx = first.indexOf("=");
      if (idx <= 0) continue;
      const name = first.slice(0, idx).trim();
      const value = first.slice(idx + 1).trim();
      if (value === "" || value === "deleted") this.store.delete(name);
      else this.store.set(name, value);
    }
    return this;
  }

  header(): string {
    return [...this.store.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  has(name: string) {
    return this.store.has(name);
  }
}

export async function siteFetch(
  url: string,
  opts: FetchOptions = {},
): Promise<{ html: string; jar: CookieJar; status: number; finalUrl: string }> {
  const jar = new CookieJar().seed(opts.cookie);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? 25_000,
  );
  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": UA,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.8,en;q=0.6",
        ...(opts.cookie ? { Cookie: jar.header() } : {}),
        ...(opts.referer ? { Referer: opts.referer } : {}),
        ...(opts.headers ?? {}),
      },
      body: opts.body,
    });
    jar.absorb(res.headers);
    const html = await res.text();
    return { html, jar, status: res.status, finalUrl: res.url };
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? "انتهت مهلة الاتصال بالموقع"
        : err instanceof Error
          ? err.message
          : "تعذّر الاتصال بالموقع";
    throw new SiteError(message, 504);
  } finally {
    clearTimeout(timer);
  }
}

export function extractVid(input: string): string | null {
  const m = input.match(/[?&]vid=([A-Za-z0-9]+)/);
  if (m) return m[1];
  const bare = input.trim().match(/^[A-Za-z0-9]{6,24}$/);
  return bare ? bare[0] : null;
}

export function watchUrl(vid: string) {
  return `${SITE_ORIGIN}/watch.php?vid=${vid}`;
}

export function seriesUrl(slug: string) {
  return `${SITE_ORIGIN}/series/${slug}/`;
}

export function seasonUrl(slug: string, season: number) {
  return `${SITE_ORIGIN}/series/${slug}/season/${season}/`;
}

export interface ScrapedSeasonRef {
  number: number;
  title: string;
  url: string;
  episodeCount: number;
  active: boolean;
}

export interface ScrapedEpisodeRef {
  number: number;
  title: string;
  watchUrl: string;
  videoUniq: string;
  posterUrl: string | null;
}

export interface ScrapedWatchPage {
  videoUniq: string;
  videoId: string | null;
  title: string;
  posterUrl: string | null;
  synopsis: string | null;
  seriesSlug: string | null;
  seriesTitle: string | null;
  originalTitle: string | null;
  category: string | null;
  seasonNumber: number;
  seasons: ScrapedSeasonRef[];
  episodes: ScrapedEpisodeRef[];
  meta: Record<string, string>;
  playback: {
    createUrl: string | null;
    csrf: string | null;
    protected: boolean;
  } | null;
}

function absoluteUrl(href: string | undefined): string | null {
  if (!href) return null;
  if (href.startsWith("//")) return `https:${href}`;
  if (href.startsWith("/")) return `${SITE_ORIGIN}${href}`;
  if (href.startsWith("http")) return href;
  return null;
}

function cleanText(value?: string | null) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function episodeNumberFromText(text: string, fallback: number) {
  const m = text.match(/الحلقة\s*([0-9٠-٩]+)/) ?? text.match(/Episode\s*(\d+)/i);
  if (!m) return fallback;
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  const normalized = m[1].replace(/[٠-٩]/g, (d) =>
    String(arabicDigits.indexOf(d)),
  );
  const n = Number.parseInt(normalized, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Pull every episode card out of a season / watch page.
 *
 * Two passes on purpose: anchors carrying an explicit aria-label/title are the
 * real episode cards, while "start season" CTAs and recommendation rails reuse
 * the same watch.php href with no accessible name. Preferring labelled anchors
 * keeps episode #1 from being hijacked by a button.
 */
export function scrapeEpisodeRefs($: cheerio.CheerioAPI): ScrapedEpisodeRef[] {
  const seen = new Set<string>();
  const out: ScrapedEpisodeRef[] = [];
  let order = 0;

  const collect = (requireLabel: boolean) => {
    $("a[href*='watch.php?vid=']").each((_, el) => {
      const $el = $(el);
      const href = $el.attr("href") ?? "";
      const vid = extractVid(href);
      if (!vid || seen.has(vid)) return;
      const classes = `${$el.attr("class") ?? ""} ${$el.parent().attr("class") ?? ""}`;
      if (/series-start|start-btn|az-cta|btn-start/i.test(classes)) return;

      const explicit =
        cleanText($el.attr("aria-label")) ||
        cleanText($el.attr("title")) ||
        cleanText($el.find("img").attr("alt"));
      if (requireLabel && !explicit) return;

      const label = explicit || cleanText($el.text());
      if (!label || /^(ابدأ|شاهد الآن|التالي|السابق)/.test(label)) return;

      const card = $el.closest("li,article,div").first();
      const img =
        $el.find("img").first().attr("src") ?? card.find("img").first().attr("src");

      order += 1;
      seen.add(vid);
      out.push({
        number: episodeNumberFromText(label, order),
        title: label.replace(/^مشاهدة\s*/, "").replace(/\s+/g, " ").trim() || label,
        watchUrl: absoluteUrl(href) ?? watchUrl(vid),
        videoUniq: vid,
        posterUrl: absoluteUrl(img ?? undefined),
      });
    });
  };

  collect(true);
  collect(false);

  return out.sort((a, b) => a.number - b.number);
}

/** Season nav items glue the episode count into their text — normalise it. */
export function normalizeSeasonTitle(raw: string, num: number): string {
  const cleaned = raw
    .replace(/\d+\s*حلقة/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return `الموسم ${num}`;
  if (/^الموسم\s*\d*$/.test(cleaned)) return `الموسم ${num}`;
  return cleaned;
}

export function scrapeSeasonRefs($: cheerio.CheerioAPI): ScrapedSeasonRef[] {
  const found = new Map<number, ScrapedSeasonRef>();

  $("a[href*='/season/']").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href") ?? "";
    const m = href.match(/\/season\/(\d+)/);
    if (!m) return;
    const number = Number.parseInt(m[1], 10);
    if (!Number.isFinite(number)) return;
    const countAttr =
      $el.attr("data-season-count") ??
      $el.closest("[data-season-count]").attr("data-season-count");
    found.set(number, {
      number,
      title: normalizeSeasonTitle(
        cleanText($el.attr("aria-label")) || cleanText($el.text()),
        number,
      ),
      url: absoluteUrl(href) ?? seasonUrl("", number),
      episodeCount: countAttr ? Number.parseInt(countAttr, 10) || 0 : 0,
      active:
        $el.attr("aria-current") === "page" ||
        $el.attr("data-active") === "1" ||
        $el.hasClass("active") ||
        $el.hasClass("is-active"),
    });
  });

  $("[data-season]").each((_, el) => {
    const $el = $(el);
    const raw = $el.attr("data-season");
    if (!raw) return;
    const number = Number.parseInt(raw, 10);
    if (!Number.isFinite(number)) return;
    const countRaw = $el.attr("data-season-count");
    const existing = found.get(number);
    const label = normalizeSeasonTitle(
      cleanText($el.attr("aria-label")) ||
        cleanText($el.find("a").first().text()) ||
        cleanText($el.text()),
      number,
    );
    found.set(number, {
      number,
      title: existing?.title && existing.title !== "" ? existing.title : label,
      url:
        existing?.url ??
        absoluteUrl($el.attr("href") ?? $el.find("a").first().attr("href")) ??
        "",
      episodeCount:
        existing?.episodeCount || (countRaw ? Number.parseInt(countRaw, 10) || 0 : 0),
      active:
        existing?.active ||
        $el.attr("aria-current") === "page" ||
        $el.attr("data-active") === "1" ||
        $el.hasClass("active"),
    });
  });

  return [...found.values()]
    .filter((s) => Number.isFinite(s.number))
    .sort((a, b) => a.number - b.number);
}

function readMetaPairs($: cheerio.CheerioAPI): Record<string, string> {
  const meta: Record<string, string> = {};
  $("a[href*='videos.php?filter=']").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href") ?? "";
    const m = href.match(/filter=([a-z]+)&v=([^&"]+)/i);
    if (!m) return;
    try {
      meta[m[1]] = decodeURIComponent(m[2].replace(/\+/g, " "));
    } catch {
      meta[m[1]] = m[2];
    }
  });
  return meta;
}

export function scrapeWatchPage(html: string, vid: string): ScrapedWatchPage {
  const $ = cheerio.load(html);

  const player = $("[data-playback-page], [data-video-uniq]").first();
  const title =
    cleanText($("h1").first().text()) ||
    cleanText($("title").text()).replace(/\s*[|–-]\s*أنمي زد.*$/, "");

  let seriesSlug: string | null = null;
  let seriesTitle: string | null = null;
  $("a[href*='/series/']").each((_, el) => {
    if (seriesSlug) return;
    const href = $(el).attr("href") ?? "";
    const m = href.match(/\/series\/([^/?#]+)\/?(?:$|[?#])/);
    if (!m || /\/season\//.test(href)) return;
    seriesSlug = decodeURIComponent(m[1]);
    seriesTitle = cleanText($(el).text());
  });

  let category: string | null = null;
  $("a[href*='category.php?cat=']").each((_, el) => {
    if (category) return;
    const href = $(el).attr("href") ?? "";
    const m = href.match(/cat=([a-z0-9-]+)/i);
    if (m) category = cleanText($(el).text()) || m[1];
  });

  const seasons = scrapeSeasonRefs($);
  const activeSeason = seasons.find((s) => s.active);
  const seasonAttr =
    player.attr("data-season") ?? $("[data-season]").first().attr("data-season");
  const parsedSeasonAttr = seasonAttr ? Number.parseInt(seasonAttr, 10) : NaN;
  const seasonNumber =
    activeSeason?.number ??
    (Number.isFinite(parsedSeasonAttr) && parsedSeasonAttr > 0
      ? parsedSeasonAttr
      : seasons.length === 1
        ? seasons[0].number
        : 1);

  const keywords = cleanText($("meta[name='keywords']").attr("content") ?? "");
  const originalMatch = keywords.match(
    /\|\s*([A-Za-z0-9 ,':!?\-&]+?)\s*(?:مدبلج|مترجم|كامل|$)/,
  );
  const originalTitle = originalMatch ? originalMatch[1].trim() : null;

  return {
    videoUniq: cleanText(player.attr("data-video-uniq")) || vid,
    videoId: cleanText($("[data-video-id]").first().attr("data-video-id")) || null,
    title,
    posterUrl: absoluteUrl(
      $("img[src*='uploads/thumbs/video-thumb-']").first().attr("src") ??
        $("meta[property='og:image']").attr("content"),
    ),
    synopsis:
      cleanText($("meta[name='description']").attr("content")) || null,
    seriesSlug,
    seriesTitle: seriesTitle || null,
    originalTitle: originalTitle ? originalTitle.trim() : null,
    category,
    seasonNumber: Number.isFinite(seasonNumber) ? seasonNumber : 1,
    seasons,
    episodes: scrapeEpisodeRefs($),
    meta: readMetaPairs($),
    playback: {
      createUrl: cleanText(player.attr("data-playback-create-url")) || null,
      csrf: cleanText(player.attr("data-playback-csrf")) || null,
      protected: player.attr("data-playback-protected") === "1",
    },
  };
}

export interface ScrapedSeasonPage {
  title: string;
  seriesTitle: string | null;
  synopsis: string | null;
  posterUrl: string | null;
  episodeCount: number;
  episodes: ScrapedEpisodeRef[];
}

export function scrapeSeasonPage(html: string): ScrapedSeasonPage {
  const $ = cheerio.load(html);
  const episodes = scrapeEpisodeRefs($);

  let seriesTitle: string | null = null;
  $("a[href*='/series/']").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (/\/season\//.test(href)) return;
    const text = cleanText($(el).text());
    if (text && !seriesTitle) seriesTitle = text;
  });

  const declared = Number.parseInt(
    cleanText($(".az-series-detail-hero__stats strong bdi").first().text()) ||
      "0",
    10,
  );

  return {
    title: cleanText($("h1").first().text()) || cleanText($("title").text()),
    seriesTitle,
    synopsis: cleanText($("meta[name='description']").attr("content")) || null,
    posterUrl: absoluteUrl(
      $("img[src*='uploads/thumbs/']").first().attr("src") ??
        $("meta[property='og:image']").attr("content"),
    ),
    episodeCount: Number.isFinite(declared) && declared > 0 ? declared : episodes.length,
    episodes,
  };
}

export interface LoginResult {
  ok: boolean;
  cookie: string;
  message: string;
  username?: string;
}

/** Authenticate against the site so protected playback sessions can be created. */
export async function siteLogin(
  username: string,
  password: string,
): Promise<LoginResult> {
  const warm = await siteFetch(`${SITE_ORIGIN}/login.php`);
  const form = cheerio.load(warm.html);
  const action =
    form("form.az-auth-form").attr("action") ?? `${SITE_ORIGIN}/login.php`;

  const jar = warm.jar;
  const csrf =
    form("form.az-auth-form input[name='csrf_token'], form.az-auth-form input[name='_token']")
      .first()
      .attr("value") ?? "";

  const params = new URLSearchParams();
  params.set("username", username);
  params.set("pass", password);
  if (csrf) params.set("csrf_token", csrf);

  const res = await siteFetch(absoluteUrl(action) ?? action, {
    method: "POST",
    cookie: jar.header(),
    referer: `${SITE_ORIGIN}/login.php`,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: params.toString(),
  });

  const cookie = res.jar.header();
  const snippet = res.html.slice(0, 4000);
  const loggedIn =
    /logout\.php|تسجيل الخروج|az-user|account\.php/i.test(res.html) ||
    /"success"\s*:\s*true/.test(snippet);
  const failed =
    /اسم المستخدم|كلمة المرور|خطأ|incorrect|invalid|"error"/i.test(snippet) &&
    !loggedIn;

  if (res.status >= 400) {
    return {
      ok: false,
      cookie,
      message: `رفض الموقع طلب الدخول (HTTP ${res.status})`,
    };
  }
  if (loggedIn && !failed) {
    return { ok: true, cookie, message: "تم تسجيل الدخول بنجاح", username };
  }
  return {
    ok: false,
    cookie,
    message:
      "لم يقبل الموقع بيانات الدخول. تحقّق من اسم المستخدم وكلمة المرور، أو الصق كعكة الجلسة يدويًا.",
  };
}

export interface ResolvedSource {
  label: string;
  url: string;
  type: "mp4" | "hls" | "webm" | "unknown";
  quality?: string;
  server?: string;
}

function classify(url: string): ResolvedSource["type"] {
  if (/\.m3u8(\?|$)/i.test(url)) return "hls";
  if (/\.mp4(\?|$)/i.test(url)) return "mp4";
  if (/\.webm(\?|$)/i.test(url)) return "webm";
  return "unknown";
}

export function scrapeDirectMedia(html: string): ResolvedSource[] {
  const urls = new Set<string>();
  const patterns = [
    /https?:\/\/[^\s"'<>\\]+?\.m3u8(?:\?[^\s"'<>\\]*)?/gi,
    /https?:\/\/[^\s"'<>\\]+?\.mp4(?:\?[^\s"'<>\\]*)?/gi,
    /https?:\/\/[^\s"'<>\\]+?\.webm(?:\?[^\s"'<>\\]*)?/gi,
  ];
  for (const re of patterns) {
    for (const m of html.matchAll(re)) urls.add(m[0]);
  }
  const $ = cheerio.load(html);
  $("video source[src], video[src], iframe[src], a[download]").each((_, el) => {
    const href = $(el).attr("src") ?? $(el).attr("href");
    const abs = absoluteUrl(href ?? undefined);
    if (abs && /\.(m3u8|mp4|webm)(\?|$)/i.test(abs)) urls.add(abs);
  });
  return [...urls].map((url, i) => ({
    label: `مصدر مباشر ${i + 1}`,
    url,
    type: classify(url),
  }));
}
