import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PGlite } from "@electric-sql/pglite";

import {
  createTestDatabase,
  IDS,
  resetCallFixtures,
  resetDatabaseOwner,
  setAuthenticatedUser,
  setCallQueuedAt,
} from "./helpers";

type Row<T = Record<string, unknown>> = { rows: T[] };

type EnqueuedRow = {
  call_id: string;
  queue_sequence: number;
  status: string;
};

type CommandRow = {
  call_id: string;
  status: string;
  car_description: string;
  event_type: string;
};

type HoldNextRow = {
  held_call_id: string;
  answered_call_id: string | null;
  status_held: string;
  status_answered: string;
};

type CurrentCallRow = {
  call_id: string;
  status: string;
  queue_sequence: number;
  queue_position: number;
  branch_id: string;
  tenant_id: string;
};

// Visitor token hashes (SHA-256-style random hex strings used as anonymous_identifier)
const VISITOR_A_TOKEN = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const VISITOR_B_TOKEN = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

async function enqueue(
  db: PGlite,
  token: string,
  slug = "branch-a-1",
  carDescription: string | null = null,
): Promise<Row<EnqueuedRow>> {
  const result = await db.query(
    `select * from public.enqueue_call($1, $2, $3)`,
    [slug, token, carDescription],
  );
  return { rows: result.rows as EnqueuedRow[] };
}

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

describe("Queue", () => {
  it("1 — first customer becomes queue_sequence 1", async () => {
    await resetDatabaseOwner(db);
    const res = await enqueue(db, VISITOR_A_TOKEN);
    expect(res.rows[0].queue_sequence).toBe(1);
    expect(res.rows[0].status).toBe("WAITING");
  });

  it("3 — same visitor cannot have two unresolved calls in same branch", async () => {
    await resetDatabaseOwner(db);
    await enqueue(db, VISITOR_A_TOKEN);
    const res = await enqueue(db, VISITOR_A_TOKEN);
    // Idempotent: returns the SAME call, not a new one.
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].queue_sequence).toBe(1);
    const count = await db.query<{ count: number }>(
      "select count(*)::int as count from public.call_requests where status = 'WAITING'",
    );
    expect(count.rows[0].count).toBe(1);
  });

  it("4 — same visitor can have a new call after previous ENDED/CANCELLED", async () => {
    await resetDatabaseOwner(db);
    const first = await enqueue(db, VISITOR_A_TOKEN);
    const callId = first.rows[0].call_id;
    await db.query(
      `update public.call_requests set status = 'ENDED', ended_at = now() where id = $1`,
      [callId],
    );
    const second = await enqueue(db, VISITOR_A_TOKEN);
    expect(second.rows[0].queue_sequence).toBe(2);
  });
});

describe("Answer", () => {
  it("5 — WAITING -> ACTIVE succeeds", async () => {
    await resetDatabaseOwner(db);
    const { rows: [c] } = await enqueue(db, VISITOR_A_TOKEN);
    await setAuthenticatedUser(db, IDS.staffA1);
    const res = await db.query<CommandRow>(
      `select * from public.answer_call($1, $2, $3)`,
      [IDS.branchA1, c.call_id, IDS.staffA1],
    );
    expect(res.rows[0].status).toBe("ACTIVE");
  });

  it("6 — cannot answer if ACTIVE already exists", async () => {
    await resetDatabaseOwner(db);
    const { rows: [a] } = await enqueue(db, VISITOR_A_TOKEN);
    const { rows: [b] } = await enqueue(db, VISITOR_B_TOKEN);
    await setAuthenticatedUser(db, IDS.staffA1);
    await db.query(`select * from public.answer_call($1, $2, $3)`, [
      IDS.branchA1, a.call_id, IDS.staffA1,
    ]);
    await expect(
      db.query(`select * from public.answer_call($1, $2, $3)`, [
        IDS.branchA1, b.call_id, IDS.staffA1,
      ]),
    ).rejects.toThrow(/ACTIVE_CALL_EXISTS/i);
  });
});

