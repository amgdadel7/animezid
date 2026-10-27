"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DbTargetView } from "@/lib/types";
import { EmptyConsole } from "@/components/EmptyConsole";
import { EpisodeDialog } from "@/components/EpisodeDialog";
import { ImportDialog } from "@/components/ImportDialog";
import { LibraryRail } from "@/components/LibraryRail";
import { QueuePanel } from "@/components/QueuePanel";
import { SeriesWorkspace } from "@/components/SeriesWorkspace";
import { SettingsDialog } from "@/components/SettingsDialog";
import {
  AlertIcon,
  AnchorMark,
  CheckIcon,
  CloseIcon,
  GearIcon,
  LayersIcon,
  PlusIcon,
  StackIcon,
} from "@/components/icons";
import { Button, Chip, Field, Modal, ProgressBar, inputClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { humanBytes, percent } from "@/lib/format";
import type { EpisodeView, SeriesDetail, SeriesRow, StatePayload } from "@/lib/types";

interface Toast {
  id: number;
  tone: "ok" | "bad" | "info";
  text: string;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    throw new Error(json.error ?? `طلب فاشل (${res.status})`);
  }
  return json.data as T;
}

export function Dashboard({
  initialSeries,
  initialStorage,
  dbOnline,
  dbError = "",
  dbTarget = null,
}: {
  initialSeries: SeriesRow[];
  initialStorage: { episodes: number; bytes: string; seasons: number };
  dbOnline: boolean;
  dbError?: string;
  dbTarget?: DbTargetView | null;
}) {
  const [seriesList, setSeriesList] = useState<SeriesRow[]>(initialSeries);
  const [selectedId, setSelectedId] = useState<number | null>(
    initialSeries[0]?.id ?? null,
  );
  const [detail, setDetail] = useState<SeriesDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [state, setState] = useState<StatePayload | null>(null);
  const [importOpen, setImportOpen] = useState(initialSeries.length === 0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [episode, setEpisode] = useState<EpisodeView | null>(null);
  const [addSeasonId, setAddSeasonId] = useState<number | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const pushToast = useCallback((tone: Toast["tone"], text: string) => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev.slice(-3), { id, tone, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5200);
  }, []);

  const refreshSeries = useCallback(async () => {
    try {
      const rows = await api<SeriesRow[]>("/api/series");
      setSeriesList(rows);
    } catch {
      /* ignore */
    }
  }, []);

  const refreshDetail = useCallback(
    async (id: number) => {
      setDetailLoading(true);
      try {
        const data = await api<SeriesDetail>(`/api/series/${id}`);
        setDetail(data);
        // Keep the open dialog in sync with fresh server state.
        setEpisode((cur) => {
          if (!cur) return cur;
          for (const season of data.seasons) {
            const found = season.episodes.find((e) => e.id === cur.id);
            if (found) return found;
          }
          return cur;
        });
      } catch {
        /* ignore */
      } finally {
        setDetailLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (selectedId != null) void refreshDetail(selectedId);
    else setDetail(null);
  }, [selectedId, refreshDetail]);

  // Live polling — faster while work is in flight.
  const busy = Boolean(
    state && (state.queue.activeCount > 0 || state.moving.length > 0),
  );
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/state");
        const json = await res.json();
        if (alive && json.ok) setState(json.data as StatePayload);
      } catch {
        /* keep last known state */
      }
    };
    void tick();
    const timer = setInterval(tick, busy ? 1400 : 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [busy]);

  // Refresh the workspace while its episodes are moving.
  useEffect(() => {
    if (!selectedId || !state) return;
    const hasWork =
      state.moving.length > 0 ||
      state.needsAttention.some((n) => detail?.seasons.some((s) => s.id === n.seasonId));
    if (!hasWork) return;
    const t = setInterval(() => void refreshDetail(selectedId), busy ? 1800 : 5000);
    return () => clearInterval(t);
  }, [selectedId, state, busy, refreshDetail, detail]);

  const runAction = useCallback(
    async (key: string, fn: () => Promise<unknown>, success?: string) => {
      setBusyAction(key);
      try {
        await fn();
        if (success) pushToast("ok", success);
        await Promise.all([refreshSeries(), selectedId ? refreshDetail(selectedId) : null]);
      } catch (err) {
        pushToast("bad", err instanceof Error ? err.message : "فشلت العملية");
      } finally {
        setBusyAction(null);
      }
    },
    [pushToast, refreshDetail, refreshSeries, selectedId],
  );

  const importFromUrl = useCallback(
    async (url: string) => {
      if (!url) return;
      await runAction(
        "import-console",
        async () => {
          const summary = await api<{
            seriesId: number;
            seasonId: number;
            seriesTitle: string;
            seasonNumber: number;
            episodesAdded: number;
            seasonsDiscovered: number;
          }>("/api/series", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url, autoResolve: true }),
          });
          setSelectedId(summary.seriesId);
          pushToast(
            "ok",
            `استُورد «${summary.seriesTitle}» — الموسم ${summary.seasonNumber} · ${summary.episodesAdded} حلقة`,
          );
        },
      );
    },
    [pushToast, runAction],
  );

  const stats = state?.stats;
  const totalDone = stats?.downloadByStatus.done ?? initialStorage.episodes;
  const totalEpisodes = stats?.episodeCount ?? seriesList.reduce((s, x) => s + x.episodeCount, 0);
  const totalBytes = stats?.totalBytes ?? initialStorage.bytes;
  const libraryProgress = percent(totalDone, totalEpisodes);

  const movingForCurrent = useMemo(() => state?.moving ?? [], [state]);

  if (!dbOnline) {
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <div className="panel max-w-md rounded-2xl p-6 text-center">
          <AlertIcon className="mx-auto h-7 w-7 text-rose-alert" />
          <h1 className="mt-3 font-display text-lg font-extrabold">
            تعذّر الاتصال بقاعدة البيانات
          </h1>
          <p className="mt-2 text-[12.5px] leading-relaxed text-mist-400">
            {dbError || "لم ينجح الاستعلام الافتتاحي تجاه قاعدة البيانات."}
          </p>

          {dbTarget ? (
            <dl className="mt-4 space-y-1.5 rounded-xl border border-white/[0.08] bg-ink-950/70 p-3.5 text-right">
              <div className="mb-2 flex items-center justify-between">
                <dt className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-mist-400">
                  وجهة الاتصال
                </dt>
                <Chip tone={dbTarget.ssl ? "sky" : "neutral"}>
                  {dbTarget.ssl ? "SSL مفعّل" : "بلا SSL"}
                </Chip>
              </div>
              {[
                ["المضيف", dbTarget.host],
                ["المنفذ", String(dbTarget.port)],
                ["القاعدة", dbTarget.database],
                ["المستخدم", dbTarget.user],
                ["المصدر", dbTarget.origin],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3 text-[11.5px]">
                  <dt className="text-mist-400">{k}</dt>
                  <dd dir="ltr" className="truncate font-mono text-mist-200">
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          <div className="mt-4 space-y-2 rounded-xl border border-amber-glow/25 bg-amber-glow/[0.06] p-3.5 text-right text-[11.5px] leading-relaxed text-mist-200">
            <p className="font-extrabold text-amber-glow">خطوات الإصلاح</p>
            <ol className="list-inside list-decimal space-y-1 text-mist-300">
              <li>
                محليًا: تأكّد أن PostgreSQL يعمل وأن <span dir="ltr" className="font-mono">DATABASE_URL</span> يشير إليه.
              </li>
              <li>
                مع Supabase: أضف كلمة مرور القاعدة (ليست مفتاح <span dir="ltr" className="font-mono">sb_secret_</span>) ثم اضبط:
                <span
                  dir="ltr"
                  className="mt-1 block truncate rounded-md bg-ink-950/70 px-2 py-1.5 font-mono text-[10px] text-mist-300"
                >
                  postgresql://postgres.&lt;ref&gt;:&lt;DB_PASSWORD&gt;@&lt;host&gt;:6543/postgres?sslmode=require
                </span>
              </li>
              <li>المنفذ 6543 للوضع المُجمَّع (transaction pooler) و5432 للاتصال المباشر.</li>
              <li>افتح <span dir="ltr" className="font-mono">/api/health?verbose=1</span> لرؤية التشخيص الكامل.</li>
            </ol>
          </div>

          <Button
            variant="primary"
            size="sm"
            className="mt-4"
            onClick={() => window.location.reload()}
          >
            إعادة المحاولة
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1720px] flex-col px-4 pb-6 sm:px-6">
      <header className="sticky top-0 z-30 -mx-4 mb-5 border-b border-white/[0.06] bg-ink-950/82 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <span className="relative grid h-10 w-10 place-items-center rounded-xl border border-amber-glow/30 bg-[linear-gradient(140deg,rgba(247,183,51,0.2),rgba(255,107,61,0.08))]">
              <AnchorMark className="h-5 w-5 text-amber-glow" />
            </span>
            <div>
              <h1 className="font-display text-[17px] font-black leading-none tracking-tight text-mist-100">
                المِرفأ
              </h1>
              <p className="mt-1 text-[10.5px] leading-none text-mist-400">
                مُحمِّل مواسم وحلقات الأنمي
              </p>
            </div>
          </div>

          <div className="hidden h-8 w-px bg-white/[0.08] md:block" />

          <div className="flex flex-1 flex-wrap items-center gap-2">
            <Chip tone="neutral">
              <StackIcon className="h-3 w-3" />
              {stats?.seriesCount ?? seriesList.length} سلسلة
            </Chip>
            <Chip tone="neutral">
              <LayersIcon className="h-3 w-3" />
              {stats?.seasonCount ?? initialStorage.seasons} موسم
            </Chip>
            <Chip tone="sky">{totalEpisodes} حلقة</Chip>
            <Chip tone="mint">
              <CheckIcon className="h-3 w-3" />
              {totalDone} مكتملة
            </Chip>
            <Chip tone="amber">{humanBytes(totalBytes)}</Chip>
            {stats && stats.resolveByStatus.needs_auth ? (
              <button onClick={() => setSettingsOpen(true)} className="focus-ring">
                <Chip tone="rose">
                  <AlertIcon className="h-3 w-3" />
                  {stats.resolveByStatus.needs_auth} تحتاج دخول
                </Chip>
              </button>
            ) : null}
          </div>

          <div className="hidden min-w-[150px] items-center gap-2 lg:flex">
            <ProgressBar
              value={libraryProgress}
              active={busy}
              tone={libraryProgress === 100 ? "mint" : "amber"}
            />
            <span className="tabular shrink-0 text-[11px] font-extrabold text-mist-300">
              {libraryProgress}%
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
              <GearIcon className="h-3.5 w-3.5" />
              الإعدادات
            </Button>
            <Button variant="primary" size="sm" onClick={() => setImportOpen(true)}>
              <PlusIcon className="h-3.5 w-3.5" />
              استيراد
            </Button>
          </div>
        </div>
      </header>

      {seriesList.length === 0 && !detail ? (
        <EmptyConsole onImport={importFromUrl} busy={busyAction === "import-console"} />
      ) : (
        <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[264px_minmax(0,1fr)_336px]">
          <div className="panel min-h-[420px] rounded-2xl p-3.5 xl:sticky xl:top-[76px] xl:h-[calc(100vh-104px)]">
            <LibraryRail
              items={seriesList}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onImport={() => setImportOpen(true)}
            />
          </div>

          <div className="min-w-0">
            {detailLoading && !detail ? (
              <div className="panel grid h-64 place-items-center rounded-2xl text-[12.5px] text-mist-400">
                جارٍ تحميل المواسم والحلقات…
              </div>
            ) : (
              <SeriesWorkspace
                detail={detail}
                moving={movingForCurrent}
                busyAction={busyAction}
                onImportAllSeasons={() =>
                  selectedId != null &&
                  void runAction(
                    "import-all",
                    () =>
                      api(`/api/series/${selectedId}`, { method: "POST" }),
                    "جارٍ استيراد بقية المواسم في الخلفية",
                  )
                }
                onAddEpisode={(seasonId) => setAddSeasonId(seasonId)}
                onBulk={(seasonId, scope) => {
                  const key = scope === "series" ? "bulk-series" : `season:${seasonId}:bulk`;
                  void runAction(
                    key,
                    () =>
                      api("/api/bulk", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(
                          scope === "series"
                            ? { seriesId: selectedId }
                            : { seasonId },
                        ),
                      }),
                    scope === "series"
                      ? "بدأت معالجة المسلسل كاملًا: استخراج ثم تنزيل لكل حلقة"
                      : "بدأت معالجة الموسم: استخراج ثم تنزيل لكل حلقة",
                  );
                }}
                onSeasonAction={(seasonId, action) => {
                  if (action === "refresh") {
                    void runAction(
                      `season:${seasonId}:refresh`,
                      () => api(`/api/seasons/${seasonId}`, { method: "POST" }),
                      "حُدِّثت قائمة الحلقات",
                    );
                    return;
                  }
                  if (action === "resolve") {
                    void runAction(
                      `season:${seasonId}:resolve`,
                      () =>
                        api(`/api/seasons/${seasonId}?action=resolve`, { method: "PUT" }),
                      "بدأ استخراج المصادر في الخلفية",
                    );
                    return;
                  }
                  void runAction(
                    `season:${seasonId}:download`,
                    () => api(`/api/seasons/${seasonId}?action=download`, { method: "PUT" }),
                    "أُضيفت الحلقات إلى طابور التنزيل",
                  );
                }}
                onEpisodeAction={(episodeId, action) => {
                  if (action === "delete") {
                    void runAction(
                      `ep:${episodeId}:delete`,
                      () => api(`/api/episodes/${episodeId}`, { method: "DELETE" }),
                      "حُذفت الحلقة وملفها",
                    );
                    return;
                  }
                  const suffix =
                    action === "resolve" ? "resolve" : action === "cancel" ? "cancel" : "download";
                  void runAction(
                    `ep:${episodeId}:${action}`,
                    () => api(`/api/episodes/${episodeId}/${suffix}`, { method: "POST" }),
                    action === "download"
                      ? "أُضيفت الحلقة إلى الطابور"
                      : action === "resolve"
                        ? "جارٍ استخراج المصدر"
                        : "أُلغي التنزيل",
                  );
                }}
                onOpenEpisode={(ep) => setEpisode(ep)}
              />
            )}
          </div>

          <div className="xl:sticky xl:top-[76px] xl:h-[calc(100vh-104px)]">
            <QueuePanel state={state} onOpenSettings={() => setSettingsOpen(true)} />
          </div>
        </div>
      )}

      <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4 text-[11px] text-mist-400">
        <span>
          المِرفأ · أداة أرشفة شخصية. تأكّد من حقك في تنزيل المحتوى واحترم شروط الموقع المصدر
          وحقوق أصحابها.
        </span>
        <span className="tabular">
          {state?.settings.downloadDir ? `مجلد الحفظ: ${state.settings.downloadDir}` : ""}
        </span>
      </footer>

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(seriesId) => {
          setSelectedId(seriesId);
          void refreshSeries();
          void refreshDetail(seriesId);
        }}
      />

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => void refreshSeries()}
      />

      {episode ? (
        <EpisodeDialog
          episode={episode}
          onClose={() => setEpisode(null)}
          onChanged={() => {
            if (selectedId != null) void refreshDetail(selectedId);
            void refreshSeries();
          }}
        />
      ) : null}

      <AddEpisodeDialog
        seasonId={addSeasonId}
        onClose={() => setAddSeasonId(null)}
        onAdded={() => {
          if (selectedId != null) void refreshDetail(selectedId);
        }}
        onError={(m) => pushToast("bad", m)}
      />

      <div className="pointer-events-none fixed bottom-5 left-5 z-[60] flex w-[min(92vw,380px)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "slide-in pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[12px] leading-relaxed shadow-[0_20px_45px_-24px_rgba(0,0,0,0.95)] backdrop-blur-md",
              t.tone === "ok"
                ? "border-mint/30 bg-mint/[0.1] text-mint"
                : t.tone === "bad"
                  ? "border-rose-alert/30 bg-rose-alert/[0.1] text-rose-alert"
                  : "border-white/12 bg-ink-850/95 text-mist-200",
            )}
          >
            <span className="mt-0.5 shrink-0">
              {t.tone === "ok" ? (
                <CheckIcon className="h-3.5 w-3.5" />
              ) : t.tone === "bad" ? (
                <AlertIcon className="h-3.5 w-3.5" />
              ) : (
                <AnchorMark className="h-3.5 w-3.5" />
              )}
            </span>
            <span className="min-w-0 flex-1">{t.text}</span>
            <button
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              className="shrink-0 opacity-60 transition-opacity hover:opacity-100"
              aria-label="إخفاء"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}

