import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PGlite } from "@electric-sql/pglite";

import {
  createTestDatabase,
  IDS,
  insertCall,
  resetCallFixtures,
  setAnonymous,
  setAuthenticatedUser,
  setDatabaseOwner,
} from "./helpers";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDatabase();
});

beforeEach(async () => {
  await resetCallFixtures(db);
});

afterAll(async () => {
  if (db) {
    await db.close();
  }
});

describe("RLS tenant and branch isolation", () => {
  it("A — prevents a Tenant A admin from reading Tenant B", async () => {
    await setAuthenticatedUser(db, IDS.adminA);

    const result = await db.query<{ id: string }>(
      "select id from public.tenants order by id",
    );

    expect(result.rows).toEqual([{ id: IDS.tenantA }]);
  });

  it("B — limits branch-scoped staff to their assigned branch and calls", async () => {
    await setDatabaseOwner(db);
    await insertCall(db, {
      tenantId: IDS.tenantA,
      branchId: IDS.branchA1,
      visitorId: IDS.visitorA,
    });
    await insertCall(db, {
      tenantId: IDS.tenantA,
      branchId: IDS.branchA2,
      visitorId: IDS.visitorB,
    });

    await setAuthenticatedUser(db, IDS.staffA1);
    const branches = await db.query<{ id: string }>(
      "select id from public.branches order by id",
    );
    const calls = await db.query<{ branch_id: string }>(
      "select branch_id from public.call_requests order by branch_id",
    );

    expect(branches.rows).toEqual([{ id: IDS.branchA1 }]);
    expect(calls.rows).toEqual([{ branch_id: IDS.branchA1 }]);
  });

  it("denies anonymous users broad call request access", async () => {
    await setAnonymous(db);

    await expect(
      db.query("select * from public.call_requests"),
    ).rejects.toThrow(/permission denied/i);
  });

  it("allows anonymous lookup of only enabled active public branches", async () => {
    await setAnonymous(db);

    const result = await db.query<{ slug: string }>(
      "select slug from public.get_public_branch('branch-a-1')",
    );

    expect(result.rows).toEqual([{ slug: "branch-a-1" }]);
  });
});