describe("Hold", () => {
  it("8 — ACTIVE -> ON_HOLD succeeds", async () => {
    await resetDatabaseOwner(db);
    const { rows: [c] } = await enqueue(db, VISITOR_A_TOKEN);
    await setAuthenticatedUser(db, IDS.staffA1);
    await db.query(`select * from public.answer_call($1, $2, $3)`, [
      IDS.branchA1, c.call_id, IDS.staffA1,
    ]);
    const res = await db.query<CommandRow>(`select * from public.hold_call($1, $2, $3)`, [
      IDS.branchA1, c.call_id, IDS.staffA1,
    ]);
    expect(res.rows[0].status).toBe("ON_HOLD");
  });

  it("9 — cannot create second ON_HOLD", async () => {
    await resetDatabaseOwner(db);
    const { rows: [a] } = await enqueue(db, VISITOR_A_TOKEN);
    const { rows: [b] } = await enqueue(db, VISITOR_B_TOKEN);
    await setAuthenticatedUser(db, IDS.staffA1);
    await db.query(`select * from public.answer_call($1, $2, $3)`, [
      IDS.branchA1, a.call_id, IDS.staffA1,
    ]);
    await db.query(`select * from public.hold_and_answer_next($1, $2, $3)`, [
      IDS.branchA1, a.call_id, IDS.staffA1,
    ]);
    // a is ON_HOLD, b is ACTIVE. Try to hold b -> must fail (HELD already exists).
    await expect(
      db.query(`select * from public.hold_call($1, $2, $3)`, [
        IDS.branchA1, b.call_id, IDS.staffA1,
      ]),
    ).rejects.toThrow(/HELD_CALL_EXISTS/i);
  });
});

describe("Hold and answer next", () => {
  it("10 — A ACTIVE + B WAITING => A ON_HOLD, B ACTIVE atomically", async () => {
    await resetDatabaseOwner(db);
    const { rows: [a] } = await enqueue(db, VISITOR_A_TOKEN);
    const { rows: [b] } = await enqueue(db, VISITOR_B_TOKEN);
    await setAuthenticatedUser(db, IDS.staffA1);
    await db.query(`select * from public.answer_call($1, $2, $3)`, [
      IDS.branchA1, a.call_id, IDS.staffA1,
    ]);
    const res = await db.query<HoldNextRow>(
      `select * from public.hold_and_answer_next($1, $2, $3)`,
      [IDS.branchA1, a.call_id, IDS.staffA1],
    );
    expect(res.rows[0].status_held).toBe("ON_HOLD");
    expect(res.rows[0].status_answered).toBe("ACTIVE");
    expect(res.rows[0].answered_call_id).toBe(b.call_id);

    const states = await db.query<{ id: string; status: string }>(
      "select id, status from public.call_requests order by queue_sequence",
    );
    expect(states.rows[0].status).toBe("ON_HOLD");
    expect(states.rows[1].status).toBe("ACTIVE");
  });

  it("11 — if no WAITING caller, A remains ACTIVE", async () => {
    await resetDatabaseOwner(db);
    const { rows: [a] } = await enqueue(db, VISITOR_A_TOKEN);
    await setAuthenticatedUser(db, IDS.staffA1);
    await db.query(`select * from public.answer_call($1, $2, $3)`, [
      IDS.branchA1, a.call_id, IDS.staffA1,
    ]);
    const res = await db.query<HoldNextRow>(
      `select * from public.hold_and_answer_next($1, $2, $3)`,
      [IDS.branchA1, a.call_id, IDS.staffA1],
    );
    expect(res.rows[0].answered_call_id).toBeNull();
    expect(res.rows[0].status_held).toBe("ACTIVE"); // stays active, not held
    const state = await db.query<{ status: string }>(
      "select status from public.call_requests where id = $1",
      [a.call_id],
    );
    expect(state.rows[0].status).toBe("ACTIVE");
  });

  it("12 — if ON_HOLD already exists, fails with no partial changes", async () => {
    await resetDatabaseOwner(db);
    const { rows: [a] } = await enqueue(db, VISITOR_A_TOKEN);
    const { rows: [b] } = await enqueue(db, VISITOR_B_TOKEN);
    await enqueue(db, "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");
    await setAuthenticatedUser(db, IDS.staffA1);
    await db.query(`select * from public.answer_call($1, $2, $3)`, [
      IDS.branchA1, a.call_id, IDS.staffA1,
    ]);
    await db.query(`select * from public.hold_and_answer_next($1, $2, $3)`, [
      IDS.branchA1, a.call_id, IDS.staffA1,
    ]);
    // Now a is held, b is active. Try hold_and_answer_next again -> should fail because HELD exists.
    await expect(
      db.query(`select * from public.hold_and_answer_next($1, $2, $3)`, [
        IDS.branchA1, b.call_id, IDS.staffA1,
      ]),
    ).rejects.toThrow(/HELD_CALL_EXISTS/i);
    // No partial changes: b still active, c still waiting
    const states = await db.query<{ status: string }>(
      "select status from public.call_requests where id = $1",
      [b.call_id],
    );
    expect(states.rows[0].status).toBe("ACTIVE");
  });
});

