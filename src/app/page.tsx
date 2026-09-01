import Link from "next/link";

import { PageFrame } from "@/components/page-frame";

export default function HomePage() {
  return (
    <PageFrame
      title="صوتك يصل للكوفي مباشرة"
      description="حياك منصة اتصال صوتي بسيطة للمقاهي. هذه النسخة تؤسس إدارة آمنة ومتعددة المستأجرين، ولا تتضمن تجربة الاتصال بعد."
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href="/login"
          className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[var(--brand)] px-6 py-3 text-sm font-bold text-white transition hover:bg-[var(--brand-dark)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand)]"
        >
          دخول فريق العمل
        </Link>
        <Link
          href="/c/hayyak-demo"
          className="inline-flex min-h-12 items-center justify-center rounded-xl border border-[var(--line)] px-6 py-3 text-sm font-bold transition hover:border-stone-400 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand)]"
        >
          صفحة الفرع التجريبي
        </Link>
      </div>
    </PageFrame>
  );
}

