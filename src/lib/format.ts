/** Pure formatting helpers — safe for both server and client bundles. */

export function humanBytes(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number.parseFloat(value) : (value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / Math.pow(1024, i);
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

export function humanRate(bps: number | string | null | undefined): string {
  const n = typeof bps === "string" ? Number.parseFloat(bps) : (bps ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `${humanBytes(n)}/ث`;
}

export function humanEta(remainingBytes: number, bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0 || remainingBytes <= 0) return "—";
  const secs = Math.round(remainingBytes / bps);
  if (secs < 60) return `${secs} ث`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} د ${secs % 60} ث`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} س ${mins % 60} د`;
}

export function humanDuration(ms: number): string {
  const secs = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function relativeTimeAr(input: Date | string | null | undefined): string {
  if (!input) return "—";
  const date = typeof input === "string" ? new Date(input) : input;
  const diff = Date.now() - date.getTime();
  if (Number.isNaN(diff)) return "—";
  const secs = Math.round(diff / 1000);
  if (secs < 5) return "الآن";
  if (secs < 60) return `قبل ${secs} ثانية`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `قبل ${mins} دقيقة`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `قبل ${hrs} ساعة`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `قبل ${days} يوم`;
  return date.toLocaleDateString("ar-EG");
}

export function clockTime(input: Date | string | null | undefined): string {
  if (!input) return "";
  const date = typeof input === "string" ? new Date(input) : input;
  return date.toLocaleTimeString("ar-EG", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function percent(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

export const DOWNLOAD_STATUS_LABEL: Record<string, string> = {
  idle: "لم يبدأ",
  queued: "في الطابور",
  downloading: "يُنزَّل الآن",
  done: "مكتمل",
  failed: "فشل",
  canceled: "مُلغى",
};

export const RESOLVE_STATUS_LABEL: Record<string, string> = {
  idle: "بلا مصادر",
  resolving: "جارٍ الاستخراج",
  ready: "جاهز للتنزيل",
  partial: "صفحات مزوّدين متاحة",
  needs_auth: "يتطلب تسجيل دخول",
  failed: "تعذّر الاستخراج",
};

export const SOURCE_TYPE_LABEL: Record<string, string> = {
  mp4: "MP4",
  hls: "HLS",
  webm: "WEBM",
  unknown: "غير معروف",
};
