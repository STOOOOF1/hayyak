import { signOut } from "@/app/auth/actions";
import type { Principal } from "@/server/auth/principal";

const ROLE_LABELS = {
  PLATFORM_ADMIN: "مدير المنصة",
  COFFEE_ADMIN: "مدير المقهى",
  STAFF: "موظف",
} as const;

type PrincipalCardProps = {
  principal: Principal;
};

export function PrincipalCard({ principal }: PrincipalCardProps) {
  return (
    <div className="grid gap-5">
      <dl className="grid gap-3 rounded-2xl border border-[var(--line)] bg-stone-50 p-5 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-[var(--muted)]">المستخدم الحالي</dt>
          <dd className="mt-1 font-bold">{principal.displayName}</dd>
          <dd className="mt-1 break-all text-xs text-[var(--muted)]" dir="ltr">
            {principal.email}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">نطاق الصلاحية</dt>
          <dd className="mt-2 flex flex-wrap gap-2">
            {principal.memberships.map((membership) => (
              <span
                className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800"
                key={`${membership.role}-${membership.tenantId ?? "platform"}-${membership.branchId ?? "all"}`}
              >
                {ROLE_LABELS[membership.role]}
                {membership.tenantName ? ` — ${membership.tenantName}` : ""}
                {membership.branchName ? ` / ${membership.branchName}` : ""}
              </span>
            ))}
          </dd>
        </div>
      </dl>
      <form action={signOut}>
        <button
          type="submit"
          className="min-h-12 rounded-xl border border-[var(--line)] px-5 py-3 text-sm font-bold transition hover:border-stone-400 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand)]"
        >
          تسجيل الخروج
        </button>
      </form>
    </div>
  );
}
