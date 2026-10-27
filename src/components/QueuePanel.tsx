"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertIcon,
  BoltIcon,
  CheckIcon,
  ShieldIcon,
  TerminalIcon,
  TrashIcon,
} from "@/components/icons";
import { Button, Chip, EmptyNote, ProgressBar, StatusDot } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  DOWNLOAD_STATUS_LABEL,
  clockTime,
  humanBytes,
  humanEta,
  humanRate,
} from "@/lib/format";
import type { AttentionItem, LogEntry, MovingEpisode, StatePayload } from "@/lib/types";

const LEVEL_TONE: Record<string, string> = {
  success: "text-mint",
  warn: "text-amber-glow",
  error: "text-rose-alert",
  info: "text-mist-300",
};

function LiveDownload({ ep }: { ep: MovingEpisode }) {
  const total = Number(ep.bytesTotal) || 0;
  const doneBytes = Number(ep.bytesDone) || 0;
  const remaining = Math.max(0, total - doneBytes);
  const resolving = ep.resolveStatus === "resolving";
  return (
    <li className="rounded-xl border border-white/[0.07] bg-ink-950/55 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <StatusDot status={resolving ? "resolving" : ep.downloadStatus} />
          <span className="truncate text-[12px] font-bold text-mist-100">
            حلقة #{ep.id}
          </span>
        </span>
        <span className="shrink-0 text-[10.5px] font-bold tabular text-amber-glow">
          {Math.round(ep.progress)}%
        </span>
      </div>
      <ProgressBar
        className="mt-2"
        value={ep.progress}
        active
        tone={resolving ? "sky" : "amber"}
      />
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] tabular text-mist-400">
        <span className="inline-flex items-center gap-1">
          <BoltIcon className="h-3 w-3 text-amber-glow" />
          {humanRate(ep.speedBps)}
        </span>
        <span>
          {humanBytes(doneBytes)} / {total > 0 ? humanBytes(total) : "غير معروف"}
        </span>
        {ep.segmentsTotal > 0 ? (
          <span>
            مقطع {ep.segmentsDone}/{ep.segmentsTotal}
          </span>
        ) : null}
        {remaining > 0 && ep.speedBps > 0 ? (
          <span>المتبقي {humanEta(remaining, ep.speedBps)}</span>
        ) : null}
        <span>{resolving ? "جارٍ استخراج المصدر" : DOWNLOAD_STATUS_LABEL[ep.downloadStatus]}</span>
      </div>
    </li>
  );
}

function AttentionCard({ item }: { item: AttentionItem }) {
  const needsAuth = item.resolveStatus === "needs_auth";
  return (
    <li
      className={cn(
        "rounded-xl border p-3",
        needsAuth
          ? "border-ember/30 bg-ember/[0.07]"
          : "border-rose-alert/25 bg-rose-alert/[0.06]",
      )}
    >
      <div className="flex items-start gap-2">
        {needsAuth ? (
          <ShieldIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ember" />
        ) : (
          <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-alert" />
        )}
        <div className="min-w-0">
          <p className="truncate text-[12px] font-bold text-mist-100">{item.title}</p>
          <p className="mt-0.5 text-[10.5px] text-mist-400">
            {item.seriesTitle}
            {item.seasonTitle ? ` · ${item.seasonTitle}` : ""}
          </p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-mist-300">
            {item.resolveError ?? item.error ?? "خطأ غير محدد"}
          </p>
        </div>
      </div>
    </li>
  );
}

