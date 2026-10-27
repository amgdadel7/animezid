import { promises as fs } from "node:fs";
import path from "node:path";

export {
  humanBytes,
  humanRate,
  humanEta,
  relativeTimeAr,
} from "@/lib/format";

const ARABIC_STOPWORDS = /^(من|في|على|عن|إلى|انمي|anime)$/i;

/** Build a filesystem-safe name from Arabic/English text. */
export function safeName(input: string, fallback = "item"): string {
  const cleaned = input
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || fallback).slice(0, 120);
}

export function padNumber(n: number, size = 2): string {
  return String(Math.max(0, Math.trunc(n))).padStart(size, "0");
}

export async function ensureDir(dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function statSize(p: string): Promise<number> {
  try {
    const s = await fs.stat(p);
    return s.size;
  } catch {
    return 0;
  }
}

export async function removeFile(p: string): Promise<void> {
  try {
    await fs.rm(p, { force: true });
  } catch {
    /* ignore */
  }
}

export async function dirSize(dir: string): Promise<number> {
  let total = 0;
  const stack: string[] = [dir];
  while (stack.length) {
    const current = stack.pop();
    if (!current) break;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) total += await statSize(full);
    }
  }
  return total;
}

export function guessExtension(url: string, contentType?: string | null): string {
  if (contentType) {
    if (/mpegurl/i.test(contentType)) return ".ts";
    if (/mp4/i.test(contentType)) return ".mp4";
    if (/webm/i.test(contentType)) return ".webm";
    if (/matroska/i.test(contentType)) return ".mkv";
  }
  const m = url.match(/\.(mp4|m4v|webm|mkv|ts|m3u8)(?:\?|#|$)/i);
  if (m) return m[1].toLowerCase() === "m3u8" ? ".ts" : `.${m[1].toLowerCase()}`;
  return ".mp4";
}

export function isStopword(token: string) {
  return ARABIC_STOPWORDS.test(token);
}
