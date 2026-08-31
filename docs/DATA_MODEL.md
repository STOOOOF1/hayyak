# Data model

## Principles

- PostgreSQL is authoritative.
- Keep the core to seven tables.
- Every tenant-owned operational row carries `tenant_id` for explicit policy checks and efficient filtering.
- Public visitors never receive general table access.
- Precise submitted customer coordinates are used in memory during enqueue validation and are not stored.
- Timestamps are UTC `timestamptz`; identifiers are random UUIDs.

## Enums

- `platform_role`: `PLATFORM_ADMIN` (nullable on ordinary profiles)
- `tenant_role`: `COFFEE_ADMIN`, `STAFF`
- `call_state`: `WAITING`, `ACTIVE`, `ON_HOLD`, `ENDED`, `CANCELLED`
- `call_actor_type`: `VISITOR`, `STAFF`, `SYSTEM`

Keep platform privilege out of tenant role values: `PLATFORM_ADMIN` is global, while coffee roles exist only through a membership.

## Tables

### `tenants`

| Column | Notes |
|---|---|
| `id uuid pk` | Random identifier. |
| `name text` | Display name. |
| `slug text unique` | Administrative identity; not the public branch route. |
| `status text` | Minimal `ACTIVE`/`SUSPENDED` check if operational suspension is needed. |
| `created_at timestamptz` | Audit timestamp. |

### `branches`

| Column | Notes |
|---|---|
| `id uuid pk` | Random identifier. |
| `tenant_id uuid fk tenants` | Owning tenant. |
| `slug text unique` | Globally unique because public URLs are `/c/{branchSlug}`. Lowercase canonical format. |
| `name text` | Branch display name. |
| `latitude double precision` | Valid range -90…90. |
| `longitude double precision` | Valid range -180…180. |
| `service_radius_meters integer default 200` | Check 50…500. |
| `created_at`, `updated_at` | Audit timestamps. |

Add `UNIQUE (id, tenant_id)` so composite foreign keys can prove tenant consistency. Slug changes are an explicit admin operation because they change the canonical URL and printed QR destination.

### `profiles`

| Column | Notes |
|---|---|
| `id uuid pk fk auth.users` | Authenticated staff/admin identity. |
| `display_name text` | Staff-facing name. |
| `platform_role platform_role null` | Only platform operators receive `PLATFORM_ADMIN`. |
| `created_at`, `updated_at` | Audit timestamps. |

### `memberships`

| Column | Notes |
|---|---|
| `id uuid pk` | Random identifier. |
| `tenant_id uuid fk tenants` | Tenant boundary. |
| `profile_id uuid fk profiles` | Authenticated user. |
| `role tenant_role` | `COFFEE_ADMIN` or `STAFF`. |
| `created_at` | Audit timestamp. |

Use `UNIQUE (tenant_id, profile_id)`. Branch-level staff assignment is intentionally deferred; in the simple MVP, tenant staff can operate that tenant's branches. Add branch assignment only if the product owner requires it.

### `visitors`

| Column | Notes |
|---|---|
| `id uuid pk` | Server-generated random identity referenced by a signed, HttpOnly visitor cookie. |
| `created_at`, `last_seen_at` | Minimal lifecycle metadata. |

No IP address, coordinates, phone number, account credentials, or permanent vehicle profile is required. The optional remembered description stays in browser storage. A visitor can use multiple tenants; `visitors` is therefore platform-scoped and carries no tenant ownership.

### `call_requests`

| Column | Notes |
|---|---|
| `id uuid pk` | Also supplies an unguessable voice-room suffix; do not expose it as authorization by itself. |
| `tenant_id uuid` | Explicit tenant boundary. |
| `branch_id uuid` | Composite FK `(branch_id, tenant_id) -> branches(id, tenant_id)`. |
| `visitor_id uuid fk visitors` | Anonymous visitor identity. |
| `car_description varchar(100) null` | Trim empty strings to null. |
| `state call_state` | Authoritative business state. |
| `queue_sequence bigint identity unique` | Monotonic FIFO key allocated by PostgreSQL. Gaps are harmless. |
| `queued_at timestamptz` | Customer-facing/audit queue timestamp, set by database. |
| `answered_at`, `held_at`, `ended_at`, `cancelled_at` | Nullable lifecycle timestamps. |
| `answered_by uuid null fk profiles` | Last staff member who answered/resumed. |
| `version bigint default 1` | Increment on each mutation for stale-event detection. |
| `created_at`, `updated_at` | Audit timestamps. |

