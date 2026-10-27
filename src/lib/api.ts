import { NextResponse } from "next/server";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "خطأ غير معروف";
  }
}

export async function readJson<T>(req: Request): Promise<Partial<T>> {
  try {
    const cloned = req.clone();
    return (await cloned.json()) as Partial<T>;
  } catch {
    return {};
  }
}

export function str(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

export function int(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (["1", "true", "on", "yes", "نعم"].includes(value.toLowerCase())) return true;
    if (["0", "false", "off", "no", "لا"].includes(value.toLowerCase())) return false;
  }
  return fallback;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
