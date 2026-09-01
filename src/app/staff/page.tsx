import { PageFrame } from "@/components/page-frame";
import { PrincipalCard } from "@/components/principal-card";
import { requireArea } from "@/server/auth/principal";

export default async function StaffPage() {
  const principal = await requireArea("staff", "/staff");

  return (
    <PageFrame
      eyebrow="حياك — الموظفون"
      title="منطقة الموظفين"
      description="تم إثبات المصادقة ونطاق المستأجر/الفرع. واجهة طابور المكالمات ستُبنى في مرحلة لاحقة."
    >
      <PrincipalCard principal={principal} />
    </PageFrame>
  );
}

