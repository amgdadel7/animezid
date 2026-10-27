import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { episodes } from "@/db/schema";
import { fail } from "@/lib/api";
import { safeName } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Extension wins over the stored type.
 *
 * File hosts commonly serve video as `application/octet-stream`; trusting that
 * would make browsers download instead of playing inline, and would break the
 * in-app <video> player.
 */
function mimeFor(filePath: string, stored?: string | null) {
  if (/\.m4v$/i.test(filePath)) return "video/x-m4v";
  if (/\.mp4$/i.test(filePath)) return "video/mp4";
  if (/\.webm$/i.test(filePath)) return "video/webm";
  if (/\.mkv$/i.test(filePath)) return "video/x-matroska";
  if (/\.(ts|m2ts)$/i.test(filePath)) return "video/mp2t";
  if (stored && !/octet-stream/i.test(stored)) return stored;
  return "video/mp4";
}

/** GET /api/stream?id=123&download=1 — serve a downloaded episode with range support. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = Number.parseInt(url.searchParams.get("id") ?? "", 10);
  if (!Number.isFinite(id)) return fail("معرّف غير صالح");

  const [ep] = await db
    .select({
      filePath: episodes.filePath,
      fileName: episodes.fileName,
      title: episodes.title,
      mimeType: episodes.mimeType,
      fileSize: episodes.fileSize,
    })
    .from(episodes)
    .where(eq(episodes.id, id))
    .limit(1);

  if (!ep?.filePath) return fail("لا يوجد ملف محفوظ لهذه الحلقة", 404);

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(ep.filePath);
  } catch {
    return fail("الملف غير موجود على القرص", 410);
  }

  const type = mimeFor(ep.filePath, ep.mimeType);
  const filename = `${safeName(ep.title, "episode")}${
    /\.ts$/i.test(ep.filePath) ? ".ts" : /\.webm$/i.test(ep.filePath) ? ".webm" : ".mp4"
  }`;
  const wantsDownload = url.searchParams.get("download") === "1";

  const range = req.headers.get("range");
  const baseHeaders: Record<string, string> = {
    "Accept-Ranges": "bytes",
    "Content-Type": type,
    "Cache-Control": "private, max-age=0, must-revalidate",
    ...(wantsDownload
      ? {
          "Content-Disposition": `attachment; filename="episode"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        }
      : {
          "Content-Disposition": `inline; filename="episode"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        }),
  };

  if (!range) {
    const stream = Readable.toWeb(createReadStream(ep.filePath)) as ReadableStream;
    return new Response(stream, {
      status: 200,
      headers: { ...baseHeaders, "Content-Length": String(stat.size) },
    });
  }

  const m = /bytes=(\d*)-(\d*)/.exec(range);
  if (!m) return fail("نطاق غير صالح", 416);
  const start = m[1] ? Number.parseInt(m[1], 10) : 0;
  const end = m[2] ? Math.min(Number.parseInt(m[2], 10), stat.size - 1) : stat.size - 1;
  if (start >= stat.size || end < start) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${stat.size}` },
    });
  }

  const stream = Readable.toWeb(
    createReadStream(ep.filePath, { start, end }),
  ) as ReadableStream;
  return new Response(stream, {
    status: 206,
    headers: {
      ...baseHeaders,
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Content-Length": String(end - start + 1),
    },
  });
}
