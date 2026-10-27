import * as cheerio from "cheerio";
import { humanBytes } from "@/lib/format";
import { CookieJar, SITE_ORIGIN, siteFetch } from "@/lib/site/animezid";

/**
 * Faithful re-implementation of the site's own playback client
 * (templates/az-modern/assets/js/visitor.js → `postPlayback`).
 *
 * The contract that actually works:
 *   POST {createUrl}                                      body {"content_id": <vid>}
 *   POST {createUrl}/{sid}/sources/{sourceId}/resolve      body {}
 *   header  X-Playback-CSRF: <data-playback-csrf>          ← header, NOT a body field
 *   header  Content-Type: application/json
 *   cookies harvested from the play.php visit              ← credentials: same-origin
 *   NO X-Requested-With and NO Referer (referrerPolicy: no-referrer)
 *
 * Any deviation returns {"error":"forbidden"}, which looks exactly like
 * "you must log in" — but it is not: an anonymous browser session is enough.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export type PlaybackSourceType = "embedded_web" | "download" | string;

export interface PlaybackSourceRef {
  id: string;
  provider: string;
  type: PlaybackSourceType;
  quality?: string;
  label?: string;
}

export interface PlaybackSession {
  sessionId: string;
  csrf: string;
  createUrl: string;
  cookie: string;
  expiresAt: string | null;
  sources: PlaybackSourceRef[];
}

export class PlaybackError extends Error {
  status: number;
  kind: "forbidden" | "rate_limited" | "gone" | "invalid" | "network" | "unknown";
  constructor(kind: PlaybackError["kind"], message: string, status = 0) {
    super(message);
    this.name = "PlaybackError";
    this.kind = kind;
    this.status = status;
  }
}

function playbackHeaders(csrf: string): Record<string, string> {
  return {
    "User-Agent": UA,
    "Content-Type": "application/json",
    Accept: "*/*",
    "X-Playback-CSRF": csrf,
    Origin: SITE_ORIGIN,
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    "Accept-Language": "ar,en-US;q=0.8,en;q=0.6",
  };
}

function classifyError(status: number, body: string): PlaybackError {
  if (status === 429) {
    return new PlaybackError(
      "rate_limited",
      "تجاوزنا الحد المؤقت للمحاولات (429) — يجب التمهل قبل إعادة المحاولة",
      status,
    );
  }
  if (status === 403) {
    return new PlaybackError(
      "forbidden",
      `رفض خادم التشغيل التحقق من الجلسة (403)${body ? ` — ${body.slice(0, 160)}` : ""}`,
      status,
    );
  }
  if (status === 404 || status === 410 || /"gone"/.test(body)) {
    return new PlaybackError(
      "gone",
      "انتهت صلاحية منحة التشغيل (أحادية الاستخدام) — أُنشئت جلسة جديدة",
      status,
    );
  }
  return new PlaybackError(
    "unknown",
    `استجابة غير متوقعة من خادم التشغيل (HTTP ${status})`,
    status,
  );
}

/* ------------------------------------------------------------------ *
 * Global throttle
 *
 * The playback API answers 429 when it is hammered. Without a shared
 * rate limit, resolving a 600-episode season poisons every row after the
 * first few. All playback calls funnel through here.
 * ------------------------------------------------------------------ */

const MIN_INTERVAL_MS = 800;
let lastCallAt = 0;
let pausedUntil = 0;
let backoffMs = 8_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttle() {
  const now = Date.now();
  if (pausedUntil > now) await sleep(pausedUntil - now);
  const since = Date.now() - lastCallAt;
  if (since < MIN_INTERVAL_MS) await sleep(MIN_INTERVAL_MS - since);
  lastCallAt = Date.now();
}

/** Called on 429: pause every worker and escalate the cooldown. */
function registerRateLimit() {
  pausedUntil = Date.now() + backoffMs;
  backoffMs = Math.min(60_000, Math.round(backoffMs * 1.8));
}

