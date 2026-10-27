/** Client-safe view of where the app is trying to connect. */
export interface DbTargetView {
  label: string;
  host: string;
  port: number;
  database: string;
  user: string;
  ssl: boolean;
  origin: "DATABASE_URL" | "SUPABASE_ENV" | "PG_ENV" | "default-local";
}

export interface SeriesRow {
  id: number;
  title: string;
  originalTitle: string | null;
  slug: string | null;
  posterUrl: string | null;
  sourceUrl: string | null;
  year: string | null;
  language: string | null;
  quality: string | null;
  genres: string[] | null;
  createdAt: string;
  seasonCount: number;
  episodeCount: number;
  doneCount: number;
  activeCount: number;
  totalBytes: string;
}

export interface SourceView {
  label: string;
  url: string;
  type: "mp4" | "hls" | "webm" | "unknown";
  quality?: string;
  server?: string;
  /** direct = pullable by the worker, landing = provider page to open. */
  kind?: "direct" | "landing" | "launch" | "manual";
  provider?: string;
  sourceId?: string;
  sourceType?: string;
  via?: string;
  /** What blocks an automatic pull (cloudflare, dead-file, adblock-wall, …). */
  gate?: string;
  /** Human-readable diagnosis for the provider row. */
  note?: string;
}

export interface EpisodeView {
  id: number;
  seasonId: number;
  number: number;
  title: string;
  videoUniq: string | null;
  watchUrl: string | null;
  posterUrl: string | null;
  durationLabel: string | null;
  sources: SourceView[] | null;
  selectedSourceIndex: number;
  resolveStatus: string;
  resolveError: string | null;
  resolvedAt: string | null;
  downloadStatus: string;
  progress: number;
  bytesDone: string;
  bytesTotal: string;
  speedBps: number;
  segmentsDone: number;
  segmentsTotal: number;
  filePath: string | null;
  fileName: string | null;
  fileSize: string;
  mimeType: string | null;
  error: string | null;
  attempts: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SeasonView {
  id: number;
  seriesId: number;
  number: number;
  title: string | null;
  sourceUrl: string | null;
  episodeCount: number;
  imported: boolean;
  createdAt: string;
  updatedAt: string;
  episodes: EpisodeView[];
}

export interface SeriesDetail {
  series: {
    id: number;
    title: string;
    originalTitle: string | null;
    slug: string | null;
    source: string;
    sourceUrl: string | null;
    posterUrl: string | null;
    backdropUrl: string | null;
    synopsis: string | null;
    genres: string[] | null;
    year: string | null;
    language: string | null;
    quality: string | null;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
  seasons: SeasonView[];
}

export interface MovingEpisode {
  id: number;
  progress: number;
  downloadStatus: string;
  resolveStatus: string;
  bytesDone: string;
  bytesTotal: string;
  speedBps: number;
  segmentsDone: number;
  segmentsTotal: number;
  error: string | null;
}

export interface LogEntry {
  id: number;
  level: string;
  scope: string;
  message: string;
  episodeId: number | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export interface AttentionItem {
  id: number;
  title: string;
  resolveStatus: string;
  resolveError: string | null;
  downloadStatus: string;
  error: string | null;
  seasonId: number;
  seasonTitle: string | null;
  seriesTitle: string | null;
}

export interface BulkRunView {
  key: string;
  label: string;
  total: number;
  processed: number;
  queued: number;
  resolved: number;
  skipped: number;
  failed: number;
  startedAt: number;
  running: boolean;
  finishedAt: number | null;
  lastMessage: string;
}

export interface StatePayload {
  bulk: BulkRunView[];
  stats: {
    seriesCount: number;
    seasonCount: number;
    episodeCount: number;
    totalBytes: string;
    downloadByStatus: Record<string, number>;
    resolveByStatus: Record<string, number>;
  };
  queue: { activeIds: number[]; activeCount: number };
  moving: MovingEpisode[];
  readyToDownload: number;
  needsAttention: AttentionItem[];
  log: LogEntry[];
  settings: {
    concurrency: number;
    downloadDir: string;
    autoResolveOnImport: boolean;
    autoDownloadOnResolve: boolean;
    preferredQuality: string;
    hasCookie: boolean;
    hasCredentials: boolean;
  };
}
