import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function AnchorMark(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="5" r="2.4" />
      <path d="M12 7.4V21" />
      <path d="M8 10.5h8" />
      <path d="M4.5 15.2c1.6 3.6 4.3 5.6 7.5 5.8 3.2-.2 5.9-2.2 7.5-5.8" />
    </svg>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3v11" />
      <path d="m7.5 10.5 4.5 4 4.5-4" />
      <path d="M4 18.5h16" />
    </svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M8 5.5v13l10-6.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="7" y="5.5" width="3.4" height="13" rx="1" fill="currentColor" stroke="none" />
      <rect x="13.6" y="5.5" width="3.4" height="13" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function StopIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function RadarIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <path d="M12 12 18 7" />
    </svg>
  );
}

export function LayersIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m12 3 8.5 4.5L12 12 3.5 7.5z" />
      <path d="m4.6 12 7.4 3.9 7.4-3.9" />
      <path d="m4.6 16.4 7.4 3.9 7.4-3.9" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

export function GearIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M19.6 14.3a1.6 1.6 0 0 0 .32 1.77l.06.06a1.94 1.94 0 1 1-2.75 2.75l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-.97 1.47v.17a1.94 1.94 0 1 1-3.88 0v-.09a1.6 1.6 0 0 0-1.05-1.47 1.6 1.6 0 0 0-1.77.32l-.06.06A1.94 1.94 0 1 1 4.92 16.2l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.47-.97h-.17a1.94 1.94 0 1 1 0-3.88h.09a1.6 1.6 0 0 0 1.47-1.05 1.6 1.6 0 0 0-.32-1.77l-.06-.06A1.94 1.94 0 1 1 7.8 4.92l.06.06a1.6 1.6 0 0 0 1.77.32h.08a1.6 1.6 0 0 0 .97-1.47v-.17a1.94 1.94 0 1 1 3.88 0v.09a1.6 1.6 0 0 0 .97 1.47 1.6 1.6 0 0 0 1.77-.32l.06-.06a1.94 1.94 0 1 1 2.75 2.75l-.06.06a1.6 1.6 0 0 0-.32 1.77v.08a1.6 1.6 0 0 0 1.47.97h.17a1.94 1.94 0 1 1 0 3.88h-.09a1.6 1.6 0 0 0-1.44.94z" />
    </svg>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
      <path d="M20.7 4.4v4.9h-4.9" />
    </svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4.5 6.5h15" />
      <path d="M9.5 6.5V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" />
      <path d="M6.6 6.5 7.5 20a1.3 1.3 0 0 0 1.3 1.2h6.4A1.3 1.3 0 0 0 16.5 20l.9-13.5" />
      <path d="M10.4 10.5v6.6M13.6 10.5v6.6" />
    </svg>
  );
}

export function LinkIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10.2 13.8a3.6 3.6 0 0 0 5.4.4l2.6-2.6a3.6 3.6 0 0 0-5.1-5.1l-1.5 1.5" />
      <path d="M13.8 10.2a3.6 3.6 0 0 0-5.4-.4l-2.6 2.6a3.6 3.6 0 0 0 5.1 5.1l1.5-1.5" />
    </svg>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 7.2A1.7 1.7 0 0 1 5.2 5.5h3.4l1.8 2.1h8.4a1.7 1.7 0 0 1 1.7 1.7v7.5a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7z" />
    </svg>
  );
}

export function FilmIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.2" />
      <path d="M3.2 9.4h17.6M3.2 14.6h17.6M8 4.6v14.8M16 4.6v14.8" />
    </svg>
  );
}

export function BoltIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M13.2 2.5 4.8 13.4h6L10.4 21.5l8.8-11.2h-6.4z" />
    </svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.2 5 6v5.6c0 4.2 2.9 7.6 7 9.2 4.1-1.6 7-5 7-9.2V6z" />
      <path d="m9.3 12.1 1.9 1.9 3.6-3.9" />
    </svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 4.2 2.9 19.4h18.2z" />
      <path d="M12 9.6v4.2M12 16.6h.01" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m5 12.6 4.6 4.4L19 6.8" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="11" cy="11" r="6.6" />
      <path d="m16 16 4.4 4.4" />
    </svg>
  );
}

export function StackIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3.4" y="4.2" width="17.2" height="4.6" rx="1.4" />
      <rect x="3.4" y="10.7" width="17.2" height="4.6" rx="1.4" />
      <rect x="3.4" y="17.2" width="17.2" height="2.6" rx="1.3" />
    </svg>
  );
}

export function TerminalIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="4.4" width="18" height="15.2" rx="2.2" />
      <path d="m7.4 9.6 3 2.6-3 2.6M13 15.2h3.8" />
    </svg>
  );
}

export function SpinnerIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5" opacity="0.9" />
    </svg>
  );
}
