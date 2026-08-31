# Architecture

## Proposed MVP stack

| Layer | Choice | Reason |
|---|---|---|
| Web application | Next.js App Router + TypeScript | One deployable application for public, staff, admin, server endpoints, manifests, and QR exports. Strong mobile/PWA support without a separate backend. |
| UI | React, CSS/Tailwind CSS, Arabic RTL | Small responsive surface; avoid a large design system until needed. |
| Hosting | Vercel | Natural fit for Next.js and the canonical HTTPS domain. Keep provider-specific code at the edges. |
| Database/Auth/Realtime | Supabase Postgres, Auth, Realtime | Managed relational transactions, RLS, staff auth, and realtime from one service. |
| Voice transport | LiveKit Cloud/WebRTC | Mature rooms, participant tokens, and WebRTC infrastructure. It remains subordinate to database call state. |
| QR generation | Mature Node QR encoder (for example `qrcode`) + a proven PNG renderer | Deterministic SVG and high-resolution PNG from one canonical URL. |
| Tests | Vitest, Playwright, database integration tests, independent QR decoder | Unit, transaction/concurrency, browser, accessibility, PWA, and print-export coverage. |

Use current stable, supported releases when Phase 1 begins. Pin versions in the lockfile. No application scaffold is created in Phase 0.

## System context

```text
Customer mobile browser/PWA ─┐
                             ├── Next.js application/API ── Supabase Postgres/Auth
Staff/admin browser ─────────┘             │                    │
                                           │                    └── Supabase Realtime
                                           └── LiveKit token/control API ── LiveKit media
```

The Next.js server is the trust boundary for anonymous customer operations, visitor capability issuance, proximity validation, LiveKit token issuance, and protected QR exports. Staff authenticate through Supabase Auth. Transactional PostgreSQL commands own every queue mutation.

## Application areas

- `/c/[branchSlug]`: public Arabic RTL customer page.
- `/c/[branchSlug]/manifest.webmanifest`: dynamic branch-aware PWA manifest.
- `/staff`: authenticated queue dashboard scoped to a selected authorized tenant/branch.
- `/admin`: authenticated tenant administration and QR export surface.
- `/platform`: `PLATFORM_ADMIN` operations, kept separate from tenant admin routes.
- `/api/public/...`: narrow anonymous endpoints for visitor initialization, enqueue, own-call status/cancel, and voice token.
- `/api/staff/...`: authenticated command/query endpoints calling database functions.
- `/api/admin/branches/[id]/qr.svg|png`: authenticated deterministic QR exports.

Route names may be refined in implementation, but the trust boundaries must remain.

## Source-of-truth model

PostgreSQL owns:

- request state;
- FIFO queue position;
- active and held slots;
- staff authorization;
- accepted description edits;
- transition audit events.

Supabase Realtime distributes change notifications. LiveKit transports audio. Neither is authoritative. Clients render last-known state and refetch authoritative state on reconnect, missed event, command conflict, or page restoration.

## Customer request flow

1. Server resolves the globally unique branch slug and renders safe public branch metadata.
2. Server establishes a random visitor identity in a signed, Secure, HttpOnly, SameSite cookie. This is not a customer account.
3. Browser may restore only the previous free-text car description from local storage.
4. On **اتصل بالكوفي**, browser requests a fresh location reading.
5. A public preflight endpoint validates payload, cookie/capability, rate limits, reading freshness/accuracy, and distance server-side without storing the coordinates.
6. After proximity succeeds, the browser explains and requests microphone permission. A denial creates no queue request and offers retry.
7. Transactional enqueue revalidates the still-fresh position, creates one `WAITING` request, or returns the visitor's existing unresolved request idempotently. The coordinate remains only in request memory and is discarded.
8. Server returns an opaque, short-lived request capability and realtime subscription details limited to that request.
9. Customer subscribes, while periodic/refocus refetch protects against missed events.
10. When state becomes `ACTIVE`, the server verifies request capability plus database state and issues a short-lived LiveKit participant token for that request's room.
11. End/cancel actions update the database first. Transport cleanup follows.

Microphone permission is requested after proximity and before `WAITING`, matching the defined customer flow. Location is never continuously watched. The enqueue endpoint repeats distance validation so a client cannot bypass the preflight.

## Staff flow

1. Supabase Auth establishes staff identity.
2. Server and RLS resolve memberships; tenant/branch selection is always explicit.
3. Dashboard queries a compact projection: current active, current held, and FIFO waiting rows.
4. Supabase Realtime prompts projection updates.
5. Every staff action calls one transactional command; the UI never writes state directly.
6. After commit, the server issues/revokes LiveKit permissions as needed and clients refetch if transport reconciliation fails.