function AddEpisodeDialog({
  seasonId,
  onClose,
  onAdded,
  onError,
}: {
  seasonId: number | null;
  onClose: () => void;
  onAdded: () => void;
  onError: (message: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [watchUrl, setWatchUrl] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (seasonId == null) {
      setTitle("");
      setWatchUrl("");
      setSourceUrl("");
    }
  }, [seasonId]);

  async function submit() {
    if (!seasonId) return;
    if (!title.trim()) {
      onError("أدخل عنوان الحلقة");
      return;
    }
    setBusy(true);
    try {
      await api(`/api/episodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seasonId,
          title: title.trim(),
          watchUrl: watchUrl.trim() || undefined,
          sourceUrl: sourceUrl.trim() || undefined,
        }),
      });
      onAdded();
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : "فشلت الإضافة");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={seasonId != null}
      onClose={onClose}
      width="max-w-lg"
      title="إضافة حلقة يدويًا"
      subtitle="أضف حلقة مفقودة أو حلقة بمصدر فيديو مباشر."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            إضافة الحلقة
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label="عنوان الحلقة">
          <input
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="مثال: الحلقة 12 — المواجهة الأخيرة"
          />
        </Field>
        <Field label="رابط المشاهدة (اختياري)" hint="رابط watch.php?vid=… إن كان متوفرًا.">
          <input
            dir="ltr"
            className={`${inputClass} text-left font-mono text-[12px]`}
            value={watchUrl}
            onChange={(e) => setWatchUrl(e.target.value)}
            placeholder="https://animezid.org/watch.php?vid=…"
          />
        </Field>
        <Field label="رابط الفيديو المباشر (اختياري)" hint="MP4 أو M3U8 — يجعل الحلقة قابلة للتنزيل فورًا.">
          <input
            dir="ltr"
            className={`${inputClass} text-left font-mono text-[12px]`}
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://cdn.example.com/ep12.mp4"
          />
        </Field>
      </div>
    </Modal>
  );
}
