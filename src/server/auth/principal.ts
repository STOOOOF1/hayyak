import { cache } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  APP_ROLES,
  canAccessArea,
  type AuthReturnPath,
  type AppRole,
  type MembershipScope,
  type ProtectedArea,
} from "@/server/auth/authorization";

type RawMembership = {
  role: string;
  tenant_id: string | null;
  branch_id: string | null;
};

export type PrincipalMembership = MembershipScope & {
  tenantName: string | null;
  branchName: string | null;
};

export type Principal = {
  id: string;
  email: string;
  displayName: string;
  memberships: PrincipalMembership[];
};

function isAppRole(value: string): value is AppRole {
  return APP_ROLES.some((role) => role === value);
}

export const getCurrentPrincipal = cache(async (): Promise<Principal | null> => {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return null;
  }

  const [profileResult, membershipResult] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
    supabase
      .from("memberships")
      .select("role, tenant_id, branch_id")
      .eq("user_id", user.id),
  ]);

  if (profileResult.error || membershipResult.error) {
    throw new Error("تعذر تحميل صلاحيات المستخدم.");
  }

  const rawMemberships = (membershipResult.data ?? []) as RawMembership[];
  const tenantIds = [
    ...new Set(rawMemberships.flatMap(({ tenant_id }) => tenant_id ?? [])),
  ];
  const branchIds = [
    ...new Set(rawMemberships.flatMap(({ branch_id }) => branch_id ?? [])),
  ];

  const [tenantsResult, branchesResult] = await Promise.all([
    tenantIds.length > 0
      ? supabase.from("tenants").select("id, name").in("id", tenantIds)
      : Promise.resolve({ data: [], error: null }),
    branchIds.length > 0
      ? supabase.from("branches").select("id, name").in("id", branchIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (tenantsResult.error || branchesResult.error) {
    throw new Error("تعذر تحميل نطاق صلاحيات المستخدم.");
  }

  const tenantNames = new Map(
    (tenantsResult.data ?? []).map(({ id, name }) => [id, name]),
  );
  const branchNames = new Map(
    (branchesResult.data ?? []).map(({ id, name }) => [id, name]),
  );

  const memberships = rawMemberships.flatMap((membership) => {
    if (!isAppRole(membership.role)) {
      return [];
    }

    return [
      {
        role: membership.role,
        tenantId: membership.tenant_id,
        branchId: membership.branch_id,
        tenantName: membership.tenant_id
          ? (tenantNames.get(membership.tenant_id) ?? null)
          : null,
        branchName: membership.branch_id
          ? (branchNames.get(membership.branch_id) ?? null)
          : null,
      },
    ];
  });

  return {
    id: user.id,
    email: user.email ?? "—",
    displayName: profileResult.data?.display_name ?? user.email ?? "مستخدم حياك",
    memberships,
  };
});

export async function requireArea(area: ProtectedArea, returnTo: AuthReturnPath) {
  const principal = await getCurrentPrincipal();

  if (!principal) {
    redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  }

  if (!canAccessArea(principal.memberships, area)) {
    redirect("/unauthorized");
  }

  return principal;
}
