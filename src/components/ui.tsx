"use client";

import {
  useEffect,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { CloseIcon, SpinnerIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

type Variant = "primary" | "ghost" | "outline" | "danger" | "mint";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-[linear-gradient(135deg,#f7b733_0%,#ff6b3d_100%)] text-ink-950 hover:brightness-110 shadow-[0_10px_28px_-14px_rgba(255,140,60,0.9)] font-bold",
  mint: "bg-mint/15 text-mint border border-mint/35 hover:bg-mint/25",
  ghost: "text-mist-300 hover:text-mist-100 hover:bg-white/[0.06]",
  outline:
    "border border-white/12 text-mist-200 hover:border-amber-glow/50 hover:text-amber-glow bg-white/[0.02]",
  danger:
    "border border-rose-alert/35 text-rose-alert hover:bg-rose-alert/12 bg-rose-alert/[0.06]",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[12.5px] gap-1.5 rounded-lg",
  md: "h-10 px-4 text-[13.5px] gap-2 rounded-xl",
  lg: "h-12 px-6 text-[15px] gap-2.5 rounded-xl",
};

export function Button({
  variant = "outline",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        "focus-ring inline-flex items-center justify-center whitespace-nowrap transition-all duration-150 active:scale-[0.975] disabled:pointer-events-none disabled:opacity-45",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {loading ? <SpinnerIcon className="spin-slow h-4 w-4" /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...rest}
      title={label}
      aria-label={label}
      className={cn(
        "focus-ring inline-grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-mist-300 transition-colors hover:border-amber-glow/45 hover:text-amber-glow disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Chip({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "amber" | "mint" | "rose" | "sky";
  className?: string;
}) {
  const tones = {
    neutral: "border-white/10 bg-white/[0.04] text-mist-300",
    amber: "border-amber-glow/30 bg-amber-glow/10 text-amber-glow",
    mint: "border-mint/30 bg-mint/10 text-mint",
    rose: "border-rose-alert/30 bg-rose-alert/10 text-rose-alert",
    sky: "border-sky-soft/30 bg-sky-soft/10 text-sky-soft",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-[3px] text-[11.5px] font-semibold leading-none",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusDot({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const map: Record<string, string> = {
    done: "bg-mint",
    ready: "bg-mint",
    partial: "bg-sky-soft",
    downloading: "bg-amber-glow",
    resolving: "bg-amber-glow",
    queued: "bg-sky-soft",
    failed: "bg-rose-alert",
    needs_auth: "bg-ember",
    canceled: "bg-mist-400",
    idle: "bg-mist-500/60",
  };
  const color = map[status] ?? "bg-mist-400";
  const live = status === "downloading" || status === "resolving";
  return (
    <span className={cn("relative inline-flex h-2 w-2", className)}>
      {live ? (
        <span className={cn("absolute inset-0 animate-ping rounded-full opacity-70", color)} />
      ) : null}
      <span className={cn("relative h-2 w-2 rounded-full", color)} />
    </span>
  );
}

export function ProgressBar({
  value,
  active = false,
  tone = "amber",
  className,
}: {
  value: number;
  active?: boolean;
  tone?: "amber" | "mint" | "sky";
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const fills = {
    amber: "bg-[linear-gradient(90deg,#f7b733,#ff6b3d)]",
    mint: "bg-[linear-gradient(90deg,#3ddc97,#59c2ff)]",
    sky: "bg-[linear-gradient(90deg,#59c2ff,#8f7bff)]",
  } as const;
  return (
    <div
      className={cn(
        "relative h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]",
        className,
      )}
    >
      <div
        className={cn(
          "relative h-full overflow-hidden rounded-full transition-[width] duration-500 ease-out",
          fills[tone],
        )}
        style={{ width: `${clamped}%` }}
      >
        {active ? <span className="shimmer absolute inset-0 block" /> : null}
      </div>
    </div>
  );
}

export function Ring({
  value,
  size = 40,
  stroke = 3.5,
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.09)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#ringGrad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (clamped / 100) * c}
          style={{ transition: "stroke-dashoffset 600ms cubic-bezier(.22,1,.36,1)" }}
        />
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f7b733" />
            <stop offset="100%" stopColor="#ff6b3d" />
          </linearGradient>
        </defs>
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[10.5px] font-bold tabular text-mist-200">
        {children}
      </span>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = "max-w-2xl",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 sm:p-6">
      <button
        aria-label="إغلاق"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink-950/78 backdrop-blur-[3px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "panel rise-in relative flex max-h-[88vh] w-full flex-col overflow-hidden rounded-2xl",
          width,
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-extrabold text-mist-100">{title}</h2>
            {subtitle ? (
              <p className="mt-1 text-[12.5px] leading-relaxed text-mist-400">{subtitle}</p>
            ) : null}
          </div>
          <IconButton label="إغلاق" onClick={onClose}>
            <CloseIcon className="h-4 w-4" />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-white/[0.07] bg-ink-850/60 px-5 py-3.5">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-[12.5px] font-bold text-mist-200">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-[11.5px] leading-relaxed text-mist-400">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "focus-ring w-full rounded-xl border border-white/10 bg-ink-950/70 px-3.5 py-2.5 text-[13.5px] text-mist-100 placeholder:text-mist-400/70 transition-colors hover:border-white/18 focus:border-amber-glow/60";

export function SectionTitle({
  icon,
  children,
  aside,
}: {
  icon?: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 font-display text-[13px] font-extrabold uppercase tracking-[0.14em] text-mist-300">
        {icon ? <span className="text-amber-glow">{icon}</span> : null}
        {children}
      </h3>
      {aside}
    </div>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-white/10 bg-white/[0.015] px-4 py-6 text-center text-[12.5px] leading-relaxed text-mist-400">
      {children}
    </p>
  );
}
