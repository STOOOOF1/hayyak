# Phase 2 — authoritative call queue backend: implemented decisions

This document records the implementation of the approved Phase 2 request. The Phase 0/1 documents remain the product contract; where this phase changed or completed a preparatory detail, that difference is listed below.

Phase 2 makes the PostgreSQL database the sole source of truth for queue transitions. A new migration (`20260901100000_phase2_call_backend.sql`) adds transactional command functions on top of the untouched Phase 1 schema. No Phase 1 migration or history was rewritten.

## Anonymous visitor lifecycle (cookie/capability)

- A server-side helper (`src/server/anonymous-visitor.ts`) mints a cryptographically random 64-hex bearer token via `node:crypto`.
- The raw token is sent only in an `HttpOnly`, `Secure`, `SameSite=Lax`, long-lived (one year) cookie named `hayyak_visitor`. It is never stored, logged, or placed in the database.
- Only the SHA-256 hex digest of the token is persisted as `visitors.anonymous_identifier`. The Phase 2 migration adds a comment documenting this interpretation.
- `isPlausibleVisitorToken` rejects malformed tokens before they reach the RPC layer.

This keeps customers anonymous (no accounts, no phone verification) while giving each visitor a stable, capability-scoped identity so that the queue can enforce "one unresolved call per visitor per branch".

## Transactional command functions

All commands are PL/pgSQL, execute with `security definer` and a fixed empty search path, run entirely inside one transaction, and fail atomically (no partial state). The `private` helper functions live in the non-exposed schema.

| Function | Actor | Transition / behavior |
|---|---|---|
| `enqueue_call(slug, visitor, car_description)` | anonymous | Resolves branch by slug server-side, verifies enabled branch + active tenant, creates a `WAITING` call, returns the call plus its `queue_position`. Idempotent. |
| `answer_call(branch, call, staff)` | staff | `WAITING -> ACTIVE`. Rejects if an `ACTIVE` call already exists. |
| `hold_call(branch, call, staff)` | staff | `ACTIVE -> ON_HOLD`. Rejects if an `ON_HOLD` already exists. |
| `hold_and_answer_next(branch, activeCall, staff)` | staff | Atomically `ACTIVE -> ON_HOLD` **and** promotes the FIFO head `WAITING -> ACTIVE`. If no `WAITING` remains, the active call stays active and `answered_call_id` is null. |
| `resume_call(branch, call, staff)` | staff | `ON_HOLD -> ACTIVE`. Rejects while another call is `ACTIVE`. |
| `end_call(branch, call, staff)` | staff | `ACTIVE | ON_HOLD -> ENDED`. |
| `cancel_waiting_call(branch, call, visitor)` | anonymous | Customer cancels their **own** `WAITING` call only. |
| `update_car_description(branch, call, text, staff?, visitor?)` | anonymous or staff | Normalizes (max 100 chars), records the actor type in the event. |
| `get_customer_current_call(slug, visitor)` | anonymous | Returns only the caller's own unresolved call + position. |
| `get_branch_queue(branch, staff)` | staff | Returns `ACTIVE`, `ON_HOLD`, and the FIFO-ordered `WAITING` projections (no other-tenant data, no coordinates). |
| `expire_stale_waiting_calls(interval)` | authenticated (server/scheduler) | Cancels `WAITING` calls older than the threshold; never touches `ACTIVE`/`ON_HOLD`. |

### Car description safety

`car_description` is treated as untrusted text: it is trimmed, forced to `NULL` when empty, capped at 100 characters server-side (`INVALID_CAR_DESCRIPTION` otherwise), and returned as data ready to be escaped at render time. It is not used as SQL. No structured vehicle data is introduced.

### Stale-waiting expiration

`expire_stale_waiting_calls` uses `queued_at` (backfilled from `created_at` in the migration, then defaulted to `now()`). It selects expired `WAITING` rows with `FOR UPDATE SKIP LOCKED`, cancels them, and records a `STALE_TIMEOUT` event. The exit-gate requirement that abandoned `WAITING` calls expire is met without an always-on scheduler; a background job can call it later.

