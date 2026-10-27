import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "مِرْفأ — مُحمِّل مواسم وحلقات الأنمي",
  description:
    "منصة لاستيراد مواسم الأنمي من مواقع المشاهدة، استخراج مصادر الفيديو، وتنزيل الحلقات وإدارة المكتبة.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;500;600;700;800&family=Tajawal:wght@400;500;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-ink-950 text-mist-100 antialiased">
        <div className="app-backdrop" aria-hidden />
        <div className="app-grid-lines" aria-hidden />
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
