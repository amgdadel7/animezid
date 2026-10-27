import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** An anime series (e.g. "المحقق كونان") imported from a source site. */
export const series = pgTable(
  "series",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    originalTitle: text("original_title"),
    slug: text("slug"),
    source: text("source").notNull().default("animezid"),
    sourceUrl: text("source_url"),
    posterUrl: text("poster_url"),
    backdropUrl: text("backdrop_url"),
    synopsis: text("synopsis"),
    genres: jsonb("genres").$type<string[]>().default(sql`'[]'::jsonb`),
    year: text("year"),
    language: text("language"),
    quality: text("quality"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("series_source_url_uidx").on(t.sourceUrl)],
);

/** A season belonging to a series. */
export const seasons = pgTable(
  "seasons",
  {
    id: serial("id").primaryKey(),
    seriesId: integer("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    number: integer("number").notNull().default(1),
    title: text("title"),
    sourceUrl: text("source_url"),
    episodeCount: integer("episode_count").notNull().default(0),
    imported: boolean("imported").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("seasons_series_number_uidx").on(t.seriesId, t.number)],
);

export type ResolveStatus =
  | "idle"
  | "resolving"
  /** A directly downloadable media URL was extracted. */
  | "ready"
  /** Provider pages were unlocked but no auto-extractable media URL. */
  | "partial"
  | "needs_auth"
  | "failed";

export type DownloadStatus =
  | "idle"
  | "queued"
  | "downloading"
  | "done"
  | "failed"
  | "canceled";

export interface EpisodeSource {
  label: string;
  /** Best known URL: direct media when resolved, otherwise the provider page. */
  url: string;
  type: "mp4" | "hls" | "webm" | "unknown";
  quality?: string;
  server?: string;
  /** Provider page kind reported by the playback API. */
  kind?: "direct" | "landing" | "launch" | "manual";
  /** Host the source belongs to (MegaMax, Uqload, File Upload, …). */
  provider?: string;
  /** Opaque source id used by the resolve endpoint. */
  sourceId?: string;
  /** "download" hosts yield files; "embedded_web" hosts are players. */
  sourceType?: string;
  /** How the direct URL was obtained, for diagnostics. */
  via?: string;
  /** What blocks an automatic pull on this host (cloudflare, dead-file, …). */
  gate?: string;
  /** Human-readable diagnosis shown next to the provider link. */
  note?: string;
}

/** A single episode row. */
export const episodes = pgTable(
  "episodes",
  {
    id: serial("id").primaryKey(),
    seasonId: integer("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    number: integer("number").notNull().default(1),
    title: text("title").notNull(),
    videoUniq: text("video_uniq"),
    watchUrl: text("watch_url"),
    posterUrl: text("poster_url"),
    durationLabel: text("duration_label"),
    sources: jsonb("sources").$type<EpisodeSource[]>().default(sql`'[]'::jsonb`),
    selectedSourceIndex: integer("selected_source_index").notNull().default(0),
    resolveStatus: text("resolve_status")
      .$type<ResolveStatus>()
      .notNull()
      .default("idle"),
    resolveError: text("resolve_error"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    downloadStatus: text("download_status")
      .$type<DownloadStatus>()
      .notNull()
      .default("idle"),
    progress: integer("progress").notNull().default(0),
    bytesDone: text("bytes_done").notNull().default("0"),
    bytesTotal: text("bytes_total").notNull().default("0"),
    speedBps: integer("speed_bps").notNull().default(0),
    segmentsDone: integer("segments_done").notNull().default(0),
    segmentsTotal: integer("segments_total").notNull().default(0),
    filePath: text("file_path"),
    fileName: text("file_name"),
    fileSize: text("file_size").notNull().default("0"),
    mimeType: text("mime_type"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("episodes_season_number_uidx").on(t.seasonId, t.number),
    uniqueIndex("episodes_watch_url_uidx").on(t.watchUrl),
  ],
);

/** Async work items processed by the in-process worker. */
export const jobs = pgTable("jobs", {
  id: serial("id").primaryKey(),
  episodeId: integer("episode_id").references(() => episodes.id, {
    onDelete: "cascade",
  }),
  kind: text("kind").notNull().default("download"),
  status: text("status").notNull().default("pending"),
  message: text("message"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

/** Key/value app settings (site credentials, worker tuning, storage dir). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Human readable activity feed surfaced in the UI. */
export const activityLog = pgTable("activity_log", {
  id: serial("id").primaryKey(),
  level: text("level").notNull().default("info"),
  scope: text("scope").notNull().default("system"),
  message: text("message").notNull(),
  episodeId: integer("episode_id"),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
