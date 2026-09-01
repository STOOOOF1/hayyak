# Phase 1 foundation — implemented decisions

This document records the implementation of the approved Phase 1 request. The Phase 0 documents remain the product contract; where the more specific Phase 1 request changed a preparatory detail, that difference is listed below.

## Application foundation

- Next.js 16 App Router, React 19, TypeScript (strict), Tailwind CSS 4, and ESLint.
- Arabic root document with `lang="ar"`, `dir="rtl"`, and the optimized Noto Kufi Arabic font.
- Supabase SSR browser/server clients use only the public project URL and publishable key.
- A Next.js `proxy.ts` refreshes/verifies Supabase sessions only on auth-aware route families.
- Server Components call `supabase.auth.getUser()` and resolve database memberships before protected content renders. Client-side redirects are not an authorization boundary.
- Minimal `/`, `/c/[branchSlug]`, `/staff`, `/admin`, and `/platform` pages only. No call workflow is present.

## Final seven tables

1. `tenants`
2. `branches`
3. `profiles` (one-to-one with `auth.users`)
4. `memberships`
5. `visitors`
6. `call_requests`
7. `call_events`

Branch slugs are globally unique because the canonical future route is `/c/{branchSlug}`. A tenant slug was omitted because Phase 1 has no tenant public route and the value would not yet identify anything.

## Role and scope model

`memberships.role` has exactly `PLATFORM_ADMIN`, `COFFEE_ADMIN`, and `STAFF`:

| Role | `tenant_id` | `branch_id` | Scope |
|---|---:|---:|---|
| `PLATFORM_ADMIN` | null | null | Global platform access. |
| `COFFEE_ADMIN` | required | null | One tenant and all its branches. |
| `STAFF` | required | optional | One branch when set; all tenant branches only when explicitly null. |

A check constraint enforces those shapes, and a composite `(branch_id, tenant_id)` foreign key prevents a branch assignment from crossing tenants. Roles are never read from user-editable Auth metadata. Creating/updating/deleting memberships is granted through RLS only to an already-established database-backed platform administrator; the initial administrator is created through the server-only demo/bootstrap path.

## RLS summary

- Every application table has RLS enabled.
- Platform administrators may read all tenant data.
- Coffee administrators may read their tenant and its branches/operational rows.
- Staff may read only authorized tenant/branch operational rows.
- Users may read their own profile/membership; coffee admins may view profiles/memberships within their tenant.
- Authenticated clients have no direct writes to `call_requests`, `call_events`, or `visitors` in Phase 1.
- Anonymous clients have no direct table privileges.
- `get_public_branch(text)` is a `SECURITY DEFINER` function with a fixed empty search path and a three-field result; it returns only an enabled branch owned by an active tenant.
- RLS helper functions live in the non-exposed `private` schema and use fixed search paths.

## Tenant integrity

- `branches` has `UNIQUE (id, tenant_id)`.
- `memberships(branch_id, tenant_id)` references that branch/tenant pair.
- `call_requests(branch_id, tenant_id)` references that branch/tenant pair.
- `call_events` references both its branch/tenant pair and its call/tenant/branch tuple.
- A call with `active_staff_user_id` is rejected unless that user has platform, tenant-admin, tenant-wide-staff, or matching branch-staff scope.

These checks apply even to privileged server writes that bypass RLS.

## Call preparation constraints

Partial unique indexes enforce:

- at most one `ACTIVE` call per branch;
- at most one `ON_HOLD` call per branch;
- at most one unresolved (`WAITING`, `ACTIVE`, `ON_HOLD`) call per visitor/branch.

Terminal `ENDED` and `CANCELLED` calls do not block a future request. The `stale_waiting_calls` index supports a later expiry job, but Phase 1 creates no scheduler.

No call transition commands are implemented. `version`, lifecycle timestamps, minimal events, and optional command ids merely prepare the authoritative database model for Phase 2.

## FIFO decision

`queue_sequence` is branch-scoped and assigned by a `BEFORE INSERT` trigger. The trigger:

1. locks the exact `(branch_id, tenant_id)` branch row with `FOR UPDATE`;
2. rejects a mismatched tenant/branch immediately;
3. assigns `max(queue_sequence) + 1` for that branch;
4. ignores any sequence supplied by the caller.

The branch lock serializes simultaneous inserts without browser timestamps, a global sequence, or an eighth counter table. `UNIQUE (branch_id, queue_sequence)` is the final guard. Ordering uses the lowest sequence first.

## Demo strategy

`supabase/seed.sql` contains non-secret tenant/branch fixtures only. `scripts/seed-demo.mjs` uses locally supplied service-role credentials to create Auth users, profiles, and the three membership scopes. No passwords or real credentials are committed.

## Automated coverage

- Tenant A cannot read Tenant B.
- Branch-scoped staff cannot read another branch or its calls.
- Anonymous table access to calls is denied.
- Public branch resolution returns only minimal enabled-branch data.
- One-active, one-held, and one-unresolved constraints.
- Active calls in different branches are allowed.
- Future calls after terminal states are allowed.
- Cross-tenant branch and active-staff references are rejected.
- FIFO sequence is branch-scoped, monotonic, and caller-proof.
- User metadata cannot grant platform access or bypass membership RLS.
- Route role matrix and session-proxy route scope.

## Deviations and clarifications from Phase 0

- The specific Phase 1 request requires optional branch scope on `memberships`; Phase 0 had deferred branch assignment.
- `PLATFORM_ADMIN` is represented as a global membership row rather than `profiles.platform_role`, matching the Phase 1 membership contract while keeping privilege out of Auth metadata.
- `visitors.last_car_description` is present because Phase 1 explicitly requested it. Future customer work must define consent/retention; no customer flow writes it yet.
- Tenant status values are `ACTIVE`/`DISABLED`, as requested in Phase 1, rather than the earlier suggested `SUSPENDED` label.
- `call_requests.status` uses the Phase 1 field name instead of Phase 0's conceptual `state`; the five allowed values are unchanged.
- A tenant slug is omitted until a real tenant-scoped URL or administrative identity requires it. Branch slugs remain globally unique.
- Phase 1 does not perform the earlier suggested LiveKit or PWA spikes because the approved Phase 1 instruction explicitly excludes LiveKit, QR, and PWA implementation.

## Known Phase 1 limitations

- The real Supabase hosted/local stack must still be smoke-tested with project credentials; automated migration/RLS coverage uses PGlite.
- Staff/admin management UI is intentionally absent.
- Public visitors, realtime authorization, proximity, queue commands, voice, QR, and PWA remain later phases.
- Stale-request timeout and terminal-event retention remain product decisions; only supporting timestamps/indexes exist.

