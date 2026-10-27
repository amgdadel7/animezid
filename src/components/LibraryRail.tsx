"use client";

import { useMemo, useState } from "react";
import { LayersIcon, PlusIcon, SearchIcon, StackIcon } from "@/components/icons";
import { Button, IconButton, ProgressBar, Ring } from "@/components/ui";
import { cn } from "@/lib/cn";
import { humanBytes, percent } from "@/lib/format";
import type { SeriesRow } from "@/lib/types";

export function LibraryRail({
  items,
  selectedId,
  onSelect,
  onImport,
}: {
  items: SeriesRow[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onImport: () => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((s) =>
      [s.title, s.originalTitle ?? "", s.slug ?? ""].join(" ").toLowerCase().includes(q),
    );
  }, [items, query]);

  return (
    <aside className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-1 pb-3">
        <h2 className="flex items-center gap-2 font-display text-[12.5px] font-extrabold uppercase tracking-[0.16em] text-mist-300">
          <StackIcon className="h-3.5 w-3.5 text-amber-glow" />
          المكتبة
          <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10.5px] tabular text-mist-300">
            {items.length}
          </span>
        </h2>
        <IconButton label="استيراد سلسلة جديدة" onClick={onImport}>
          <PlusIcon className="h-4 w-4" />
        </IconButton>
      </div>

      <div className="relative mb-3">
        <SearchIcon className="pointer-events-none absolute inset-y-0 right-3 my-auto h-3.5 w-3.5 text-mist-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحث في المكتبة…"
          className="focus-ring h-9 w-full rounded-lg border border-white/[0.08] bg-ink-950/60 pr-9 pl-3 text-[12.5px] text-mist-100 placeholder:text-mist-400/70 focus:border-amber-glow/50"
        />
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pl-1">
        {filtered.length === 0 ? (
          <p className="rounded-lg border border-dashed border-white/10 px-3 py-6 text-center text-[11.5px] leading-relaxed text-mist-400">
            {items.length === 0
              ? "المكتبة فارغة. استورد رابط حلقة للبدء."
              : "لا نتائج مطابقة للبحث."}
          </p>
        ) : null}

        {filtered.map((s) => {
          const done = percent(s.doneCount, s.episodeCount);
          const active = selectedId === s.id;
          return (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={cn(
                "group focus-ring relative flex w-full items-center gap-3 overflow-hidden rounded-xl border p-2.5 text-right transition-all duration-200",
                active
                  ? "border-amber-glow/45 bg-[linear-gradient(100deg,rgba(247,183,51,0.12),rgba(255,107,61,0.05))]"
                  : "border-white/[0.06] bg-white/[0.018] hover:border-white/16 hover:bg-white/[0.045]",
              )}
            >
              {active ? (
                <span className="absolute inset-y-2 right-0 w-[2.5px] rounded-full bg-[linear-gradient(180deg,#f7b733,#ff6b3d)]" />
              ) : null}

              <span className="relative grid h-12 w-9 shrink-0 place-items-center overflow-hidden rounded-md border border-white/10 bg-ink-800">
                {s.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={s.posterUrl}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="font-display text-[13px] font-black text-amber-glow/80">
                    {s.title.trim().charAt(0)}
                  </span>
                )}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "truncate font-display text-[13px] font-extrabold",
                      active ? "text-mist-100" : "text-mist-200",
                    )}
                  >
                    {s.title}
                  </span>
                  {s.activeCount > 0 ? (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-glow pulse-ring" />
                  ) : null}
                </span>
                <span className="mt-1 flex items-center gap-2 text-[10.5px] text-mist-400">
                  <span className="inline-flex items-center gap-1">
                    <LayersIcon className="h-3 w-3" />
                    {s.seasonCount} موسم
                  </span>
                  <span className="tabular">{s.doneCount}/{s.episodeCount} حلقة</span>
                  <span className="tabular">{humanBytes(s.totalBytes)}</span>
                </span>
                <span className="mt-1.5 block">
                  <ProgressBar
                    value={done}
                    tone={done === 100 ? "mint" : "amber"}
                    className="h-1"
                  />
                </span>
              </span>

              <Ring value={done} size={34} stroke={3}>
                {done > 0 ? `${done}` : ""}
              </Ring>
            </button>
          );
        })}
      </div>

      <div className="mt-3 border-t border-white/[0.07] pt-3">
        <Button variant="primary" size="sm" className="w-full" onClick={onImport}>
          <PlusIcon className="h-4 w-4" />
          استيراد موسم جديد
        </Button>
      </div>
    </aside>
  );
}
