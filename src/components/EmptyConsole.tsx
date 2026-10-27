"use client";

import { useState } from "react";
import {
  AnchorMark,
  BoltIcon,
  DownloadIcon,
  LayersIcon,
  RadarIcon,
  StackIcon,
} from "@/components/icons";
import { Button, Chip } from "@/components/ui";

const EXAMPLES = [
  {
    label: "المحقق كونان — الحلقة 1",
    url: "https://animezid.org/watch.php?vid=a65f39474",
  },
  { label: "موسم كامل", url: "https://animezid.org/series/detective-conan-ar/season/1/" },
];

const PIPELINE = [
  {
    n: "01",
    icon: <StackIcon className="h-4 w-4" />,
    title: "استيراد الموسم",
    body: "اقرأ رابط حلقة واحدة فيكتشف المِرفأ السلسلة وكل مواسمها وحلقاتها مع العناوين والملصقات.",
  },
  {
    n: "02",
    icon: <RadarIcon className="h-4 w-4" />,
    title: "استخراج المصدر",
    body: "تُنشأ جلسة تشغيل لكل حلقة لدى الموقع المصدر لكشف رابط البث الحقيقي: MP4 مباشر أو HLS مُجزّأ.",
  },
  {
    n: "03",
    icon: <BoltIcon className="h-4 w-4" />,
    title: "طابور التنزيل",
    body: "تنزيل متوازٍ قابل للضبط، مع تفكيك تجزئة HLS وفكّ تشفير AES-128، وتتبع حيّ للسرعة والإلغاء.",
  },
  {
    n: "04",
    icon: <DownloadIcon className="h-4 w-4" />,
    title: "مكتبة مرتّبة",
    body: "تُحفظ الملفات باسم السلسلة/الموسم/الحلقة، وتُشغَّل مباشرة داخل المتصفح أو تُصدَّر إلى جهازك.",
  },
];

export function EmptyConsole({
  onImport,
  busy,
}: {
  onImport: (url: string) => Promise<void>;
  busy: boolean;
}) {
  const [url, setUrl] = useState(EXAMPLES[0].url);

  return (
    <section className="flex h-full min-h-0 flex-col justify-center gap-6 py-4">
      <div className="panel relative overflow-hidden rounded-2xl p-6 sm:p-8">
        <div className="pointer-events-none absolute -top-24 left-1/3 h-64 w-64 rounded-full bg-amber-glow/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 right-10 h-72 w-72 rounded-full bg-ember/10 blur-3xl" />

        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-glow/25 bg-amber-glow/[0.08] px-3 py-1 text-[11px] font-extrabold tracking-wide text-amber-glow">
              <AnchorMark className="h-3.5 w-3.5" />
              مِرْفأ · أرشفة المواسم
            </span>
            <h1 className="mt-3.5 font-display text-[clamp(1.7rem,3.4vw,2.6rem)] font-black leading-[1.18] text-mist-100">
              اسحب موسمًا كاملًا من موقع المشاهدة
              <span className="block text-[linear-gradient(90deg,#f7b733,#ff6b3d)] bg-clip-text text-transparent">
                إلى مكتبتك على القرص.
              </span>
            </h1>
            <p className="mt-3 text-[13px] leading-relaxed text-mist-300">
              الصق رابط أي حلقة، وسيتولّى المِرفأ الباقي: اكتشاف المواسم، ترقيم الحلقات،
              استخراج مصادر الفيديو، ثم تنزيلها عبر طابور متوازٍ مع متابعة حيّة للتقدّم.
            </p>
          </div>

          <div className="w-full max-w-md rounded-2xl border border-white/[0.09] bg-ink-950/70 p-4">
            <label className="mb-2 block text-[11.5px] font-extrabold uppercase tracking-[0.12em] text-mist-400">
              رابط الحلقة أو الموسم
            </label>
            <div className="flex gap-2">
              <input
                dir="ltr"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !busy) void onImport(url.trim());
                }}
                className="focus-ring h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-ink-900 px-3 text-left font-mono text-[11.5px] text-mist-100 placeholder:text-mist-400/60 focus:border-amber-glow/60"
                placeholder="https://animezid.org/watch.php?vid=…"
              />
              <Button
                variant="primary"
                className="h-11 shrink-0"
                loading={busy}
                onClick={() => void onImport(url.trim())}
              >
                {busy ? "جارٍ القراءة" : "استيراد"}
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button key={ex.url} onClick={() => setUrl(ex.url)} className="focus-ring">
                  <Chip tone={url === ex.url ? "amber" : "neutral"}>{ex.label}</Chip>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[10.5px] leading-relaxed text-mist-400">
              الحلقات المحميّة تتطلب جلسة مستخدم — أضفها من الإعدادات بعد الاستيراد.
            </p>
          </div>
        </div>
      </div>

      <div className="relative">
        <div className="absolute right-6 left-6 top-[26px] hidden h-px bg-[linear-gradient(90deg,transparent,rgba(247,183,51,0.35),rgba(255,107,61,0.25),transparent)] lg:block" />
        <ol className="grid gap-3 lg:grid-cols-4">
          {PIPELINE.map((step) => (
            <li
              key={step.n}
              className="panel-flat relative rounded-xl p-4 transition-colors hover:border-amber-glow/30"
            >
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-lg border border-amber-glow/30 bg-amber-glow/[0.09] text-amber-glow">
                  {step.icon}
                </span>
                <span className="tabular text-[11px] font-black text-mist-400">{step.n}</span>
              </div>
              <h3 className="mt-2.5 flex items-center gap-1.5 font-display text-[13.5px] font-extrabold text-mist-100">
                {step.title}
                {step.n === "02" ? <LayersIcon className="h-3.5 w-3.5 text-mist-400" /> : null}
              </h3>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-mist-400">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