describe("Resume", () => {
  it("14 — ON_HOLD -> ACTIVE succeeds when ACTIVE empty", async () => {
    await resetDatabaseOwner(db);
    const { rows: [a] } = await enqueue(db, VISITOR_A_TOKEN);
    const { rows: [b] } = await enqueue(db, VISITOR_B_TOKEN);
    await setAuthenticatedUser(db, IDS.staffA1);
    await db.query(`select * from public.answer_call($1, $2, $3)`, [
      IDS.branchA1, a.call_id, IDS.staffA1,
    ]);
    await db.query(`select * from public.end_call($1, $2, $3)`, [
      IDS.branchA1, a.call_id, IDS.staffA1,
    ]);
    await db.query(`select * from public.answer_call($1, $2, $3)`, [
      IDS.branchA1, b.call_id, IDS.staffA1,
    ]);
    await db.query(`select * from public.hold_call($1, $2, $3)`, [
      IDS.branchA1, b.call_id, IDS.staffA1,
    ]);
    const res = await db.query<CommandRow>(`select * from public.resume_call($1, $2, $3)`, [
      IDS.branchA1, b.call_id, IDS.staffA1,
    ]);
    expect(res.rows[0].status).toBe("ACTIVE");
  });

  it("15 — resume fails while another ACTIVE exists", async () => {
    await resetDatabaseOwner(db);
    const { rows: [a] } = await enqueue(db, VISITOR_A_TOKEN);
    await enqueue(db, VISITOR_B_TOKEN);
    await setAuthenticatedUser(db, IDS.staffA1);
    await db.query(`select * from public.answer_call($1, $2, $3)`, [
      IDS.branchA1, a.call_id, IDS.staffA1,
    ]);
    await db.query(`select * from public.hold_and_answer_next($1, $2, $3)`, [
      IDS.branchA1, a.call_id, IDS.staffA1,
    ]);
    // a held, b active. Try resume a -> fails because b active.
    await expect(
      db.query(`select * from public.resume_call($1, $2, $3)`, [
        IDS.branchA1, a.call_id, IDS.staffA1,
      ]),
    ).rejects.toThrow(/ACTIVE_CALL_EXISTS/i);
  });
});

describe("End", () => {
  it("16 — ACTIVE -> ENDED", async () => {
    await resetDatabaseOwner(db);
    const { rows: [a] } = await enqueue(db, VISITOR_A_TOKEN);
    await setAuthenticatedUser(db, IDS.staffA1);
    await db.query(`select * from public.answer_call($1, $2, $3)`, [
      IDS.branchA1, a.call_id, IDS.staffA1,
    ]);
    const res = await db.query<CommandRow>(`select * from public.end_call($1, $2, $3)`, [
      IDS.branchA1, a.call_id, IDS.staffA1,
    ]);
    expect(res.rows[0].status).toBe("ENDED");
  });

  it("17 — ON_HOLD -> ENDED", async () => {
    await resetDatabaseOwner(db);
    const { rows: [a] } = await enqueue(db, VISITOR_A_TOKEN);
    await setAuthenticatedUser(db, IDS.staffA1);
    await db.query(`select * from public.answer_call($1, $2, $3)`, [
      IDS.branchA1, a.call_id, IDS.staffA1,
    ]);
    await db.query(`select * from public.hold_call($1, $2, $3)`, [
      IDS.branchA1, a.call_id, IDS.staffA1,
    ]);
    const res = await db.query<CommandRow>(`select * from public.end_call($1, $2, $3)`, [
      IDS.branchA1, a.call_id, IDS.staffA1,
    ]);
    expect(res.rows[0].status).toBe("ENDED");
  });
});

