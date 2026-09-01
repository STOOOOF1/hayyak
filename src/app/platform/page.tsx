import { PageFrame } from "@/components/page-frame";
import { PrincipalCard } from "@/components/principal-card";
import { requireArea } from "@/server/auth/principal";

export default async function PlatformPage() {
  const principal = await requireArea("platform", "/platform");

  return (
    <PageFrame
      eyebrow="حياك — المنصة"
      title="إدارة منصة حياك"
      description="الوصول إلى هذه الصفحة يتطلب عضوية PLATFORM_ADMIN عالمية محفوظة في قاعدة البيانات، وليس قيمة قابلة للتعديل من الواجهة."
    >
      <PrincipalCard principal={principal} />
    </PageFrame>
  );
}

