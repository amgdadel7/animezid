"use client";

import { useEffect, useState } from "react";
import { AlertIcon, CheckIcon, ShieldIcon } from "@/components/icons";
import { Button, Chip, Field, Modal, inputClass } from "@/components/ui";

interface SettingsForm {
  siteUsername: string;
  sitePassword: string;
  siteCookie: string;
  concurrency: number;
  downloadDir: string;
  autoResolveOnImport: boolean;
  autoDownloadOnResolve: boolean;
  preferredQuality: string;
}

const EMPTY: SettingsForm = {
  siteUsername: "",
  sitePassword: "",
  siteCookie: "",
  concurrency: 2,
  downloadDir: "",
  autoResolveOnImport: true,
  autoDownloadOnResolve: false,
  preferredQuality: "highest",
};

export function SettingsDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<SettingsForm>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setMessage(null);
    void (async () => {
      const res = await fetch("/api/settings");
      const json = await res.json();
      if (json.ok) setForm({ ...EMPTY, ...json.data });
    })();
  }, [open]);

  const set = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "تعذّر الحفظ");
      setMessage({ tone: "ok", text: "حُفظت الإعدادات" });
      onSaved();
    } catch (err) {
      setMessage({ tone: "bad", text: err instanceof Error ? err.message : "فشل الحفظ" });
    } finally {
      setBusy(false);
    }
  }

  async function testAuth() {
    setTesting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.siteUsername,
          password: form.sitePassword,
          cookie: form.siteCookie,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setMessage({ tone: "bad", text: json.error ?? "فشل اختبار الدخول" });
        return;
      }
      setMessage({ tone: "ok", text: json.data.message ?? "تم التحقق بنجاح" });
      onSaved();
    } catch (err) {
      setMessage({ tone: "bad", text: err instanceof Error ? err.message : "خطأ" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="إعدادات المِرفأ"
      subtitle="بيانات الدخول تُستخدم فقط لإنشاء جلسات التشغيل على الموقع المصدر وكشف روابط البث."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            إغلاق
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            حفظ الإعدادات
          </Button>
        </>
      }
    >
      <section className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
        <div className="mb-3.5 flex items-center gap-2">
          <ShieldIcon className="h-4 w-4 text-amber-glow" />
          <h3 className="font-display text-[13px] font-extrabold text-mist-100">
            الوصول إلى الموقع المصدر
          </h3>
          <Chip tone={form.siteCookie ? "mint" : "neutral"}>
            {form.siteCookie ? "جلسة محفوظة" : "بلا جلسة"}
          </Chip>
        </div>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="اسم المستخدم">
            <input
              dir="ltr"
              className={`${inputClass} text-left`}
              value={form.siteUsername}
              onChange={(e) => set("siteUsername", e.target.value)}
              placeholder="username"
            />
          </Field>
          <Field label="كلمة المرور">
            <input
              dir="ltr"
              type="password"
              className={`${inputClass} text-left`}
              value={form.sitePassword}
              onChange={(e) => set("sitePassword", e.target.value)}
              placeholder="••••••••"
            />
          </Field>
        </div>
        <Field
          className="mt-3.5"
          label="أو الصق كعكة الجلسة مباشرة (PHPSESSID=...)"
          hint="مفيد إن كان الدخول محميًا برمز تحقق. تُستخدم الكعكة كما هي في كل الطلبات."
        >
          <textarea
            dir="ltr"
            rows={2}
            className={`${inputClass} resize-y text-left font-mono text-[12px]`}
            value={form.siteCookie}
            onChange={(e) => set("siteCookie", e.target.value)}
            placeholder="PHPSESSID=xxxxxxxx; watched_video_list=..."
          />
        </Field>
        <div className="mt-3.5 flex items-center gap-2">
          <Button variant="outline" size="sm" loading={testing} onClick={testAuth}>
            اختبار الدخول وحفظ الجلسة
          </Button>
          <span className="text-[11.5px] text-mist-400">
            بدون جلسة قد يرفض الموقع كشف روابط الحلقات المحمية.
          </span>
        </div>
      </section>

      <section className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
        <h3 className="mb-3.5 font-display text-[13px] font-extrabold text-mist-100">
          الطابور والتخزين
        </h3>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label={`التنزيلات المتزامنة: ${form.concurrency}`}>
            <input
              type="range"
              min={1}
              max={6}
              step={1}
              value={form.concurrency}
              onChange={(e) => set("concurrency", Number(e.target.value))}
              className="mt-2 w-full accent-[#f7b733]"
            />
          </Field>
          <Field label="الجودة المفضلة لبث HLS">
            <select
              className={inputClass}
              value={form.preferredQuality}
              onChange={(e) => set("preferredQuality", e.target.value)}
            >
              <option value="highest">أعلى جودة متاحة</option>
              <option value="lowest">أقل جودة (تنزيل أسرع)</option>
            </select>
          </Field>
        </div>
        <Field
          className="mt-3.5"
          label="مجلد الحفظ"
          hint="تُنظَّم الملفات تلقائيًا: المجلد/اسم السلسلة/الموسم/…"
        >
          <input
            dir="ltr"
            className={`${inputClass} text-left font-mono text-[12px]`}
            value={form.downloadDir}
            onChange={(e) => set("downloadDir", e.target.value)}
            placeholder="/app/downloads"
          />
        </Field>
        <div className="mt-3.5 grid gap-2.5 sm:grid-cols-2">
          {[
            {
              key: "autoResolveOnImport" as const,
              label: "استخراج المصادر تلقائيًا عند الاستيراد",
            },
            {
              key: "autoDownloadOnResolve" as const,
              label: "بدء التنزيل فور نجاح الاستخراج",
            },
          ].map((opt) => (
            <label
              key={opt.key}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-white/[0.07] bg-ink-950/50 px-3 py-2.5 text-[12px] font-semibold text-mist-200 transition-colors hover:border-amber-glow/30"
            >
              <input
                type="checkbox"
                checked={form[opt.key]}
                onChange={(e) => set(opt.key, e.target.checked)}
                className="h-4 w-4 accent-[#f7b733]"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </section>

      {message ? (
        <div
          className={`mt-4 flex items-start gap-2.5 rounded-xl border p-3.5 text-[12.5px] leading-relaxed ${
            message.tone === "ok"
              ? "border-mint/30 bg-mint/[0.07] text-mint"
              : "border-rose-alert/30 bg-rose-alert/[0.07] text-rose-alert"
          }`}
        >
          {message.tone === "ok" ? (
            <CheckIcon className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      ) : null}
    </Modal>
  );
}
