"use client";

import { useState } from "react";
import {
  DownloadIcon,
  FilmIcon,
  LinkIcon,
  PlayIcon,
  RadarIcon,
} from "@/components/icons";
import { Button, Chip, Field, Modal, ProgressBar, inputClass } from "@/components/ui";
import { SOURCE_TYPE_LABEL, humanBytes, relativeTimeAr } from "@/lib/format";
import type { EpisodeView } from "@/lib/types";

export function EpisodeDialog({
  episode,
  onClose,
  onChanged,
}: {
  episode: EpisodeView | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [manualUrl, setManualUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (!episode) return null;
  const sources = episode.sources ?? [];
  const directSources = sources.filter(
    (s) => s.kind === "direct" || (!s.kind && /^(mp4|hls|webm)$/.test(s.type)),
  );
  const landingSources = sources.filter((s) => s.kind === "landing");
  const canDownload = directSources.length > 0;

  async function run(path: string, method = "POST", body?: unknown) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setNote(json.error ?? "فشلت العملية");
        return false;
      }
      onChanged();
      return true;
    } catch (err) {
      setNote(err instanceof Error ? err.message : "خطأ غير متوقع");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const canPlay = episode.downloadStatus === "done" && episode.filePath;

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-3xl"
      title={episode.title}
      subtitle={`الحلقة ${episode.number} · ${episode.videoUniq ? `المعرّف ${episode.videoUniq}` : "بلا معرّف"}`}
      footer={
        <>
          {episode.watchUrl ? (
            <a href={episode.watchUrl} target="_blank" rel="noreferrer">
              <Button variant="ghost" size="sm" type="button">
                <LinkIcon className="h-3.5 w-3.5" />
                الصفحة الأصلية
              </Button>
            </a>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            loading={busy}
            onClick={() => void run(`/api/episodes/${episode.id}/resolve`)}
          >
            <RadarIcon className="h-3.5 w-3.5" />
            إعادة استخراج المصادر
          </Button>
          {canPlay ? (
            <a href={`/api/stream?id=${episode.id}&download=1`}>
              <Button variant="mint" size="sm" type="button">
                <DownloadIcon className="h-3.5 w-3.5" />
                حفظ الملف
              </Button>
            </a>
          ) : (
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              disabled={!canDownload}
              onClick={() => void run(`/api/episodes/${episode.id}/download`)}
            >
              <DownloadIcon className="h-3.5 w-3.5" />
              تنزيل الحلقة
            </Button>
          )}
        </>
      }
    >
      {canPlay ? (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-black">
          <video
            key={episode.id}
            controls
            playsInline
            className="aspect-video w-full bg-black"
            src={`/api/stream?id=${episode.id}`}
          />
        </div>
      ) : (
        <div className="grid place-items-center rounded-xl border border-dashed border-white/12 bg-white/[0.015] px-6 py-10 text-center">
          <FilmIcon className="h-7 w-7 text-mist-400" />
          <p className="mt-3 text-[13px] font-bold text-mist-200">لا يوجد ملف محفوظ بعد</p>
          <p className="mt-1.5 max-w-md text-[11.5px] leading-relaxed text-mist-400">
            استخرج مصدر الفيديو أولًا ثم ابدأ التنزيل، أو الصق رابط MP4/HLS مباشرًا في
            الحقل أدناه.
          </p>
        </div>
      )}

      <div className="mt-4">
        <h4 className="mb-2 flex items-center gap-2 font-display text-[12.5px] font-extrabold uppercase tracking-[0.12em] text-mist-300">
          <RadarIcon className="h-3.5 w-3.5 text-amber-glow" />
          المصادر المستخرجة ({sources.length})
        </h4>
        {sources.length === 0 ? (
          <p className="rounded-lg border border-white/[0.07] bg-ink-950/50 px-3.5 py-3 text-[12px] leading-relaxed text-mist-400">
            {episode.resolveError ?? "لم يُستخرج أي مصدر حتى الآن."}
          </p>
        ) : (
          <ul className="space-y-2">
            {sources.map((s, i) => (
              <li
                key={`${s.url}-${i}`}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                  i === episode.selectedSourceIndex
                    ? "border-amber-glow/45 bg-amber-glow/[0.07]"
                    : "border-white/[0.07] bg-ink-950/40 hover:border-white/15"
                }`}
              >
                <button
                  onClick={() =>
                    void run(`/api/episodes/${episode.id}`, "PATCH", {
                      selectedSourceIndex: i,
                    })
                  }
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border text-[11px] font-bold transition-colors ${
                    i === episode.selectedSourceIndex
                      ? "border-amber-glow bg-amber-glow text-ink-950"
                      : "border-white/15 text-mist-300 hover:border-amber-glow/50"
                  }`}
                  aria-label="اختيار هذا المصدر"
                >
                  {i === episode.selectedSourceIndex ? <PlayIcon className="h-3 w-3" /> : i + 1}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[12.5px] font-bold text-mist-100">
                      {s.label}
                    </span>
                    <Chip tone={s.type === "hls" ? "sky" : s.type === "mp4" ? "mint" : "neutral"}>
                      {SOURCE_TYPE_LABEL[s.type] ?? s.type}
                    </Chip>
                    {s.quality ? <Chip tone="amber">{s.quality}</Chip> : null}
                    {s.server ? <Chip>{s.server}</Chip> : null}
                  </div>
                  <div dir="ltr" className="mt-1 truncate text-left font-mono text-[10.5px] text-mist-400">
                    {s.url}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {landingSources.length > 0 ? (
        <div className="mt-4 rounded-xl border border-sky-soft/25 bg-sky-soft/[0.06] p-4">
          <h4 className="flex items-center gap-2 font-display text-[12.5px] font-extrabold text-sky-soft">
            <LinkIcon className="h-3.5 w-3.5" />
            صفحات المزوّدين ({landingSources.length}) — حماية الجلسة مفكوكة
          </h4>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-mist-300">
            تم إنشاء جلسة تشغيل شرعية وكشف كل المزوّدين. هؤلاء المضيفون يُظهرون الرابط
            النهائي داخل المتصفح (جدار إعلانات أو JS مشوّش)، فافتح الصفحة وابدأ التنزيل،
            أو الصق الرابط المباشر في الحقل أدناه ليقوم المِرفأ بسحبه وتنظيمه تلقائيًا.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {landingSources.map((s) => (
              <a
                key={`${s.provider}-${s.url}`}
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="focus-ring group flex items-center justify-between gap-2 rounded-lg border border-white/[0.09] bg-ink-950/60 px-3 py-2.5 transition-colors hover:border-sky-soft/50"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[12.5px] font-bold text-mist-100">
                      {s.provider}
                    </span>
                    {s.quality ? <Chip tone="amber">{s.quality}p</Chip> : null}
                    {s.gate === "dead-file" ? <Chip tone="rose">ملف محذوف</Chip> : null}
                    {s.gate === "cloudflare" ? <Chip tone="rose">Cloudflare</Chip> : null}
                    {s.gate === "adblock-wall" ? <Chip tone="amber">جدار إعلانات</Chip> : null}
                    {s.gate === "obfuscated-js" ? <Chip tone="sky">JS مشوّش</Chip> : null}
                    {s.gate === "form-gate" ? <Chip tone="sky">نموذج متعدد الخطوات</Chip> : null}
                    {s.gate === "login-required" ? <Chip tone="rose">يطلب حسابًا</Chip> : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] leading-relaxed text-mist-300">
                    {s.note ?? "صفحة المضيف"}
                  </span>
                  <span dir="ltr" className="mt-0.5 block truncate text-left font-mono text-[10px] text-mist-400">
                    {s.url}
                  </span>
                </span>
                <LinkIcon className="h-3.5 w-3.5 shrink-0 text-mist-400 transition-colors group-hover:text-sky-soft" />
              </a>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5">
        <Field
          label="إضافة مصدر يدوي (MP4 / M3U8 / WEBM)"
          hint="الصق رابطًا مباشرًا إن حصلت عليه من أداة خارجية؛ سيُستخدم فورًا للتنزيل."
        >
          <div className="flex gap-2">
            <input
              dir="ltr"
              className={`${inputClass} text-left font-mono text-[12px]`}
              placeholder="https://cdn.example.com/episode.mp4"
              value={manualUrl}
              onChange={(e) => setManualUrl(e.target.value)}
            />
            <Button
              variant="outline"
              className="shrink-0"
              loading={busy}
              onClick={async () => {
                if (!/^https?:\/\//i.test(manualUrl.trim())) {
                  setNote("الرابط غير صالح");
                  return;
                }
                const done = await run("/api/episodes", "POST", {
                  action: "manual-source",
                  episodeId: episode.id,
                  sourceUrl: manualUrl.trim(),
                });
                if (done) setManualUrl("");
              }}
            >
              إضافة
            </Button>
          </div>
        </Field>
      </div>

      {episode.downloadStatus !== "idle" ? (
        <div className="mt-4 rounded-xl border border-white/[0.08] bg-ink-950/50 p-3.5">
          <div className="mb-2 flex items-center justify-between text-[12px] font-bold text-mist-200">
            <span>حالة التنزيل</span>
            <span className="tabular text-mist-400">
              {humanBytes(episode.bytesDone)} / {humanBytes(episode.bytesTotal)}
            </span>
          </div>
          <ProgressBar
            value={episode.progress}
            active={episode.downloadStatus === "downloading"}
            tone={episode.downloadStatus === "done" ? "mint" : "amber"}
          />
          {episode.error ? (
            <p className="mt-2 text-[11.5px] leading-relaxed text-rose-alert">{episode.error}</p>
          ) : null}
          {episode.filePath ? (
            <p dir="ltr" className="mt-2 truncate text-left font-mono text-[10.5px] text-mist-400">
              {episode.filePath}
            </p>
          ) : null}
        </div>
      ) : null}

      <dl className="mt-4 grid grid-cols-2 gap-2 text-[11.5px] sm:grid-cols-4">
        {[
          ["المحاولات", String(episode.attempts)],
          ["الحجم المحفوظ", humanBytes(episode.fileSize)],
          ["آخر تحديث", relativeTimeAr(episode.updatedAt)],
          [
            "الاستخراج",
            episode.resolvedAt ? relativeTimeAr(episode.resolvedAt) : "—",
          ],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
            <dt className="text-mist-400">{k}</dt>
            <dd className="mt-0.5 font-bold text-mist-100 tabular">{v}</dd>
          </div>
        ))}
      </dl>

      {note ? (
        <p className="mt-3 rounded-lg border border-rose-alert/30 bg-rose-alert/[0.07] px-3 py-2 text-[12px] text-rose-alert">
          {note}
        </p>
      ) : null}
    </Modal>
  );
}