/** Reset the escalating cooldown after a clean run. */
export function resetPlaybackBackoff() {
  backoffMs = 8_000;
  pausedUntil = 0;
}

export function playbackPausedMs() {
  return Math.max(0, pausedUntil - Date.now());
}

async function postPlayback<T>(
  url: string,
  csrf: string,
  cookie: string,
  body: unknown,
  timeoutMs = 25_000,
): Promise<T> {
  await throttle();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { ...playbackHeaders(csrf), ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body ?? {}),
    });
  } catch (err) {
    throw new PlaybackError(
      "network",
      err instanceof Error && err.name === "AbortError"
        ? "انتهت مهلة الاتصال بخادم التشغيل"
        : `تعذّر الاتصال بخادم التشغيل: ${err instanceof Error ? err.message : "خطأ"}`,
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!res.ok) {
    if (res.status === 429) registerRateLimit();
    else resetPlaybackBackoff();
    throw classifyError(res.status, text);
  }
  resetPlaybackBackoff();

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new PlaybackError("invalid", "استجابة خادم التشغيل ليست JSON صالحًا");
  }
}

interface SessionPayload {
  session_id?: string;
  expires_at?: string;
  sources?: Array<{
    id?: string;
    provider?: string;
    type?: string;
    quality?: string;
    label?: string;
  }>;
}

/** Open the play page (harvesting cookies + CSRF) and create a playback session. */
export async function openPlaybackSession(
  vid: string,
  opts: { cookie?: string } = {},
): Promise<PlaybackSession> {
  const page = await siteFetch(`${SITE_ORIGIN}/play.php?vid=${vid}`, {
    cookie: opts.cookie,
    referer: `${SITE_ORIGIN}/`,
  });
  const $ = cheerio.load(page.html);
  const player = $("[data-playback-page]").first();
  const createUrl =
    (player.attr("data-playback-create-url") ?? "").trim() ||
    `${SITE_ORIGIN}/web-playback/sessions`;
  const csrf = (player.attr("data-playback-csrf") ?? "").trim();
  const contentId = (player.attr("data-video-uniq") ?? "").trim() || vid;

  if (!csrf) {
    throw new PlaybackError(
      "invalid",
      "صفحة التشغيل لا تحمل رمز CSRF — قد تكون الحلقة محذوفة أو تغيّر تصميم الصفحة",
    );
  }

  const payload = await postPlayback<SessionPayload>(createUrl, csrf, page.jar.header(), {
    content_id: contentId,
  });

  if (typeof payload.session_id !== "string" || !Array.isArray(payload.sources)) {
    throw new PlaybackError("invalid", "استجابة جلسة التشغيل غير مكتملة");
  }

  const sources: PlaybackSourceRef[] = payload.sources
    .filter((s) => typeof s.id === "string" && s.id)
    .map((s) => ({
      id: s.id as string,
      provider: s.provider ?? "غير معروف",
      type: s.type ?? "download",
      quality: s.quality,
      label: s.label,
    }));

  return {
    sessionId: payload.session_id,
    csrf,
    createUrl,
    cookie: page.jar.header(),
    expiresAt: payload.expires_at ?? null,
    sources,
  };
}

/** Resolve one source into its single-use launch URL. */
export async function resolveSourceLaunch(
  session: PlaybackSession,
  sourceId: string,
): Promise<{ launchUrl: string; expiresAt: string | null }> {
  const url = `${session.createUrl}/${encodeURIComponent(session.sessionId)}/sources/${encodeURIComponent(sourceId)}/resolve`;
  const payload = await postPlayback<{ launch_url?: string; expires_at?: string }>(
    url,
    session.csrf,
    session.cookie,
    {},
  );
  if (
    typeof payload.launch_url !== "string" ||
    !payload.launch_url.includes("/web-playback/launch/")
  ) {
    throw new PlaybackError("invalid", "لم يُرجع الخادم رابط إطلاق صالحًا");
  }
  return { launchUrl: payload.launch_url, expiresAt: payload.expires_at ?? null };
}

