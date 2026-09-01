import { signIn } from "@/app/auth/actions";
import { PageFrame } from "@/components/page-frame";
import { safeInternalPath } from "@/server/auth/authorization";

type LoginPageProps = {
  searchParams: Promise<{ error?: string; next?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const query = await searchParams;
  const nextPath = safeInternalPath(query.next);

  return (
    <PageFrame
      title="دخول فريق حياك"
      description="هذه المنطقة مخصصة لمديري المنصة ومديري المقاهي والموظفين فقط. العملاء لا يحتاجون إلى حساب."
    >
      {query.error ? (
        <p
          className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          role="alert"
        >
          تعذر تسجيل الدخول. تحقق من البريد وكلمة المرور ثم حاول مرة أخرى.
        </p>
      ) : null}
      <form action={signIn} className="grid gap-5">
        <input type="hidden" name="next" value={nextPath} />
        <label className="grid gap-2 text-sm font-bold">
          البريد الإلكتروني
          <input
            className="min-h-12 rounded-xl border border-[var(--line)] bg-white px-4 py-3 text-left outline-none transition focus:border-[var(--brand)] focus:ring-3 focus:ring-emerald-100"
            dir="ltr"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
        </label>
        <label className="grid gap-2 text-sm font-bold">
          كلمة المرور
          <input
            className="min-h-12 rounded-xl border border-[var(--line)] bg-white px-4 py-3 text-left outline-none transition focus:border-[var(--brand)] focus:ring-3 focus:ring-emerald-100"
            dir="ltr"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        <button
          type="submit"
          className="min-h-12 rounded-xl bg-[var(--brand)] px-6 py-3 text-sm font-bold text-white transition hover:bg-[var(--brand-dark)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand)]"
        >
          دخول
        </button>
      </form>
    </PageFrame>
  );
}

