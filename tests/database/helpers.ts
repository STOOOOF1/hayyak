import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";

export const IDS = {
  tenantA: "10000000-0000-4000-8000-00000000000a",
  tenantB: "10000000-0000-4000-8000-00000000000b",
  branchA1: "20000000-0000-4000-8000-0000000000a1",
  branchA2: "20000000-0000-4000-8000-0000000000a2",
  branchB1: "20000000-0000-4000-8000-0000000000b1",
  platform: "30000000-0000-4000-8000-000000000001",
  adminA: "30000000-0000-4000-8000-00000000000a",
  staffA1: "30000000-0000-4000-8000-0000000000a1",
  adminB: "30000000-0000-4000-8000-00000000000b",
  metadataAttacker: "30000000-0000-4000-8000-000000000bad",
  visitorA: "40000000-0000-4000-8000-00000000000a",
  visitorB: "40000000-0000-4000-8000-00000000000b",
} as const;

const phase1MigrationPath = fileURLToPath(
  new URL(
    "../../supabase/migrations/20260831000100_phase1_foundation.sql",
    import.meta.url,
  ),
);

const phase2MigrationPath = fileURLToPath(
  new URL(
    "../../supabase/migrations/20260901100000_phase2_call_backend.sql",
    import.meta.url,
  ),
);

export async function createTestDatabase() {
  const db = new PGlite();

  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;

    create table auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );

    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
  `);

  await db.exec(await readFile(phase1MigrationPath, "utf8"));
  await db.exec(await readFile(phase2MigrationPath, "utf8"));
  await seedAuthorizationFixtures(db);

  return db;
}

async function seedAuthorizationFixtures(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${IDS.platform}', 'platform@example.invalid', '{"display_name":"Platform"}'),
      ('${IDS.adminA}', 'admin-a@example.invalid', '{"display_name":"Admin A"}'),
      ('${IDS.staffA1}', 'staff-a1@example.invalid', '{"display_name":"Staff A1"}'),
      ('${IDS.adminB}', 'admin-b@example.invalid', '{"display_name":"Admin B"}'),
      ('${IDS.metadataAttacker}', 'attacker@example.invalid', '{"display_name":"Attacker","role":"PLATFORM_ADMIN"}');

    insert into public.tenants (id, name) values
      ('${IDS.tenantA}', 'Tenant A'),
      ('${IDS.tenantB}', 'Tenant B');

    insert into public.branches (id, tenant_id, name, slug) values
      ('${IDS.branchA1}', '${IDS.tenantA}', 'Branch A1', 'branch-a-1'),
      ('${IDS.branchA2}', '${IDS.tenantA}', 'Branch A2', 'branch-a-2'),
      ('${IDS.branchB1}', '${IDS.tenantB}', 'Branch B1', 'branch-b-1');

    insert into public.memberships (user_id, tenant_id, branch_id, role) values
      ('${IDS.platform}', null, null, 'PLATFORM_ADMIN'),
      ('${IDS.adminA}', '${IDS.tenantA}', null, 'COFFEE_ADMIN'),
      ('${IDS.staffA1}', '${IDS.tenantA}', '${IDS.branchA1}', 'STAFF'),
      ('${IDS.adminB}', '${IDS.tenantB}', null, 'COFFEE_ADMIN');
  `);
}

export async function resetCallFixtures(db: PGlite) {
  await db.exec(`
    reset role;
    truncate table public.call_events, public.call_requests, public.visitors restart identity cascade;
    insert into public.visitors (id, anonymous_identifier) values
      ('${IDS.visitorA}', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
      ('${IDS.visitorB}', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  `);
}

export async function setAuthenticatedUser(db: PGlite, userId: string) {
  await db.exec(`
    reset role;
    select set_config('request.jwt.claim.sub', '${userId}', false);
    set role authenticated;
  `);
}

export async function setAnonymous(db: PGlite) {
  await db.exec(`
    reset role;
    select set_config('request.jwt.claim.sub', '', false);
    set role anon;
  `);
}

export async function setDatabaseOwner(db: PGlite) {
  await db.exec("reset role;");
}

export async function insertCall(
  db: PGlite,
  values: {
    tenantId: string;
    branchId: string;
    visitorId: string;
    status?: "WAITING" | "ACTIVE" | "ON_HOLD" | "ENDED" | "CANCELLED";
    queuedAt?: string;
  },
) {
  const status = values.status ?? "WAITING";

  return db.query<{ id: string; queue_sequence: number }>(
    `
      insert into public.call_requests (
        tenant_id, branch_id, visitor_id, status, queue_sequence, queued_at
      ) values ($1, $2, $3, $4, 999999, coalesce($5, now()))
      returning id, queue_sequence;
    `,
    [values.tenantId, values.branchId, values.visitorId, status, values.queuedAt ?? null],
  );
}

export async function setCallQueuedAt(db: PGlite, callId: string, ageMinutes: number) {
  await db.query(
    `update public.call_requests
       set queued_at = now() - ($1 * interval '1 minute')
     where id = $2`,
    [ageMinutes, callId],
  );
}

export async function resetDatabaseOwner(db: PGlite) {
  await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
}