/**
 * Follow the single-use launch grant to the provider landing page.
 * The grant is bound to the session cookie — following it without cookies
 * returns {"error":"gone"} even when the grant is fresh.
 */
export async function followLaunch(
  session: PlaybackSession,
  launchUrl: string,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(launchUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.8,en;q=0.6",
        ...(session.cookie ? { Cookie: session.cookie } : {}),
      },
    });
    const finalUrl = res.url;
    const text = await res.text();
    if (finalUrl.includes("/web-playback/launch/")) {
      throw new PlaybackError(
        "gone",
        `منحة التشغيل لم تُمرَّر إلى المضيف: ${text.slice(0, 140)}`,
      );
    }
    return finalUrl;
  } catch (err) {
    if (err instanceof PlaybackError) throw err;
    throw new PlaybackError(
      "network",
      err instanceof Error && err.name === "AbortError"
        ? "انتهت مهلة تتبع رابط الإطلاق"
        : `تعذّر تتبع رابط الإطلاق: ${err instanceof Error ? err.message : "خطأ"}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * Provider-level direct-link extraction
 * ------------------------------------------------------------------ */

/**
 * The trailing `(?![A-Za-z0-9_-])` guard matters: without it `.webm` also
 * matches inside `site.webmanifest`, which produced bogus "direct links".
 */
const MEDIA_RE =
  /https?:\/\/[^\s"'<>\\]+?\.(?:mp4|m3u8|webm|mkv|m4v)(?![A-Za-z0-9_-])(?:\?[^\s"'<>\\]*)?/gi;

/** Site chrome that must never be mistaken for media. */
const ASSET_RE =
  /(favicon|\/themes?\/|\/assets?\/|\/static\/|\/skins?\/|\/images?\/|\/img\/|\.(?:png|jpe?g|gif|svg|ico|css|js|webmanifest|woff2?)(?:\?|$))/i;

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

function toBase(n: number, a: number) {
  let s = "";
  let v = n;
  do {
    s = ALPHABET[v % a] + s;
    v = Math.floor(v / a);
  } while (v > 0);
  return s;
}

/** Unwrap p.a.c.k.e.r. blobs (hosts hide the jwplayer config this way). */
export function unpacker(html: string): string[] {
  const out: string[] = [];
  const re =
    /eval\(function\(p,a,c,k,e,\w\)\{[\s\S]{0,1200}?\}\('((?:[^'\\]|\\.)*)',(\d+),(\d+),'((?:[^'\\]|\\.)*)'\.split\('\|'\)[^)]*\)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const [, pRaw, aRaw, cRaw, kRaw] = m;
    const a = Number.parseInt(aRaw, 10);
    let c = Number.parseInt(cRaw, 10);
    const k = kRaw.split("|");
    let p: string;
    try {
      p = JSON.parse(`"${pRaw.replace(/"/g, '\\"')}"`);
    } catch {
      p = pRaw;
    }
    try {
      while (c > 0) {
        c -= 1;
        if (k[c]) p = p.replace(new RegExp(`\\b${toBase(c, a)}\\b`, "g"), k[c]);
      }
      out.push(p);
    } catch {
      /* malformed blob — skip */
    }
  }
  return out;
}

export interface DirectExtraction {
  url: string;
  kind: "mp4" | "hls" | "webm" | "mkv";
  via: string;
}

