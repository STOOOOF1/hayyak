import { describe, expect, it } from "vitest";

import {
  canAccessArea,
  safeInternalPath,
  type MembershipScope,
} from "@/server/auth/authorization";
import { isValidBranchSlug } from "@/server/branches";

const platform: MembershipScope[] = [
  { role: "PLATFORM_ADMIN", tenantId: null, branchId: null },
];
const coffeeAdmin: MembershipScope[] = [
  { role: "COFFEE_ADMIN", tenantId: "tenant-a", branchId: null },
];
const staff: MembershipScope[] = [
  { role: "STAFF", tenantId: "tenant-a", branchId: "branch-a" },
];

describe("protected route authorization", () => {
  it("denies unauthenticated principals from every protected area", () => {
    expect(canAccessArea([], "staff")).toBe(false);
    expect(canAccessArea([], "admin")).toBe(false);
    expect(canAccessArea([], "platform")).toBe(false);
  });

  it("allows staff only into the staff area", () => {
    expect(canAccessArea(staff, "staff")).toBe(true);
    expect(canAccessArea(staff, "admin")).toBe(false);
    expect(canAccessArea(staff, "platform")).toBe(false);
  });

  it("allows coffee admins into staff/admin but not platform", () => {
    expect(canAccessArea(coffeeAdmin, "staff")).toBe(true);
    expect(canAccessArea(coffeeAdmin, "admin")).toBe(true);
    expect(canAccessArea(coffeeAdmin, "platform")).toBe(false);
  });

  it("allows platform admins into every protected area", () => {
    expect(canAccessArea(platform, "staff")).toBe(true);
    expect(canAccessArea(platform, "admin")).toBe(true);
    expect(canAccessArea(platform, "platform")).toBe(true);
  });
});

describe("navigation and branch input safety", () => {
  it("accepts internal paths and rejects external redirect targets", () => {
    expect(safeInternalPath("/admin")).toBe("/admin");
    expect(safeInternalPath("//attacker.example")).toBe("/staff");
    expect(safeInternalPath("https://attacker.example")).toBe("/staff");
  });

  it("accepts only canonical lowercase branch slugs", () => {
    expect(isValidBranchSlug("hayyak-demo")).toBe(true);
    expect(isValidBranchSlug("Hayyak-Demo")).toBe(false);
    expect(isValidBranchSlug("../platform")).toBe(false);
  });
});

