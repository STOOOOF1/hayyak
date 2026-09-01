import Link from "next/link";

import { PageFrame } from "@/components/page-frame";

export default function UnauthorizedPage() {
  return (
    <PageFrame
      title="لا تملك صلاحية لهذه الصفحة"
      description="تم التحقق من حسابك على الخادم، لكن دورك الحالي لا يسمح بفتح هذه المنطقة."
    >
      <Link
        href="/staff"
        className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[var(--brand)] px-6 py-3 text-sm font-bold text-white"
      >
        العودة إلى منطقة الموظفين
      </Link>
    </PageFrame>
  );
}