describe("Customer cancellation", () => {
  it("18 — customer can cancel own WAITING call", async () => {
    await resetDatabaseOwner(db);
    const { rows: [c] } = await enqueue(db, VISITOR_A_TOKEN);
    const res = await db.query<CommandRow>(
      `select * from public.cancel_waiting_call($1, $2, $3)`,
      [IDS.branchA1, c.call_id, VISITOR_A_TOKEN],
    );
    expect(res.rows[0].status).toBe("CANCELLED");
  });

  it("19 — customer cannot cancel another customer's call", async () => {
    await resetDatabaseOwner(db);
    const { rows: [c] } = await enqueue(db, VISITOR_A_TOKEN);
    await expect(
      db.query(`select * from public.cancel_waiting_call($1, $2, $3)`, [
        IDS.branchA1, c.call_id, VISITOR_B_TOKEN,
      ]),
    ).rejects.toThrow(/CALL_NOT_FOUND|INVALID_VISITOR/i);
  });

  it("20 — customer cannot cancel ACTIVE through waiting-cancel command", async () => {
    await resetDatabaseOwner(db);
    const { rows: [c] } = await enqueue(db, VISITOR_A_TOKEN);
    await setAuthenticatedUser(db, IDS.staffA1);
    await db.query(`select * from public.answer_call($1, $2, $3)`, [
      IDS.branchA1, c.call_id, IDS.staffA1,
    ]);
    await resetDatabaseOwner(db);
    await expect(
      db.query(`select * from public.cancel_waiting_call($1, $2, $3)`, [
        IDS.branchA1, c.call_id, VISITOR_A_TOKEN,
      ]),
    ).rejects.toThrow(/CALL_NOT_WAITING/i);
  });
});

describe("Car description", () => {
  it("21 — empty description accepted", async () => {
    await resetDatabaseOwner(db);
    const res = await enqueue(db, VISITOR_A_TOKEN, "branch-a-1", "");
    expect(res.rows[0].call_id).toBeTruthy();
  });

  it("22 — Arabic description stored correctly", async () => {
    await resetDatabaseOwner(db);
    const res = await enqueue(db, VISITOR_A_TOKEN, "branch-a-1", "كامري بيضاء");
    const stored = await db.query<{ car_description: string }>(
      "select car_description from public.call_requests where id = $1",
      [res.rows[0].call_id],
    );
    expect(stored.rows[0].car_description).toBe("كامري بيضاء");
  });

  it("23 — description over max length rejected", async () => {
    await resetDatabaseOwner(db);
    const tooLong = "س".repeat(101);
    await expect(enqueue(db, VISITOR_A_TOKEN, "branch-a-1", tooLong)).rejects.toThrow(
      /INVALID_CAR_DESCRIPTION/i,
    );
  });

  it("24 — customer cannot edit another visitor's call", async () => {
    await resetDatabaseOwner(db);
    const { rows: [c] } = await enqueue(db, VISITOR_A_TOKEN);
    await expect(
      db.query(`select * from public.update_car_description($1::uuid, $2::uuid, $3::text, $4::uuid, $5::text)`, [
        IDS.branchA1, c.call_id, "سيارة أخرى", null, VISITOR_B_TOKEN,
      ]),
    ).rejects.toThrow(/UNAUTHORIZED|CALL_NOT_FOUND/i);
  });

  it("25 — authorized staff can edit branch caller description", async () => {
    await resetDatabaseOwner(db);
    const { rows: [c] } = await enqueue(db, VISITOR_A_TOKEN);
    await setAuthenticatedUser(db, IDS.staffA1);
    const res = await db.query<CommandRow>(
      `select * from public.update_car_description($1, $2, $3, $4)`,
      [IDS.branchA1, c.call_id, "كامري بيضاء", IDS.staffA1],
    );
    expect(res.rows[0].car_description).toBe("كامري بيضاء");
    expect(res.rows[0].event_type).toBe("CAR_DESCRIPTION_UPDATED_BY_STAFF");
  });
});