Add `UNIQUE (id, tenant_id)` for event foreign keys. Do not store customer coordinates or WebRTC connection status here.

### `call_events`

| Column | Notes |
|---|---|
| `id bigint generated always as identity pk` | Ordered event identifier. |
| `tenant_id uuid`, `branch_id uuid`, `call_request_id uuid` | Composite foreign keys maintain tenant consistency. |
| `from_state call_state null`, `to_state call_state null` | Null for a non-state event such as description edit. |
| `event_type text` | Small allowlist such as `ENQUEUED`, `ANSWERED`, `HELD`, `RESUMED`, `ENDED`, `CANCELLED`, `DESCRIPTION_UPDATED`. |
| `actor_type call_actor_type` | Visitor, staff, or system. |
| `actor_profile_id uuid null` | Present for staff actor. |
| `command_id uuid null` | Client command/idempotency key for mutations; unique within a tenant when present. |
| `metadata jsonb default '{}'` | Only minimal non-sensitive command metadata; never voice or coordinates. |
| `created_at timestamptz` | Database timestamp. |

This is a compact audit/realtime aid, not an analytics event warehouse.

## Mandatory indexes and constraints

Conceptual PostgreSQL definitions:

```sql
create unique index one_active_call_per_branch
  on call_requests (branch_id)
  where state = 'ACTIVE';

create unique index one_held_call_per_branch
  on call_requests (branch_id)
  where state = 'ON_HOLD';

create unique index one_unresolved_call_per_visitor_branch
  on call_requests (branch_id, visitor_id)
  where state in ('WAITING', 'ACTIVE', 'ON_HOLD');

create index waiting_fifo
  on call_requests (branch_id, queue_sequence)
  where state = 'WAITING';

create index call_events_by_call
  on call_events (call_request_id, id);

create unique index one_command_receipt_per_tenant
  on call_events (tenant_id, command_id)
  where command_id is not null;
```

Also use check constraints for coordinate ranges, radius 50–500, description length, valid slug format, lifecycle timestamp consistency where practical, and composite foreign keys that prevent cross-tenant references.

## Transactional command functions

Expose a small command surface, not arbitrary updates:

- `enqueue_call(branch_slug, visitor_id, latitude, longitude, accuracy, car_description, idempotency_key)`
- `answer_call(branch_id, call_id, actor_profile_id, idempotency_key)`
- `hold_call(branch_id, call_id, actor_profile_id, idempotency_key)`
- `hold_and_answer_next(branch_id, active_call_id, actor_profile_id, idempotency_key)`
- `resume_call(branch_id, call_id, actor_profile_id, idempotency_key)`
- `end_call(branch_id, call_id, actor_profile_id, idempotency_key)`
- `cancel_waiting_call(call_id, visitor_id, idempotency_key)`
- `update_car_description(branch_id, call_id, actor_profile_id, value)`

These are transaction boundaries implemented as tightly permissioned PostgreSQL functions (or a server transaction with exactly equivalent locking). Queue functions lock the branch row first, recheck authorization and preconditions, mutate rows, and append events before commit. Direct `UPDATE` permissions on call tables are denied to application clients.

The command function first checks `call_events.command_id`; a retry returns the previously committed result instead of executing again. The tenant-scoped unique index closes concurrent retry races without adding another table. This is especially important for **تعليق والرد على التالي**, where executing the same intent twice could otherwise advance two waiting customers.

## Proximity calculation

Use a tested SQL Haversine function (earth radius 6,371,000 m) against the stored branch latitude/longitude, or Supabase's supported PostGIS `geography` point if available in the chosen environment. The server must account for browser-reported accuracy conservatively and reject implausible or stale readings. The input coordinate values are not inserted into any table or event.

## Deliberately absent data

There are no tables for menus, products, orders, payments, subscriptions, customer accounts, vehicles, recordings, transcripts, chat, CRM, or analytics.