## Realtime design

- Authenticated staff subscribe only to channels/topics authorized for their tenant and selected branch.
- Anonymous customers subscribe only to a request-specific private topic using a short-lived server-issued capability/JWT with the visitor/request claim. They never subscribe to the full branch queue.
- Publish minimal events: request id, new state/version, position-change hint, and description-change hint. Fetch authorized views for current data.
- Queue position may be calculated on the authorized server query and broadcast as a request-specific update; do not expose other customers' descriptions.
- Reconnect logic refetches. Delivery may be duplicated or missed without breaking correctness.

Supabase's exact private-channel authorization mechanism must be proven with a spike before UI work. If secure anonymous private subscriptions are not viable with the selected SDK, keep Supabase Realtime server-side and relay request-scoped events through an authenticated server stream; never make the entire queue public as a shortcut.

## Voice design

- One LiveKit room per call request, named with a non-semantic random identifier.
- Only the assigned customer capability and currently authorized staff receive short-lived participant tokens.
- Tokens contain the minimum room and publish/subscribe grants and are minted server-side only after checking database state and tenant membership.
- No egress, recording, transcription, or persistence is enabled.
- Moving to `ON_HOLD` commits in PostgreSQL first, then removes/pauses that customer's audio permissions. Resume commits first, then restores them.
- LiveKit webhooks are used for operational reconciliation only; they do not advance or end a call automatically.
- If WebRTC disconnects, the request remains in its database state and can reconnect with a newly authorized token.

## Atomic command boundary

All branch queue mutations serialize on the branch row inside PostgreSQL. Partial unique indexes guarantee the one-active, one-held, and one-unresolved-per-visitor invariants even if application code is wrong. State comparisons and event insertion happen in the same transaction. See `DATA_MODEL.md` and `CALL_STATE_MACHINE.md`.

## Concise architecture decisions

### ADR-001 — Supabase

**Decision:** Use Supabase Postgres, Auth, and Realtime.  
**Why:** The product needs relational constraints, transactional queue operations, tenant policies, staff auth, and realtime. One managed platform provides these without several custom services.  
**Consequence:** Queue logic belongs in reviewed SQL functions and RLS; service-role credentials stay server-only.

### ADR-002 — LiveKit

**Decision:** Use LiveKit only for WebRTC media transport.  
**Why:** Building signaling, NAT traversal, and mobile WebRTC reliability is not MVP work.  
**Consequence:** Database state wins on disagreement; no recording/egress is configured.

### ADR-003 — Anonymous visitor identity

**Decision:** Use a server-generated random visitor id referenced by a signed HttpOnly cookie, plus short-lived request capabilities.  
**Why:** It prevents IP-based identity and avoids customer registration while allowing duplicate-request protection.  
**Consequence:** Clearing browser data creates a new visitor; that is acceptable. The identifier is not meaningful personal identity.

### ADR-004 — Atomic queue transitions

**Decision:** Use transactional database commands, a per-branch row lock, state preconditions, and partial unique indexes.  
**Why:** Frontend checks and separate API writes cannot handle concurrent staff safely.  
**Consequence:** All writers use the command functions; direct client table mutation is denied.

### ADR-005 — Multi-tenant isolation

**Decision:** Carry `tenant_id` on tenant-owned rows, use composite foreign keys and RLS, and authorize tenant context at every server boundary.  
**Why:** Isolation needs both structural and policy-level defenses.  
**Consequence:** Cross-tenant policy tests are release-blocking.

### ADR-006 — QR generation

**Decision:** Generate deterministic SVG and 2048/4096 PNG from only the canonical branch URL, with a mature encoder, high contrast, print error correction, and a large quiet zone.  
**Why:** Scan and print reliability matter more than decoration.  
**Consequence:** No logo by default; exports and decode tests are part of the implementation plan.

### ADR-007 — Branch-aware PWA

**Decision:** Serve a manifest per branch with stable branch-specific `id` and `start_url`, while sharing one safe application/service-worker implementation.  
**Why:** An installed entry should return to the originating branch without duplicating the web app.  
**Consequence:** Browser/OS identity behavior differs, especially on iOS, so installation remains optional and contextual.

## Simplicity constraints

- One web codebase, one relational database, one realtime provider, one voice provider.
- Seven core tables.
- No microservices, message broker, event-sourcing framework, cache tier, or analytics warehouse for the MVP.
- `call_events` is a compact audit log; `call_requests` remains the current-state model.
- Do not add branch-level staff assignment, complex roles, or background orchestration until a proven requirement appears.
