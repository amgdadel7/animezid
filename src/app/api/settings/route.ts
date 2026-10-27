import path from "node:path";
import { describeError, fail, ok, readJson, str, int, bool } from "@/lib/api";
import { getSettings, logEvent, setSetting } from "@/lib/settings";
import { ensureDir } from "@/lib/storage";
import { siteLogin } from "@/lib/site/animezid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EDITABLE = [
  "siteUsername",
  "sitePassword",
  "siteCookie",
  "concurrency",
  "downloadDir",
  "autoResolveOnImport",
  "autoDownloadOnResolve",
  "preferredQuality",
] as const;

export async function GET() {
  try {
    const s = await getSettings();
    return ok({
      ...s,
      // Never echo the password back to the browser.
      sitePassword: s.sitePassword ? "••••••••" : "",
    });
  } catch (err) {
    return fail(describeError(err), 500);
  }
}

export async function PUT(req: Request) {
  const body = await readJson<Record<string, unknown>>(req);
  try {
    const changes: string[] = [];
    for (const key of EDITABLE) {
      if (!(key in body)) continue;
      const raw = body[key];
      let value: string;
      if (key === "concurrency") {
        value = String(Math.max(1, Math.min(6, int(raw, 2))));
      } else if (key === "autoResolveOnImport" || key === "autoDownloadOnResolve") {
        value = bool(raw, false) ? "1" : "0";
      } else if (key === "downloadDir") {
        value = path.resolve(str(raw) || path.join(process.cwd(), "downloads"));
      } else if (key === "sitePassword") {
        const pw = str(raw);
        if (pw.includes("•")) continue; // masked placeholder, keep existing
        value = pw;
      } else {
        value = str(raw);
      }
      await setSetting(key, value);
      changes.push(key);
    }

    const next = await getSettings();
    if (next.downloadDir) await ensureDir(next.downloadDir).catch(() => undefined);

    await logEvent(
      "info",
      "settings",
      `حُدِّثت الإعدادات: ${changes.length ? changes.join("، ") : "لا شيء"}`,
    );

    return ok({
      ...next,
      sitePassword: next.sitePassword ? "••••••••" : "",
    });
  } catch (err) {
    return fail(describeError(err), 500);
  }
}

/** POST /api/settings — validate site credentials and persist the session cookie. */
export async function POST(req: Request) {
  const body = await readJson<{ username?: string; password?: string; cookie?: string }>(req);
  try {
    const current = await getSettings();
    const username = str(body.username) || current.siteUsername;
    const password =
      body.password && !str(body.password).includes("•")
        ? str(body.password)
        : current.sitePassword;
    const explicitCookie = str(body.cookie);

    if (explicitCookie) {
      await setSetting("siteCookie", explicitCookie);
      await logEvent("success", "settings", "حُفظت كعكة الجلسة يدويًا");
      return ok({ ok: true, message: "حُفظت كعكة الجلسة", cookieSet: true });
    }

    if (!username || !password) {
      return fail("أدخل اسم المستخدم وكلمة المرور أولًا");
    }

    await setSetting("siteUsername", username);
    await setSetting("sitePassword", password);
    const result = await siteLogin(username, password);
    await setSetting("siteCookie", result.ok ? result.cookie : "");
    await logEvent(
      result.ok ? "success" : "warn",
      "settings",
      `اختبار الدخول: ${result.message}`,
    );
    return result.ok
      ? ok({ ok: true, message: result.message, cookieSet: true })
      : fail(result.message, 401);
  } catch (err) {
    return fail(describeError(err), 502);
  }
}