describe("Stale waiting", () => {
  it("26 — old WAITING call can be expired to CANCELLED", async () => {
    await resetDatabaseOwner(db);
    const { rows: [c] } = await enqueue(db, VISITOR_A_TOKEN);
    await setCallQueuedAt(db, c.call_id, 20);
    const count = await db.query<{ expire_stale_waiting_calls: number }>(
      "select public.expire_stale_waiting_calls(interval '10 minutes') as expire_stale_waiting_calls",
    );
    expect(count.rows[0].expire_stale_waiting_calls).toBe(1);
    const state = await db.query<{ status: string }>(
      "select status from public.call_requests where id = $1",
      [c.call_id],
    );
    expect(state.rows[0].status).toBe("CANCELLED");
  });

  it("27 — recent WAITING call is not expired", async () => {
    await resetDatabaseOwner(db);
    const { rows: [c] } = await enqueue(db, VISITOR_A_TOKEN);
    const count = await db.query<{ expire_stale_waiting_calls: number }>(
      "select public.expire_stale_waiting_calls(interval '10 minutes') as expire_stale_waiting_calls",
    );
    expect(count.rows[0].expire_stale_waiting_calls).toBe(0);
    const state = await db.query<{ status: string }>(
      "select status from public.call_requests where id = $1",
      [c.call_id],
    );
    expect(state.rows[0].status).toBe("WAITING");
  });

  it("28 — ACTIVE is not expired by waiting timeout", async () => {
    await resetDatabaseOwner(db);
    const { rows: [a] } = await enqueue(db, VISITOR_A_TOKEN);
    await setAuthenticatedUser(db, IDS.staffA1);
    await db.query(`select * from public.answer_call($1, $2, $3)`, [
      IDS.branchA1, a.call_id, IDS.staffA1,
    ]);
    await resetDatabaseOwner(db);
    await setCallQueuedAt(db, a.call_id, 60);
    await resetDatabaseOwner(db);
    const count = await db.query<{ expire_stale_waiting_calls: number }>(
      "select public.expire_stale_waiting_calls(interval '10 minutes') as expire_stale_waiting_calls",
    );
    expect(count.rows[0].expire_stale_waiting_calls).toBe(0);
    const state = await db.query<{ status: string }>(
      "select status from public.call_requests where id = $1",
      [a.call_id],
    );
    expect(state.rows[0].status).toBe("ACTIVE");
  });

  it("29 — ON_HOLD is not expired by waiting timeout", async () => {
    await resetDatabaseOwner(db);
    const { rows: [a] } = await enqueue(db, VISITOR_A_TOKEN);
    const { rows: [b] } = await enqueue(db, VISITOR_B_TOKEN);
    await setAuthenticatedUser(db, IDS.staffA1);
    await db.query(`select * from public.answer_call($1, $2, $3)`, [
      IDS.branchA1, a.call_id, IDS.staffA1,
    ]);
    await db.query(`select * from public.hold_and_answer_next($1, $2, $3)`, [
      IDS.branchA1, a.call_id, IDS.staffA1,
    ]);
    // b active, a held. Set both old.
    await resetDatabaseOwner(db);
    await setCallQueuedAt(db, a.call_id, 60);
    await setCallQueuedAt(db, b.call_id, 60);
    await resetDatabaseOwner(db);
    const count = await db.query<{ expire_stale_waiting_calls: number }>(
      "select public.expire_stale_waiting_calls(interval '10 minutes') as expire_stale_waiting_calls",
    );
    expect(count.rows[0].expire_stale_waiting_calls).toBe(0);
    const held = await db.query<{ status: string }>(
      "select status from public.call_requests where id = $1",
      [a.call_id],
    );
    expect(held.rows[0].status).toBe("ON_HOLD");
  });
});

describe("Tenant and branch security", () => {
  it("30 — Tenant A staff cannot operate Tenant B call", async () => {
    await resetDatabaseOwner(db);
    // Enqueue into branch B1 (tenant B) as visitor A, then try to answer as staffA1 (tenant A branch A1)
    const { rows: [c] } = await enqueue(db, VISITOR_A_TOKEN, "branch-b-1");
    await setAuthenticatedUser(db, IDS.staffA1);
    await expect(
      db.query(`select * from public.answer_call($1, $2, $3)`, [
        IDS.branchB1, c.call_id, IDS.staffA1,
      ]),
    ).rejects.toThrow(/UNAUTHORIZED|ACTIVE_CALL_EXISTS|CALL_NOT_FOUND/i);
  });

  it("31 — branch-A staff cannot operate branch B of same tenant (if branch restricted)", async () => {
    await resetDatabaseOwner(db);
    // Branch A2 in tenant A; staffA1 only has branch A1. Enqueue in A2, try staffA1 answer.
    const { rows: [c] } = await enqueue(db, VISITOR_A_TOKEN, "branch-a-2");
    await setAuthenticatedUser(db, IDS.staffA1);
    await expect(
      db.query(`select * from public.answer_call($1, $2, $3)`, [
        IDS.branchA2, c.call_id, IDS.staffA1,
      ]),
    ).rejects.toThrow(/UNAUTHORIZED|ACTIVE_CALL_EXISTS|CALL_NOT_FOUND/i);
  });
});