export function QueuePanel({
  state,
  onOpenSettings,
}: {
  state: StatePayload | null;
  onOpenSettings: () => void;
}) {
  const [log, setLog] = useState<LogEntry[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const lastId = useRef(0);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch(`/api/logs?since=${lastId.current}&limit=80`);
        const json = await res.json();
        if (!alive || !json.ok) return;
        const rows = json.data as LogEntry[];
        if (rows.length === 0) return;
        lastId.current = Math.max(lastId.current, ...rows.map((r) => r.id));
        setLog((prev) => [...rows.reverse(), ...prev].slice(0, 120));
      } catch {
        /* polling best-effort */
      }
    }
    void load();
    const t = setInterval(load, 2500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const moving = state?.moving ?? [];
  const bulk = state?.bulk ?? [];
  const attention = state?.needsAttention ?? [];
  const byStatus = state?.stats.downloadByStatus ?? {};
  const queuedCount = byStatus.queued ?? 0;
  const activeCount = state?.queue.activeCount ?? 0;
  const aggregateSpeed = moving.reduce((sum, m) => sum + (m.speedBps || 0), 0);
  const hasAuth = Boolean(state?.settings.hasCookie || state?.settings.hasCredentials);

  return (
    <aside className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pl-1">
      <section className="panel rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-display text-[12.5px] font-extrabold uppercase tracking-[0.14em] text-mist-300">
            <BoltIcon className="h-3.5 w-3.5 text-amber-glow" />
            الطابور الحيّ
          </h3>
          <div className="flex items-center gap-1.5">
            <Chip tone={activeCount > 0 ? "amber" : "neutral"}>{activeCount} نشط</Chip>
            <Chip tone={queuedCount > 0 ? "sky" : "neutral"}>{queuedCount} منتظر</Chip>
          </div>
        </div>

        <div className="mb-3 flex items-baseline justify-between rounded-lg border border-white/[0.06] bg-ink-950/50 px-3 py-2">
          <span className="text-[11px] text-mist-400">السرعة الكلية</span>
          <span className="tabular text-[15px] font-extrabold text-amber-glow">
            {humanRate(aggregateSpeed)}
          </span>
        </div>

        {moving.length === 0 ? (
          <EmptyNote>
            لا يوجد تنزيل نشط الآن. اختر موسمًا واضغط «تنزيل الموسم» لبدء الطابور.
          </EmptyNote>
        ) : (
          <ul className="space-y-2">
            {moving.map((ep) => (
              <LiveDownload key={ep.id} ep={ep} />
            ))}
          </ul>
        )}
      </section>

      {bulk.length > 0 ? (
        <section className="panel rounded-2xl p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-display text-[12.5px] font-extrabold uppercase tracking-[0.14em] text-mist-300">
              <BoltIcon className="h-3.5 w-3.5 text-amber-glow" />
              معالجة جماعية
            </h3>
            <Chip tone={bulk.some((b) => b.running) ? "amber" : "neutral"}>
              {bulk.some((b) => b.running) ? "جارية" : "منتهية"}
            </Chip>
          </div>
          <ul className="space-y-2.5">
            {bulk.map((b) => {
              const pct = b.total > 0 ? Math.round((b.processed / b.total) * 100) : 0;
              return (
                <li key={b.key} className="rounded-xl border border-white/[0.07] bg-ink-950/55 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12px] font-bold text-mist-100">{b.label}</span>
                    <span className="shrink-0 text-[10.5px] font-bold tabular text-amber-glow">{pct}%</span>
                  </div>
                  <ProgressBar className="mt-2" value={pct} active={b.running} tone="amber" />
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] tabular text-mist-400">
                    <span>
                      {b.processed}/{b.total} حلقة
                    </span>
                    <span className="text-mint">{b.queued} في الطابور</span>
                    <span>{b.resolved} استُخرجت</span>
                    {b.skipped > 0 ? <span>{b.skipped} تخطّي</span> : null}
                    {b.failed > 0 ? <span className="text-rose-alert">{b.failed} فشل</span> : null}
                  </div>
                  <p className="mt-1.5 truncate text-[10.5px] text-mist-400" title={b.lastMessage}>
                    {b.lastMessage}
                  </p>
                  {b.running ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2 h-7 px-2 text-[11px]"
                      onClick={() => void fetch(`/api/bulk?key=${encodeURIComponent(b.key)}`, { method: "DELETE" })}
                    >
                      إيقاف المعالجة
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="panel rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-display text-[12.5px] font-extrabold uppercase tracking-[0.14em] text-mist-300">
            <AlertIcon className="h-3.5 w-3.5 text-ember" />
            يحتاج انتباه
          </h3>
          {attention.length > 0 ? <Chip tone="rose">{attention.length}</Chip> : null}
        </div>

        {!hasAuth ? (
          <div className="mb-3 rounded-xl border border-ember/30 bg-ember/[0.07] p-3">
            <p className="flex items-center gap-2 text-[12px] font-extrabold text-ember">
              <ShieldIcon className="h-3.5 w-3.5" />
              الحلقات محميّة بجلسة مستخدم
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-mist-300">
              خادم التشغيل في الموقع المصدر يرفض كشف الروابط دون دخول. أضف بيانات حسابك أو
              كعكة الجلسة لمتابعة الاستخراج.
            </p>
            <Button variant="outline" size="sm" className="mt-2.5" onClick={onOpenSettings}>
              فتح الإعدادات
            </Button>
          </div>
        ) : null}

        {attention.length === 0 ? (
          <EmptyNote>
            <span className="inline-flex items-center gap-1.5 text-mint">
              <CheckIcon className="h-3.5 w-3.5" />
              كل شيء يسير بسلاسة
            </span>
          </EmptyNote>
        ) : (
          <ul className="space-y-2">
            {attention.slice(0, 6).map((item) => (
              <AttentionCard key={item.id} item={item} />
            ))}
          </ul>
        )}
      </section>

      <section className="panel flex min-h-[220px] flex-1 flex-col rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-display text-[12.5px] font-extrabold uppercase tracking-[0.14em] text-mist-300">
            <TerminalIcon className="h-3.5 w-3.5 text-amber-glow" />
            سجل النشاط
          </h3>
          <button
            onClick={async () => {
              await fetch("/api/logs", { method: "DELETE" });
              setLog([]);
              lastId.current = 0;
            }}
            className="focus-ring inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-mist-400 transition-colors hover:text-rose-alert"
          >
            <TrashIcon className="h-3 w-3" />
            تفريغ
          </button>
        </div>
        <div ref={logRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto pl-1 font-mono text-[11px] leading-relaxed">
          {log.length === 0 ? (
            <p className="text-mist-400">لا أحداث بعد…</p>
          ) : (
            log.map((entry) => (
              <div key={entry.id} className="flex gap-2">
                <span className="shrink-0 tabular text-mist-400/70">
                  {clockTime(entry.createdAt)}
                </span>
                <span className={cn("shrink-0 text-[9.5px] font-bold uppercase", LEVEL_TONE[entry.level] ?? "text-mist-400")}>
                  {entry.scope}
                </span>
                <span className="min-w-0 flex-1 break-words text-mist-200">{entry.message}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </aside>
  );
}
