"use client";

import { useState } from "react";
import {
  BoltIcon,
  CheckIcon,
  AlertIcon,
  LayersIcon,
  LinkIcon,
  StackIcon,
} from "@/components/icons";
import { Button, Chip, Field, Modal, inputClass } from "@/components/ui";

const EXAMPLE = "https://animezid.org/watch.php?vid=a65f39474";

interface Summary {
  seriesTitle: string;
  seasonNumber: number;
  episodesAdded: number;
  episodesExisting: number;
  seasonsDiscovered: number;
  warnings: string[];
}

export function ImportDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (seriesId: number, seasonId: number) => void;
}) {
  const [tab, setTab] = useState<"single" | "bulk">("single");
  const [url, setUrl] = useState("");
  const [bulk, setBulk] = useState("");
  const [autoResolve, setAutoResolve] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [bulkLog, setBulkLog] = useState<string[]>([]);

  async function submitSingle() {
    setError(null);
    setSummary(null);
    const target = url.trim() || EXAMPLE;
    if (!/^https?:\/\//i.test(target)) {
      setError("الرابط غير صالح — يجب أن يبدأ بـ https://");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/series", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: target, autoResolve }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "فشل الاستيراد");
      const d = json.data as Summary & { seriesId: number; seasonId: number };
      setSummary(d);
      onImported(d.seriesId, d.seasonId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل الاستيراد");
    } finally {
      setBusy(false);
    }
  }

  async function submitBulk() {
    setError(null);
    setSummary(null);
    setBulkLog([]);
    const lines = bulk
      .split(/\r?\n|,|\s{2,}/)
      .map((l) => l.trim())
      .filter((l) => /^https?:\/\//i.test(l) || /^[A-Za-z0-9]{6,24}$/.test(l));
    if (lines.length === 0) {
      setError("الصق رابطًا واحدًا على الأقل في كل سطر");
      return;
    }
    setBusy(true);
    let added = 0;
    let failed = 0;
    let lastSeries = 0;
    let lastSeason = 0;
    for (const line of lines) {
      try {
        const res = await fetch("/api/series", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: line, autoResolve }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error ?? "فشل");
        added += json.data.episodesAdded ?? 0;
        lastSeries = json.data.seriesId;
        lastSeason = json.data.seasonId;
        setBulkLog((prev) => [
          ...prev,
          `✓ ${json.data.seriesTitle} — الموسم ${json.data.seasonNumber} (+${json.data.episodesAdded} حلقة)`,
        ]);
      } catch (err) {
        failed += 1;
        setBulkLog((prev) => [
          ...prev,
          `✗ ${line} — ${err instanceof Error ? err.message : "فشل"}`,
        ]);
      }
    }
    setBusy(false);
    if (lastSeries) onImported(lastSeries, lastSeason);
    setSummary({
      seriesTitle: `${lines.length} رابط`,
      seasonNumber: 0,
      episodesAdded: added,
      episodesExisting: 0,
      seasonsDiscovered: lines.length,
      warnings: failed > 0 ? [`فشل استيراد ${failed} رابط`] : [],
    });
  }

  const tabs = [
    { key: "single" as const, label: "رابط واحد", icon: <LinkIcon className="h-3.5 w-3.5" /> },
    { key: "bulk" as const, label: "دفعة روابط", icon: <StackIcon className="h-3.5 w-3.5" /> },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="استيراد موسم من موقع المشاهدة"
      subtitle="الصق رابط أي حلقة، فيقوم المِرفأ بقراءة السلسلة واستخراج كل المواسم والحلقات المرتبطة بها."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            إغلاق
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={tab === "single" ? submitSingle : submitBulk}
          >
            {!busy ? <BoltIcon className="h-4 w-4" /> : null}
            {tab === "single" ? "ابدأ الاستيراد" : `استيراد ${bulk ? bulk.split(/\r?\n/).filter(Boolean).length : 0} رابط`}
          </Button>
        </>
      }
    >
      <div className="mb-4 inline-flex rounded-xl border border-white/10 bg-ink-950/60 p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12.5px] font-bold transition-colors ${
              tab === t.key
                ? "bg-[linear-gradient(135deg,#f7b733,#ff6b3d)] text-ink-950"
                : "text-mist-300 hover:text-mist-100"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === "single" ? (
        <Field
          label="رابط الحلقة أو الموسم"
          hint={`مثال: ${EXAMPLE} — يُقبل أيضًا معرّف الحلقة وحده.`}
        >
          <input
            dir="ltr"
            className={`${inputClass} text-left font-mono`}
            placeholder={EXAMPLE}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) void submitSingle();
            }}
          />
        </Field>
      ) : (
        <Field
          label="روابط متعددة (سطر لكل رابط)"
          hint="مناسب لإضافة عدة مواسم أو عدة سلاسل دفعة واحدة."
        >
          <textarea
            dir="ltr"
            rows={7}
            className={`${inputClass} resize-y text-left font-mono text-[12.5px] leading-relaxed`}
            placeholder={`${EXAMPLE}\nhttps://animezid.org/watch.php?vid=6764ef895`}
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
          />
        </Field>
      )}

      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5 transition-colors hover:border-amber-glow/35">
        <input
          type="checkbox"
          checked={autoResolve}
          onChange={(e) => setAutoResolve(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[#f7b733]"
        />
        <span>
          <span className="block text-[13px] font-bold text-mist-100">
            استخراج مصادر الفيديو تلقائيًا بعد الاستيراد
          </span>
          <span className="mt-1 block text-[11.5px] leading-relaxed text-mist-400">
            يمرّ المِرفأ على كل حلقة ويطلب جلسة التشغيل من الموقع لكشف رابط البث
            (MP4 أو HLS). الحلقات المحمية تحتاج بيانات دخول في الإعدادات.
          </span>
        </span>
      </label>

      {error ? (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-rose-alert/30 bg-rose-alert/[0.08] p-3.5 text-[12.5px] leading-relaxed text-rose-alert">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {bulkLog.length > 0 ? (
        <div className="mt-4 max-h-40 overflow-y-auto rounded-xl border border-white/[0.08] bg-ink-950/70 p-3 font-mono text-[11.5px] leading-relaxed text-mist-300">
          {bulkLog.map((line, i) => (
            <div key={i} className={line.startsWith("✗") ? "text-rose-alert" : "text-mint"}>
              {line}
            </div>
          ))}
        </div>
      ) : null}

      {summary ? (
        <div className="rise-in mt-4 rounded-xl border border-mint/25 bg-mint/[0.06] p-4">
          <div className="flex items-center gap-2 text-[13px] font-extrabold text-mint">
            <CheckIcon className="h-4 w-4" />
            تم استيراد «{summary.seriesTitle}»
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {summary.seasonNumber > 0 ? (
              <Chip tone="amber">
                <LayersIcon className="h-3 w-3" />
                الموسم {summary.seasonNumber}
              </Chip>
            ) : null}
            <Chip tone="sky">مواسم مكتشفة: {summary.seasonsDiscovered}</Chip>
            <Chip tone="mint">حلقات جديدة: {summary.episodesAdded}</Chip>
            {summary.episodesExisting > 0 ? (
              <Chip>موجودة مسبقًا: {summary.episodesExisting}</Chip>
            ) : null}
          </div>
          {summary.warnings.length > 0 ? (
            <ul className="mt-3 space-y-1 text-[11.5px] leading-relaxed text-mist-300">
              {summary.warnings.map((w, i) => (
                <li key={i}>• {w}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
