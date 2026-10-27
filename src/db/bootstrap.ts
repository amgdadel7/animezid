import "server-only";
import { sql as rawSql } from "drizzle-orm";

const DDL = `
create table if not exists "series" (
  "id" serial primary key,
  "title" text not null,
  "original_title" text,
  "slug" text,
  "source" text not null default 'animezid',
  "source_url" text,
  "poster_url" text,
  "backdrop_url" text,
  "synopsis" text,
  "genres" jsonb default '[]'::jsonb,
  "year" text,
  "language" text,
  "quality" text,
  "status" text not null default 'active',
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);
create unique index if not exists "series_source_url_uidx" on "series" ("source_url");

create table if not exists "seasons" (
  "id" serial primary key,
  "series_id" integer not null references "series"("id") on delete cascade,
  "number" integer not null default 1,
  "title" text,
  "source_url" text,
  "episode_count" integer not null default 0,
  "imported" boolean not null default false,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);
create unique index if not exists "seasons_series_number_uidx" on "seasons" ("series_id", "number");

create table if not exists "episodes" (
  "id" serial primary key,
  "season_id" integer not null references "seasons"("id") on delete cascade,
  "number" integer not null default 1,
  "title" text not null,
  "video_uniq" text,
  "watch_url" text,
  "poster_url" text,
  "duration_label" text,
  "sources" jsonb default '[]'::jsonb,
  "selected_source_index" integer not null default 0,
  "resolve_status" text not null default 'idle',
  "resolve_error" text,
  "resolved_at" timestamp with time zone,
  "download_status" text not null default 'idle',
  "progress" integer not null default 0,
  "bytes_done" text not null default '0',
  "bytes_total" text not null default '0',
  "speed_bps" integer not null default 0,
  "segments_done" integer not null default 0,
  "segments_total" integer not null default 0,
  "file_path" text,
  "file_name" text,
  "file_size" text not null default '0',
  "mime_type" text,
  "error" text,
  "attempts" integer not null default 0,
  "cancel_requested" boolean not null default false,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);
create unique index if not exists "episodes_season_number_uidx" on "episodes" ("season_id", "number");
create unique index if not exists "episodes_watch_url_uidx" on "episodes" ("watch_url");
create index if not exists "episodes_download_status_idx" on "episodes" ("download_status");
create index if not exists "episodes_resolve_status_idx" on "episodes" ("resolve_status");

create table if not exists "jobs" (
  "id" serial primary key,
  "episode_id" integer references "episodes"("id") on delete cascade,
  "kind" text not null default 'download',
  "status" text not null default 'pending',
  "message" text,
  "created_at" timestamp with time zone not null default now(),
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone
);

create table if not exists "settings" (
  "key" text primary key,
  "value" text,
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists "activity_log" (
  "id" serial primary key,
  "level" text not null default 'info',
  "scope" text not null default 'system',
  "message" text not null,
  "episode_id" integer,
  "meta" jsonb,
  "created_at" timestamp with time zone not null default now()
);
create index if not exists "activity_log_created_idx" on "activity_log" ("id" desc);
`;

let ensured = false;
let ensuring: Promise<void> | null = null;

/**
 * Create the schema idempotently on first use so the app works against a fresh
 * database (e.g. a new Supabase project) without running drizzle-kit by hand.
 */
export async function ensureSchema(executor: {
  execute: (q: ReturnType<typeof rawSql>) => Promise<unknown>;
}): Promise<void> {
  if (ensured) return;
  if (ensuring) return ensuring;
  ensuring = (async () => {
    for (const statement of DDL.split(/;\s*\n/)) {
      const trimmed = statement.trim();
      if (!trimmed) continue;
      await executor.execute(rawSql.raw(`${trimmed};`));
    }
    ensured = true;
  })().finally(() => {
    ensuring = null;
  });
  return ensuring;
}

export function resetSchemaFlag() {
  ensured = false;
}