describe("call constraints and relational integrity", () => {
  it("C — rejects a second ACTIVE call in one branch", async () => {
    await insertCall(db, {
      tenantId: IDS.tenantA,
      branchId: IDS.branchA1,
      visitorId: IDS.visitorA,
      status: "ACTIVE",
    });

    await expect(
      insertCall(db, {
        tenantId: IDS.tenantA,
        branchId: IDS.branchA1,
        visitorId: IDS.visitorB,
        status: "ACTIVE",
      }),
    ).rejects.toThrow(/one_active_call_per_branch|unique/i);
  });

  it("D — allows each different branch to have an ACTIVE call", async () => {
    await insertCall(db, {
      tenantId: IDS.tenantA,
      branchId: IDS.branchA1,
      visitorId: IDS.visitorA,
      status: "ACTIVE",
    });
    await insertCall(db, {
      tenantId: IDS.tenantA,
      branchId: IDS.branchA2,
      visitorId: IDS.visitorB,
      status: "ACTIVE",
    });

    const result = await db.query<{ count: number }>(
      "select count(*)::integer as count from public.call_requests where status = 'ACTIVE'",
    );
    expect(result.rows[0]?.count).toBe(2);
  });

  it("E — rejects a second ON_HOLD call in one branch", async () => {
    await insertCall(db, {
      tenantId: IDS.tenantA,
      branchId: IDS.branchA1,
      visitorId: IDS.visitorA,
      status: "ON_HOLD",
    });

    await expect(
      insertCall(db, {
        tenantId: IDS.tenantA,
        branchId: IDS.branchA1,
        visitorId: IDS.visitorB,
        status: "ON_HOLD",
      }),
    ).rejects.toThrow(/one_held_call_per_branch|unique/i);
  });

  it("F — rejects a second unresolved call for one visitor and branch", async () => {
    await insertCall(db, {
      tenantId: IDS.tenantA,
      branchId: IDS.branchA1,
      visitorId: IDS.visitorA,
      status: "WAITING",
    });

    await expect(
      insertCall(db, {
        tenantId: IDS.tenantA,
        branchId: IDS.branchA1,
        visitorId: IDS.visitorA,
        status: "ACTIVE",
      }),
    ).rejects.toThrow(/one_unresolved_call_per_visitor_branch|unique/i);
  });

  it.each(["ENDED", "CANCELLED"] as const)(
    "G — allows a future request after %s",
    async (terminalStatus) => {
      await insertCall(db, {
        tenantId: IDS.tenantA,
        branchId: IDS.branchA1,
        visitorId: IDS.visitorA,
        status: terminalStatus,
      });
      await insertCall(db, {
        tenantId: IDS.tenantA,
        branchId: IDS.branchA1,
        visitorId: IDS.visitorA,
        status: "WAITING",
      });

      const result = await db.query<{ count: number }>(
        "select count(*)::integer as count from public.call_requests",
      );
      expect(result.rows[0]?.count).toBe(2);
    },
  );

  it("H — rejects a cross-tenant branch reference", async () => {
    await expect(
      insertCall(db, {
        tenantId: IDS.tenantA,
        branchId: IDS.branchB1,
        visitorId: IDS.visitorA,
      }),
    ).rejects.toThrow(/does not belong to tenant|foreign key/i);
  });

  it("H — rejects an active staff user from another tenant", async () => {
    await expect(
      db.query(
        `insert into public.call_requests (
           tenant_id,
           branch_id,
           visitor_id,
           status,
           queue_sequence,
           active_staff_user_id
         ) values ($1, $2, $3, 'ACTIVE', 999999, $4)`,
        [IDS.tenantA, IDS.branchA1, IDS.visitorA, IDS.adminB],
      ),
    ).rejects.toThrow(/not authorized for call branch|foreign key/i);
  });

  it("allocates monotonic FIFO values per branch and ignores supplied values", async () => {
    const first = await insertCall(db, {
      tenantId: IDS.tenantA,
      branchId: IDS.branchA1,
      visitorId: IDS.visitorA,
      status: "ENDED",
    });
    const second = await insertCall(db, {
      tenantId: IDS.tenantA,
      branchId: IDS.branchA1,
      visitorId: IDS.visitorB,
      status: "WAITING",
    });
    const otherBranch = await insertCall(db, {
      tenantId: IDS.tenantA,
      branchId: IDS.branchA2,
      visitorId: IDS.visitorA,
      status: "WAITING",
    });

    expect(first.rows[0]?.queue_sequence).toBe(1);
    expect(second.rows[0]?.queue_sequence).toBe(2);
    expect(otherBranch.rows[0]?.queue_sequence).toBe(1);
  });
});

describe("PLATFORM_ADMIN security", () => {
  it("J — ignores self-asserted role metadata and blocks self-promotion", async () => {
    await setAuthenticatedUser(db, IDS.metadataAttacker);

    const tenants = await db.query<{ id: string }>(
      "select id from public.tenants",
    );
    expect(tenants.rows).toEqual([]);

    await expect(
      db.query(
        `insert into public.memberships (user_id, role)
         values ($1, 'PLATFORM_ADMIN')`,
        [IDS.metadataAttacker],
      ),
    ).rejects.toThrow(/row-level security|policy/i);
  });

  it("allows the database-backed platform admin to read every tenant", async () => {
    await setAuthenticatedUser(db, IDS.platform);

    const result = await db.query<{ id: string }>(
      "select id from public.tenants order by id",
    );

    expect(result.rows.map(({ id }) => id)).toEqual([IDS.tenantA, IDS.tenantB]);
  });
});
