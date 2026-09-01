import type { Metadata } from "next";
import { Noto_Kufi_Arabic } from "next/font/google";

import "./globals.css";

const hayyakFont = Noto_Kufi_Arabic({
  subsets: ["arabic"],
  display: "swap",
  variable: "--font-hayyak",
});

export const metadata: Metadata = {
  title: {
    default: "حياك — HAYYAK",
    template: "%s | حياك",
  },
  description: "منصة اتصال صوتي بسيطة لخدمة عملاء المقاهي.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" className={hayyakFont.variable}>
      <body>{children}</body>
    </html>
  );
}