describe("Customer read privacy", () => {
  it("32 — visitor only sees own call", async () => {
    await resetDatabaseOwner(db);
    const { rows: [a] } = await enqueue(db, VISITOR_A_TOKEN);
    await enqueue(db, VISITOR_B_TOKEN);
    const res = await db.query<CurrentCallRow>(
      `select * from public.get_customer_current_call('branch-a-1', $1)`,
      [VISITOR_A_TOKEN],
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].call_id).toBe(a.call_id);
  });

  it("33 — queue position does not expose other customers", async () => {
    await resetDatabaseOwner(db);
    await enqueue(db, VISITOR_A_TOKEN);
    const { rows: [b] } = await enqueue(db, VISITOR_B_TOKEN);
    const res = await db.query<CurrentCallRow>(
      `select * from public.get_customer_current_call('branch-a-1', $1)`,
      [VISITOR_B_TOKEN],
    );
    expect(res.rows[0].queue_position).toBe(2);
    expect(res.rows[0].call_id).toBe(b.call_id);
  });
});

describe("Concurrency and FIFO", () => {
  function tokenFor(i: number): string {
    return i.toString(16).padStart(64, "0");
  }

  it("34 — many rapid enqueues allocate unique monotonic FIFO sequences", async () => {
    await resetDatabaseOwner(db);
    const N = 20;
    for (let i = 0; i < N; i++) {
      await enqueue(db, tokenFor(i));
    }
    const rows = await db.query<{ queue_sequence: number; status: string }>(
      "select queue_sequence, status from public.call_requests where branch_id = $1 and status = 'WAITING' order by queue_sequence",
      [IDS.branchA1],
    );
    expect(rows.rows.length).toBe(N);
    const sequences = rows.rows.map((r) => r.queue_sequence);
    for (let i = 0; i < sequences.length - 1; i++) {
      expect(sequences[i]).toBeLessThan(sequences[i + 1]);
    }
    expect(sequences[0]).toBe(1);
  });

  it("35 — FIFO drain respects one-ON_HOLD invariant and answers next in order", async () => {
    await resetDatabaseOwner(db);
    const N = 5;
    const calls: { call_id: string }[] = [];
    for (let i = 0; i < N; i++) {
      const { rows } = await enqueue(db, tokenFor(i + 100));
      calls.push(rows[0]);
    }
    await setAuthenticatedUser(db, IDS.staffA1);

    const { rows: activeRows } = await db.query<CommandRow>(
      `select * from public.answer_call($1, $2, $3)`,
      [IDS.branchA1, calls[0].call_id, IDS.staffA1],
    );
    expect(activeRows[0].status).toBe("ACTIVE");
    expect(activeRows[0].call_id).toBe(calls[0].call_id);

    // Advance head-to-next, ending the previously held call on all but the last
    // swap to preserve the single-ON_HOLD invariant.
    for (let i = 1; i < N; i++) {
      const { rows } = await db.query<HoldNextRow>(
        `select * from public.hold_and_answer_next($1, $2, $3)`,
        [IDS.branchA1, calls[i - 1].call_id, IDS.staffA1],
      );
      expect(rows[0].answered_call_id).toBe(calls[i].call_id);
      if (i < N - 1) {
        await db.query(`select * from public.end_call($1, $2, $3)`, [
          IDS.branchA1,
          calls[i - 1].call_id,
          IDS.staffA1,
        ]);
      }
    }

    // Exactly one ON_HOLD (calls[N-2]) and one ACTIVE (calls[N-1]) at the end.
    const held = await db.query<{ id: string }>(
      "select id from public.call_requests where status = 'ON_HOLD' and branch_id = $1",
      [IDS.branchA1],
    );
    expect(held.rows.length).toBe(1);
    expect(held.rows[0].id).toBe(calls[N - 2].call_id);
    const active = await db.query<{ id: string }>(
      "select id from public.call_requests where status = 'ACTIVE' and branch_id = $1",
      [IDS.branchA1],
    );
    expect(active.rows.length).toBe(1);
    expect(active.rows[0].id).toBe(calls[N - 1].call_id);
  });
});
