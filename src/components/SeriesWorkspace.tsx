"use client";

import { useMemo, useState } from "react";
import {
  BoltIcon,
  DownloadIcon,
  FilmIcon,
  LayersIcon,
  LinkIcon,
  PlayIcon,
  PlusIcon,
  RadarIcon,
  RefreshIcon,
  StopIcon,
  TrashIcon,
} from "@/components/icons";
import {
  Button,
  Chip,
  EmptyNote,
  IconButton,
  ProgressBar,
  StatusDot,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  DOWNLOAD_STATUS_LABEL,
  RESOLVE_STATUS_LABEL,
  SOURCE_TYPE_LABEL,
  humanBytes,
  humanRate,
  percent,
} from "@/lib/format";
import type { EpisodeView, MovingEpisode, SeasonView, SeriesDetail } from "@/lib/types";

function EpisodeRow({
  ep,
  live,
  onOpen,
  onResolve,
  onDownload,
  onCancel,
  onDelete,
}: {
  ep: EpisodeView;
  live?: MovingEpisode;
  onOpen: () => void;
  onResolve: () => void;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const progress = live?.progress ?? ep.progress;
  const speed = live?.speedBps ?? ep.speedBps;
  const bytesDone = live?.bytesDone ?? ep.bytesDone;
  const bytesTotal = live?.bytesTotal ?? ep.bytesTotal;
  const status = live?.downloadStatus ?? ep.downloadStatus;
  const resolveStatus = live?.resolveStatus ?? ep.resolveStatus;
  const sources = ep.sources ?? [];
  const primary = sources[ep.selectedSourceIndex] ?? sources[0];
  const running = status === "downloading" || status === "queued";
  const directCount = sources.filter(
    (s) => s.kind === "direct" || (!s.kind && /^(mp4|hls|webm)$/.test(s.type)),
  ).length;

  return (
    <tr className="group border-b border-white/[0.045] transition-colors last:border-0 hover:bg-white/[0.028]">
      <td className="py-2.5 pr-3 pl-2">
        <span className="tabular text-[12px] font-bold text-mist-400">
          {String(ep.number).padStart(2, "0")}
        </span>
      </td>

      <td className="py-2.5 px-2">
        <button onClick={onOpen} className="focus-ring flex min-w-0 items-center gap-2.5 text-right">
          <span className="relative grid h-10 w-16 shrink-0 place-items-center overflow-hidden rounded-md border border-white/10 bg-ink-800">
            {ep.posterUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ep.posterUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
            ) : (
              <FilmIcon className="h-3.5 w-3.5 text-mist-400" />
            )}
            <span className="absolute inset-0 grid place-items-center bg-ink-950/60 opacity-0 transition-opacity group-hover:opacity-100">
              <PlayIcon className="h-3.5 w-3.5 text-amber-glow" />
            </span>
          </span>
          <span className="min-w-0">
            <span className="block truncate font-display text-[12.5px] font-bold text-mist-100">
              {ep.title}
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-mist-400">
              {ep.videoUniq ? <span className="font-mono">{ep.videoUniq}</span> : null}
              {primary ? (
                <Chip
                  tone={primary.type === "hls" ? "sky" : primary.type === "mp4" ? "mint" : "neutral"}
                  className="px-1.5 py-0 text-[9.5px]"
                >
                  {SOURCE_TYPE_LABEL[primary.type] ?? primary.type}
                  {primary.quality ? ` · ${primary.quality}` : ""}
                </Chip>
              ) : null}
              {sources.length > 1 ? <span>{sources.length} مصادر</span> : null}
            </span>
          </span>
        </button>
      </td>

      <td className="py-2.5 px-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-mist-300">
          <StatusDot status={resolveStatus} />
          {RESOLVE_STATUS_LABEL[resolveStatus] ?? resolveStatus}
        </span>
      </td>

      <td className="py-2.5 px-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-mist-300">
          <StatusDot status={status} />
          {DOWNLOAD_STATUS_LABEL[status] ?? status}
        </span>
      </td>

      <td className="py-2.5 px-2">
        {status === "done" ? (
          <span className="tabular text-[11.5px] font-bold text-mint">
            {humanBytes(ep.fileSize)}
          </span>
        ) : running ? (
          <span className="block w-32">
            <span className="mb-1 flex items-center justify-between text-[10px] tabular text-mist-400">
              <span className="font-bold text-amber-glow">{Math.round(progress)}%</span>
              <span>{humanRate(speed)}</span>
            </span>
            <ProgressBar value={progress} active tone="amber" className="h-1" />
            <span className="mt-1 block truncate text-[9.5px] tabular text-mist-400">
              {humanBytes(bytesDone)} / {Number(bytesTotal) > 0 ? humanBytes(bytesTotal) : "—"}
            </span>
          </span>
        ) : ep.error || ep.resolveError ? (
          <span className="block max-w-[15rem] truncate text-[10.5px] leading-relaxed text-rose-alert/90" title={ep.error ?? ep.resolveError ?? ""}>
            {ep.error ?? ep.resolveError}
          </span>
        ) : (
          <span className="text-[11px] text-mist-400/70">—</span>
        )}
      </td>

      <td className="py-2.5 pl-3 pr-2">
        <span className="flex items-center justify-end gap-1 opacity-70 transition-opacity group-hover:opacity-100">
          {status === "done" ? (
            <IconButton label="تشغيل" onClick={onOpen} className="border-mint/30 text-mint hover:text-mint">
              <PlayIcon className="h-3.5 w-3.5" />
            </IconButton>
          ) : null}
          <IconButton label="استخراج المصادر" onClick={onResolve}>
            <RadarIcon className="h-3.5 w-3.5" />
          </IconButton>
          {running ? (
            <IconButton label="إيقاف التنزيل" onClick={onCancel} className="border-rose-alert/30 text-rose-alert hover:text-rose-alert">
              <StopIcon className="h-3.5 w-3.5" />
            </IconButton>
          ) : (
            <IconButton
              label={
                directCount > 0
                  ? "تنزيل"
                  : sources.length > 0
                    ? "لا رابط مباشر — افتح الحلقة لاستعراض صفحات المزوّدين"
                    : "استخرج المصادر أولًا"
              }
              onClick={onDownload}
              disabled={directCount === 0}
              className="border-amber-glow/30 text-amber-glow hover:text-amber-glow disabled:opacity-25"
            >
              <DownloadIcon className="h-3.5 w-3.5" />
            </IconButton>
          )}
          {ep.watchUrl ? (
            <a href={ep.watchUrl} target="_blank" rel="noreferrer">
              <IconButton label="الصفحة الأصلية">
                <LinkIcon className="h-3.5 w-3.5" />
              </IconButton>
            </a>
          ) : null}
          <IconButton label="حذف الحلقة" onClick={onDelete} className="hover:border-rose-alert/50 hover:text-rose-alert">
            <TrashIcon className="h-3.5 w-3.5" />
          </IconButton>
        </span>
      </td>
    </tr>
  );
}

