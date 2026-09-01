import { notFound } from "next/navigation";

import { PageFrame } from "@/components/page-frame";
import { getPublicBranchBySlug } from "@/server/branches";

type BranchPageProps = {
  params: Promise<{ branchSlug: string }>;
};

export default async function BranchPage({ params }: BranchPageProps) {
  const { branchSlug } = await params;
  const branch = await getPublicBranchBySlug(branchSlug);

  if (!branch) {
    notFound();
  }

  return (
    <PageFrame
      eyebrow="حياك — صفحة الفرع"
      title={branch.name}
      description="تم التحقق من رابط الفرع بنجاح. تجربة طلب الاتصال والموقع والميكروفون ليست جزءًا من المرحلة الأولى."
    >
      <p className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-7 text-amber-900">
        هذه صفحة تأسيسية فقط. لن يتم طلب الموقع أو الميكروفون، ولن يتم إنشاء طلب اتصال.
      </p>
    </PageFrame>
  );
}

