export const APP_ROLES = [
  "PLATFORM_ADMIN",
  "COFFEE_ADMIN",
  "STAFF",
] as const;

export type AppRole = (typeof APP_ROLES)[number];
export type ProtectedArea = "platform" | "admin" | "staff";
export type AuthReturnPath = "/platform" | "/admin" | "/staff";

export type MembershipScope = {
  role: AppRole;
  tenantId: string | null;
  branchId: string | null;
};

export function canAccessArea(
  memberships: readonly MembershipScope[],
  area: ProtectedArea,
) {
  if (memberships.some(({ role }) => role === "PLATFORM_ADMIN")) {
    return true;
  }

  if (area === "platform") {
    return false;
  }

  if (area === "admin") {
    return memberships.some(({ role }) => role === "COFFEE_ADMIN");
  }

  return memberships.some(
    ({ role }) => role === "COFFEE_ADMIN" || role === "STAFF",
  );
}

export function safeInternalPath(
  value: unknown,
  fallback: AuthReturnPath = "/staff",
): AuthReturnPath {
  if (value === "/platform" || value === "/admin" || value === "/staff") {
    return value;
  }

  return fallback;
}