export function SeriesWorkspace({
  detail,
  moving,
  busyAction,
  onSeasonAction,
  onEpisodeAction,
  onOpenEpisode,
  onImportAllSeasons,
  onAddEpisode,
  onBulk,
}: {
  detail: SeriesDetail | null;
  moving: MovingEpisode[];
  busyAction: string | null;
  onSeasonAction: (
    seasonId: number,
    action: "resolve" | "download" | "refresh",
  ) => void;
  onEpisodeAction: (
    episodeId: number,
    action: "resolve" | "download" | "cancel" | "delete",
  ) => void;
  onOpenEpisode: (ep: EpisodeView) => void;
  onImportAllSeasons: () => void;
  onAddEpisode: (seasonId: number) => void;
  onBulk: (seasonId: number, scope: "season" | "series") => void;
}) {
  const [activeSeason, setActiveSeason] = useState<number | null>(null);
  const liveMap = useMemo(() => new Map(moving.map((m) => [m.id, m])), [moving]);

  if (!detail) {
    return (
      <div className="grid h-full place-items-center">
        <EmptyNote>اختر سلسلة من المكتبة لعرض مواسمها وحلقاتها.</EmptyNote>
      </div>
    );
  }

  const seasons = detail.seasons;
  const current: SeasonView | undefined =
    seasons.find((s) => s.id === activeSeason) ?? seasons[0];
  const eps = current?.episodes ?? [];
  const doneCount = eps.filter((e) => e.downloadStatus === "done").length;
  const readyCount = eps.filter(
    (e) => e.resolveStatus === "ready" && e.downloadStatus !== "done",
  ).length;
  const seriesProgress = percent(doneCount, eps.length);

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="panel relative overflow-hidden rounded-2xl">
        <div className="absolute inset-0 opacity-[0.16]">
          {detail.series.posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={detail.series.posterUrl}
              alt=""
              className="h-full w-full scale-125 object-cover blur-2xl"
            />
          ) : null}
          <div className="absolute inset-0 bg-[linear-gradient(100deg,#0b0d15_18%,rgba(11,13,21,0.55)_60%,rgba(11,13,21,0.9))]" />
        </div>

        <div className="relative flex flex-wrap items-start gap-5 p-5">
          <div className="relative h-40 w-28 shrink-0 overflow-hidden rounded-xl border border-white/12 bg-ink-800 shadow-[0_20px_45px_-22px_rgba(0,0,0,0.95)]">
            {detail.series.posterUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={detail.series.posterUrl}
                alt={detail.series.title}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="grid h-full place-items-center font-display text-4xl font-black text-amber-glow/70">
                {detail.series.title.charAt(0)}
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone="amber">
                <LayersIcon className="h-3 w-3" />
                {seasons.length} موسم
              </Chip>
              {detail.series.year ? <Chip tone="sky">{detail.series.year}</Chip> : null}
              {detail.series.language ? <Chip>{detail.series.language}</Chip> : null}
              {detail.series.quality ? <Chip tone="mint">{detail.series.quality}</Chip> : null}
              {(detail.series.genres ?? []).slice(0, 2).map((g) => (
                <Chip key={g}>{g}</Chip>
              ))}
            </div>

            <h1 className="mt-2.5 font-display text-[26px] font-black leading-tight text-mist-100">
              {detail.series.title}
            </h1>
            {detail.series.originalTitle ? (
              <p dir="ltr" className="mt-1 text-left text-[12.5px] font-semibold text-mist-400" style={{ textAlign: "right" }}>
                {detail.series.originalTitle}
              </p>
            ) : null}

            {detail.series.synopsis ? (
              <p className="mt-2 max-w-3xl text-[12px] leading-relaxed text-mist-300">
                {detail.series.synopsis}
              </p>
            ) : null}

            <div className="mt-3.5 flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                loading={busyAction === `season:${current?.id}:download`}
                disabled={!current || readyCount === 0}
                onClick={() => current && onSeasonAction(current.id, "download")}
              >
                <DownloadIcon className="h-3.5 w-3.5" />
                تنزيل الموسم ({readyCount} جاهزة)
              </Button>
              <Button
                variant="mint"
                size="sm"
                loading={busyAction === `season:${current?.id}:bulk`}
                disabled={!current || eps.length === 0}
                onClick={() => current && onBulk(current.id, "season")}
              >
                <BoltIcon className="h-3.5 w-3.5" />
                تنزيل الموسم كاملًا
              </Button>
              <Button
                variant="outline"
                size="sm"
                loading={busyAction === `season:${current?.id}:resolve`}
                disabled={!current}
                onClick={() => current && onSeasonAction(current.id, "resolve")}
              >
                <RadarIcon className="h-3.5 w-3.5" />
                استخراج مصادر الموسم
              </Button>
              <Button
                variant="ghost"
                size="sm"
                loading={busyAction === `season:${current?.id}:refresh`}
                disabled={!current}
                onClick={() => current && onSeasonAction(current.id, "refresh")}
              >
                <RefreshIcon className="h-3.5 w-3.5" />
                تحديث قائمة الحلقات
              </Button>
              <Button variant="ghost" size="sm" loading={busyAction === "import-all"} onClick={onImportAllSeasons}>
                <LayersIcon className="h-3.5 w-3.5" />
                استيراد كل المواسم
              </Button>
              <Button
                variant="outline"
                size="sm"
                loading={busyAction === "bulk-series"}
                disabled={seasons.length === 0}
                onClick={() => current && onBulk(current.id, "series")}
              >
                <BoltIcon className="h-3.5 w-3.5" />
                تنزيل المسلسل كاملًا
              </Button>
            </div>
          </div>

          <div className="shrink-0 rounded-xl border border-white/[0.08] bg-ink-950/55 p-3 text-center">
            <div className="tabular text-[24px] font-black leading-none text-amber-glow">
              {seriesProgress}%
            </div>
            <div className="mt-1.5 text-[10.5px] text-mist-400">
              {doneCount} من {eps.length} حلقة
            </div>
            <ProgressBar
              className="mt-2 w-24"
              value={seriesProgress}
              tone={seriesProgress === 100 ? "mint" : "amber"}
            />
          </div>
        </div>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {seasons.map((s) => {
          const sDone = s.episodes.filter((e) => e.downloadStatus === "done").length;
          const active = s.id === current?.id;
          return (
            <button
              key={s.id}
              onClick={() => setActiveSeason(s.id)}
              className={cn(
                "focus-ring group relative rounded-lg border px-3.5 py-2 text-[12px] font-bold transition-all",
                active
                  ? "border-amber-glow/50 bg-[linear-gradient(135deg,rgba(247,183,51,0.18),rgba(255,107,61,0.08))] text-amber-glow"
                  : "border-white/[0.07] bg-white/[0.02] text-mist-300 hover:border-white/18 hover:text-mist-100",
              )}
            >
              <span className="flex items-center gap-2">
                الموسم {s.number}
                <span className="tabular text-[10px] opacity-70">
                  {sDone}/{s.episodes.length}
                </span>
                {!s.imported ? <span className="h-1.5 w-1.5 rounded-full bg-ember" /> : null}
              </span>
            </button>
          );
        })}
      </div>

      <div className="panel mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-3">
          <div>
            <h2 className="font-display text-[14px] font-extrabold text-mist-100">
              {current?.title ?? `الموسم ${current?.number ?? ""}`}
            </h2>
            <p className="mt-0.5 text-[11px] text-mist-400">
              {eps.length} حلقة · {readyCount} جاهزة للتنزيل ·{" "}
              {humanBytes(eps.reduce((sum, e) => sum + Number(e.fileSize || 0), 0))} على القرص
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={!current}
            onClick={() => current && onAddEpisode(current.id)}
          >
            <PlusIcon className="h-3.5 w-3.5" />
            حلقة يدوية
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {eps.length === 0 ? (
            <div className="p-4">
              <EmptyNote>
                لا حلقات في هذا الموسم بعد. اضغط «تحديث قائمة الحلقات» لجلبها من الموقع المصدر.
              </EmptyNote>
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10 bg-ink-850/95 backdrop-blur">
                <tr className="border-b border-white/[0.08] text-right text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-mist-400">
                  <th className="py-2.5 pr-3 pl-2 w-10">#</th>
                  <th className="py-2.5 px-2">الحلقة</th>
                  <th className="py-2.5 px-2 w-36">المصدر</th>
                  <th className="py-2.5 px-2 w-32">التنزيل</th>
                  <th className="py-2.5 px-2 w-40">التقدّم</th>
                  <th className="py-2.5 pl-3 pr-2 w-44 text-left">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {eps.map((ep) => (
                  <EpisodeRow
                    key={ep.id}
                    ep={ep}
                    live={liveMap.get(ep.id)}
                    onOpen={() => onOpenEpisode(ep)}
                    onResolve={() => onEpisodeAction(ep.id, "resolve")}
                    onDownload={() => onEpisodeAction(ep.id, "download")}
                    onCancel={() => onEpisodeAction(ep.id, "cancel")}
                    onDelete={() => onEpisodeAction(ep.id, "delete")}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}