## Domain error codes

A `public.call_error_code` enum carries stable, informative error constants (`ACTIVE_CALL_EXISTS`, `HELD_CALL_EXISTS`, `CALL_NOT_WAITING`, `UNAUTHORIZED`, etc.) instead of leaking PostgreSQL internals. Commands raise exceptions mapped to these codes.

## Authorization and isolation

- Staff commands take an explicit `p_actor_user_id` and gate every branch operation through `private.user_can_operate_branch`, which checks real `memberships` rows — never user-editable Auth metadata — for `PLATFORM_ADMIN`, `COFFEE_ADMIN`, or matching branch-scoped `STAFF`.
- Anonymous commands are scoped to the visitor's own identifier and the requested branch; they can never read another visitor's call or a full branch queue.
- `SECURITY DEFINER` is safe here because privileges come from server-backed membership truth, ids are explicit parameters, the empty search path prevents search-path hijacking, and every query is schema-qualified.
- Normal users cannot self-promote to `PLATFORM_ADMIN`; only a database-backed membership grants that scope.
- Grants are minimal: anonymous functions to `anon`/`authenticated`, staff functions to `authenticated` only, and the expiry function to `authenticated` (server/scheduler). Direct table privileges from Phase 1 are unchanged.

## Idempotency

`enqueue_call` returns the caller's existing unresolved call instead of creating a duplicate, so a retried request cannot create two `WAITING` rows. `hold_and_answer_next` is atomic, so a retry cannot leave a half-held/half-answered state. Optional `command_id` values flow into events to support client retry reconciliation.

## Event rows

Every transition appends a row to `call_events` (via `private.append_call_event`) with `actor_type`, actor id, `from_status`/`to_status`, optional `command_id`, and JSON metadata. No records capture vendor coordinates or retain them; no voice recording exists.

## Automated coverage

Database integration tests (PGlite) prove:

- One active, one held, one unresolved visitor request per branch/visitor invariants.
- FIFO selection and atomic compound transitions (`hold_and_answer_next`).
- Answer, hold, hold-and-answer-next, resume, end, customer cancel, and description edit rules, including their invalid-state errors.
- Stale-waiting expiration of old `WAITING` while `ACTIVE`/`ON_HOLD` are untouched.
- Tenant and branch isolation at the command layer (Tenant A staff cannot operate Tenant B; branch-scoped staff cannot operate a sibling branch).
- Customer read privacy (own call only, position without leaking others).
- FIFO monotonicity under many rapid enqueues and a full FIFO drain that preserves the single-`ON_HOLD` invariant.

Application unit tests cover the anonymous token/cookie lifecycle and normalization.

All migration/RLS and command coverage runs against PGlite; the hosted/local Supabase stack must still be smoke-tested with project credentials.

## Deviations and clarifications from Phase 0/1

- Proximity validation is **not** implemented and no geolocation is collected; `enqueue_call` works without it. The Phase 3 customer flow adds proximity proof at the documented integration point (branch slug resolution), never persisting precise coordinates.
- Realtime publication/subscription is **not** deployed; the event rows that feed it are written and ready. Per the approved Phase 2 scope, the request-scoped anonymous realtime authorization spike remains a later deliverable.
- `queued_at` was added (and backfilled from `created_at`) because FIFO expiration needs a customer-facing enqueue timestamp distinct from audit `created_at`.
- The expiry function is exposed no earlier than necessary and only to the authenticated role; a scheduler job is a later deployment concern, not part of this phase's schema.

## Known Phase 2 limitations

- No scheduler calls `expire_stale_waiting_calls` yet; automatic cleanup requires a background job.
- Realtime publication, proximity proofing, and the customer/staff UI are deliberately out of scope and remain in later phases.
- The server command adapter (`src/server/queue.ts`) is exercised through types and the same RPC surface the database tests cover; end-to-end HTTP flow tests require a live Supabase connection.
