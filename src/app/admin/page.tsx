import { PageFrame } from "@/components/page-frame";
import { PrincipalCard } from "@/components/principal-card";
import { requireArea } from "@/server/auth/principal";

export default async function AdminPage() {
  const principal = await requireArea("admin", "/admin");

  return (
    <PageFrame
      eyebrow="حياك — إدارة المقهى"
      title="إدارة المقهى"
      description="تعرض هذه الصفحة هوية المستخدم ونطاقه فقط لإثبات عزل المستأجر. أدوات الإدارة ليست ضمن المرحلة الأولى."
    >
      <PrincipalCard principal={principal} />
    </PageFrame>
  );
}