function pickMedia(text: string, via: string): DirectExtraction | null {
  const found = text.match(MEDIA_RE);
  if (!found || found.length === 0) return null;

  const candidates = found
    .map((u) => u.replace(/\\u002F/g, "/").replace(/\\\//g, "/"))
    .filter((u) => !ASSET_RE.test(u));
  if (candidates.length === 0) return null;

  const score = (u: string) =>
    (/\.m3u8/i.test(u) ? 5 : /\.mp4/i.test(u) ? 4 : /\.mkv/i.test(u) ? 2 : 1) +
    (/\?/.test(u) ? 0.5 : 0);
  candidates.sort((a, b) => score(b) - score(a));

  const url = candidates[0];
  const kind: DirectExtraction["kind"] = /\.m3u8/i.test(url)
    ? "hls"
    : /\.webm(?![A-Za-z0-9_-])/i.test(url)
      ? "webm"
      : /\.mkv/i.test(url)
        ? "mkv"
        : "mp4";
  return { url, kind, via };
}

/** og:video / <video> often carry the real media URL on host pages. */
function pickMetaVideo(html: string): DirectExtraction | null {
  const $ = cheerio.load(html);
  const selectors = [
    "meta[property='og:video:secure_url']",
    "meta[property='og:video:url']",
    "meta[property='og:video']",
    "meta[name='twitter:player:stream']",
    "video source[src]",
    "video[src]",
  ];
  for (const sel of selectors) {
    const el = $(sel).first();
    const value = el.attr("content") ?? el.attr("src");
    if (!value || !/^https?:/i.test(value)) continue;
    const pick = pickMedia(value, `meta:${sel}`);
    if (pick) return pick;
  }
  return null;
}

/** XFileSharing hosts (file-upload.org & clones): download1 → download2 → link. */
async function tryXFileSharing(
  landingUrl: string,
  html: string,
  jar: CookieJar,
): Promise<DirectExtraction | null> {
  const $ = cheerio.load(html);
  const form = $("form")
    .filter((_, el) => $(el).find("input[name='op']").length > 0)
    .first();
  if (form.length === 0) return null;

  const fields = new URLSearchParams();
  form.find("input[name]").each((_, el) => {
    const name = $(el).attr("name");
    if (!name) return;
    const type = ($(el).attr("type") ?? "").toLowerCase();
    if (type === "submit" && name !== "method_free" && name !== "method_premium") return;
    fields.set(name, $(el).attr("value") ?? "");
  });
  if (!fields.has("method_free")) fields.set("method_free", "Free Download");

  const action = form.attr("action")?.trim() || landingUrl;
  const target = /^https?:/i.test(action) ? action : new URL(action, landingUrl).toString();

  for (let step = 0; step < 3; step++) {
    let res: Response;
    try {
      res = await fetch(target, {
        method: "POST",
        redirect: "follow",
        headers: {
          "User-Agent": UA,
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: target,
          Accept: "text/html,*/*;q=0.8",
          ...(jar.header() ? { Cookie: jar.header() } : {}),
        },
        body: fields.toString(),
      });
    } catch {
      break;
    }
    jar.absorb(res.headers);
    const text = await res.text();

    const stepName = `xfilesharing:${fields.get("op") ?? "post"}`;
    const direct = pickMedia(text, stepName);
    if (direct) return direct;

    // The final link on XFileSharing hosts is NOT plain HTML: it is emitted as a
    // p.a.c.k.e.r. blob that rebuilds a jwplayer setup, e.g.
    //   jwplayer("flvplayer").setup({file:"https://f12.<host>/d/<hash>/video.mp4"})
    // Unpacking each step response is what actually recovers the URL.
    for (const chunk of unpacker(text)) {
      const packed = pickMedia(chunk, `${stepName}:packed`);
      if (packed) return packed;
      const fileEntry = /file\s*:\s*["']([^"']+)["']/.exec(chunk);
      if (fileEntry && /^https?:/i.test(fileEntry[1])) {
        const pick = pickMedia(fileEntry[1], `${stepName}:jwplayer-file`);
        if (pick) return pick;
      }
    }

    const next = cheerio.load(text);
    const anchor = next("a[href]")
      .filter((_, el) => MEDIA_RE.test(next(el).attr("href") ?? ""))
      .first()
      .attr("href");
    if (anchor) {
      const pick = pickMedia(anchor, "xfilesharing:anchor");
      if (pick) return pick;
    }

    const nextForm = next("form")
      .filter((_, el) => next(el).find("input[name='op']").length > 0)
      .first();
    if (nextForm.length === 0) break;
    const nextOp = nextForm.find("input[name='op']").attr("value") ?? "";
    if (!nextOp || nextOp === fields.get("op")) break;

    nextForm.find("input[name]").each((_, el) => {
      const name = next(el).attr("name");
      if (!name) return;
      const type = (next(el).attr("type") ?? "").toLowerCase();
      if (type === "submit" && name !== "method_free" && name !== "method_premium") return;
      fields.set(name, next(el).attr("value") ?? "");
    });
    fields.set("referer", target);
  }
  return null;
}

export type LandingGate =
  | "none"
  | "cloudflare"
  | "adblock-wall"
  | "dead-file"
  | "obfuscated-js"
  | "form-gate"
  | "login-required"
  | "unreachable"
  | "unknown";

export interface LandingReport {
  direct: DirectExtraction | null;
  /** Machine-readable gate: what stands between us and the file. */
  gate: LandingGate;
  note: string;
}

/**
 * Confirm a candidate link really serves bytes.
 *
 * Hosts happily hand out structurally valid URLs for purged files: they answer
 * HTTP 200 with `Content-Length: 0`. Without this check the app would queue a
 * "ready" download that produces an empty file.
 */
export async function verifyDirectUrl(
  url: string,
): Promise<{ ok: boolean; bytes: number; contentType: string | null; note: string }> {
  const headers = {
    "User-Agent": UA,
    Referer: SITE_ORIGIN + "/",
    Accept: "*/*",
  };
  try {
    const head = await fetch(url, { method: "HEAD", headers, redirect: "follow" });
    const len = Number.parseInt(head.headers.get("content-length") ?? "0", 10) || 0;
    const type = head.headers.get("content-type");
    if (!head.ok) {
      return {
        ok: false,
        bytes: 0,
        contentType: type,
        note: `المضيف رفض الرابط (HTTP ${head.status})`,
      };
    }
    if (head.ok && len === 0) {
      // Some servers omit Content-Length on HEAD — probe a byte range.
      const ranged = await fetch(url, {
        headers: { ...headers, Range: "bytes=0-1023" },
        redirect: "follow",
      });
      const probe = await ranged.arrayBuffer();
      const total = Number.parseInt(
        (ranged.headers.get("content-range") ?? "").split("/")[1] ?? "0",
        10,
      );
      if (probe.byteLength === 0) {
        return {
          ok: false,
          bytes: 0,
          contentType: ranged.headers.get("content-type"),
          note: "الملف فارغ (0 بايت) لدى المضيف — حُذف أو صُفّي",
        };
      }
      return {
        ok: true,
        bytes: total > 0 ? total : probe.byteLength,
        contentType: ranged.headers.get("content-type"),
        note: "الرابط صالح",
      };
    }
    return { ok: true, bytes: len, contentType: type, note: "الرابط صالح" };
  } catch (err) {
    return {
      ok: false,
      bytes: 0,
      contentType: null,
      note: `تعذّر التحقق من الرابط: ${err instanceof Error ? err.message : "خطأ"}`,
    };
  }
}

/**
 * Diagnose *why* a host page yields no direct link.
 *
 * Deliberately narrow: matching "removed"/"login" anywhere in the document
 * produced false verdicts, because host pages carry those words in their
 * navigation and footer (e.g. `?op=registration`, `?op=premium`). We only trust
 * signals that describe the *page state*: the title, the main heading, and
 * explicit error/alert containers.
 */
export function describeLanding(html: string): { gate: LandingGate; note: string } {
  const $ = cheerio.load(html);

  // Cloudflare interstitials are unmistakable and page-wide.
  if (/_cf_chl_opt|challenges\.cloudflare\.com|cf-browser-verification/i.test(html)) {
    return {
      gate: "cloudflare",
      note: "المضيف خلف تحدّي Cloudflare — يحتاج متصفحًا حقيقيًا لاجتيازه",
    };
  }

  // Signals restricted to the prominent text of the page.
  const salient = [
    $("title").text(),
    $("h1").text(),
    $("h2").first().text(),
    $("[class*='error'],[class*='alert'],[class*='notfound'],[class*='not-found'],[id*='error']")
      .text(),
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 3000);

  if (
    /has been removed|file (was )?not found|no longer available|link (is )?(dead|expired)|file expired|تم حذف|الملف غير موجود|انتهت صلاحية/i.test(
      salient,
    )
  ) {
    return { gate: "dead-file", note: "الملف محذوف أو منتهي الصلاحية لدى المضيف" };
  }

  // A real gate means a password field, not a nav link to /login.
  const hasLoginForm =
    $("input[type='password']").length > 0 &&
    $("form").toArray().some((el) => {
      const action = ($(el).attr("action") ?? "").toLowerCase();
      const op = ($(el).find("input[name='op']").attr("value") ?? "").toLowerCase();
      return action.includes("login") || op.includes("login");
    });
  if (hasLoginForm) {
    return { gate: "login-required", note: "المضيف يطلب حسابًا (أو اشتراكًا مميزًا) للتنزيل" };
  }

  if (/adblock|ad-block|disable your ad|رجاء تعطيل|عطّل مانع/i.test(salient)) {
    return {
      gate: "adblock-wall",
      note: "المضيف يشترط تحميل سكربتات الإعلانات قبل كشف الرابط",
    };
  }

  // An actual multi-step download form is a gate we can sometimes walk.
  if ($("input[name='op'][value^='download']").length > 0) {
    return {
      gate: "form-gate",
      note: "نموذج تنزيل متعدد الخطوات — الرابط يُكشف بعد الضغط داخل المتصفح",
    };
  }

  if (/eval\(function\(p,a,c,k,e|_0x[0-9a-f]{4,}/i.test(html)) {
    return {
      gate: "obfuscated-js",
      note: "الرابط مُولَّد داخل JS مشوّش — يُكشف داخل المتصفح فقط",
    };
  }

  return { gate: "unknown", note: "لم يُعثر على رابط وسائط داخل الصفحة" };
}

/** Best-effort: turn a provider landing page into a directly downloadable URL. */
export async function extractDirectFromLanding(landingUrl: string): Promise<LandingReport> {
  const jar = new CookieJar();
  let html = "";
  try {
    const res = await fetch(landingUrl, {
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.8,en;q=0.6",
        Referer: `${SITE_ORIGIN}/`,
      },
    });
    jar.absorb(res.headers);
    html = await res.text();
  } catch {
    return {
      direct: null,
      gate: "unreachable",
      note: "تعذّر الاتصال بصفحة المضيف (مهلة أو حجب)",
    };
  }

  // Verify before accepting: hosts serve structurally valid URLs for purged
  // files with HTTP 200 and Content-Length: 0.
  const found = async (d: DirectExtraction): Promise<LandingReport> => {
    const check = await verifyDirectUrl(d.url);
    if (!check.ok) {
      return { direct: null, gate: "dead-file", note: `${d.via}: ${check.note}` };
    }
    return {
      direct: d,
      gate: "none",
      note: `رابط مباشر عبر ${d.via} · ${humanBytes(check.bytes)}`,
    };
  };

  const plain = pickMedia(html, "embedded");
  if (plain) return await found(plain);

  const meta = pickMetaVideo(html);
  if (meta) return await found(meta);

  for (const chunk of unpacker(html)) {
    const packed = pickMedia(chunk, "packed-js");
    if (packed) return await found(packed);
    const fileEntry = /file\s*:\s*["']([^"']+)["']/.exec(chunk);
    if (fileEntry && /^https?:/i.test(fileEntry[1])) {
      const pick = pickMedia(fileEntry[1], "jwplayer-file");
      if (pick) return await found(pick);
    }
  }

  const xfs = await tryXFileSharing(landingUrl, html, jar);
  if (xfs) return await found(xfs);

  return { direct: null, ...describeLanding(html) };
}
