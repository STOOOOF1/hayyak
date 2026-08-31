# Implementation phases

Each phase begins only after explicit product-owner approval. Do not silently pull later-phase work forward. Preserve the scope and invariants in the Phase 0 documents.

## Phase 0 — Product and architecture contract (this phase)

Deliver only the product, architecture, data, state-machine, QR/PWA, security/tenancy, implementation-plan documents, and repository `AGENTS.md`.

Exit gate:

- Product owner approves scope, stack, transition rules, tenancy model, and open decisions.
- No application scaffold or implementation is present.

## Phase 1 — Foundation and risk spikes

- Scaffold one Next.js TypeScript application with Arabic RTL baseline, formatting, linting, and test harness.
- Configure local/staging Supabase and environment validation without committing secrets.
- Create the seven-table schema, enums, constraints, indexes, RLS, and seed fixtures.
- Implement/test tenant membership authorization and branch slug resolution.
- Spike secure request-scoped anonymous Supabase Realtime authorization.
- Spike branch-aware manifest identity/launch behavior on Android Chrome and iOS Safari.
- Prove LiveKit room/token connectivity without building the full queue UI.
- Record any necessary architecture revision before proceeding.

Exit gate: automated cross-tenant tests pass; risky provider/browser assumptions have evidence; no full product flow is implied.

## Phase 2 — Authoritative queue backend

- Implement visitor cookie/capability lifecycle.
- Implement server-side proximity validation without coordinate persistence.
- Implement transactional enqueue, answer, hold, hold-and-answer-next, resume, end, cancel, and description edit commands.
- Add authorized queue/own-call query projections and idempotency behavior.
- Add event rows and realtime publication/subscription path.
- Stress concurrent commands from multiple workers.

Exit gate:

- Database tests prove one active, one held, one unresolved visitor request, FIFO selection, atomic compound transitions, and tenant isolation.
- Logs/events are verified free of precise customer coordinates and secrets.

## Phase 3 — Customer web flow

- Build the Arabic RTL, mobile-first branch page.
- Implement optional description with local memory, location permission/proximity errors, enqueue, position/status, cancel, reconnect, and terminal screens.
- Keep installation UI absent or passive until the call flow is validated.
- Add accessibility, slow-network, denied-permission, background/restore, and in-app-browser handling.

Exit gate: QR URL to `WAITING` works on representative iOS and Android browsers without PWA installation.

## Phase 4 — Staff dashboard

- Build authenticated tenant/branch selection.
- Render only **المتصل الآن**, **المعلّق**, and FIFO **في الانتظار**.
- Implement the five staff actions and description edit through transactional commands.
- Handle conflicts/stale state by showing authoritative state and refetching.
- Test two or more concurrent staff sessions.

Exit gate: all staff commands and concurrency scenarios work without invalid slot states or cross-tenant exposure.

## Phase 5 — Live voice integration

- Issue least-privilege, short-lived LiveKit tokens after database authorization.
- Connect customer and authorized staff to one room per request.
- Reconcile hold/resume/end with audio permissions after database commits.
- Add reconnection and provider-degradation behavior; do not change business state on transport disconnect.
- Confirm recording, egress, and transcription are disabled.

Exit gate: voice works across target mobile networks/devices, hold prevents conversation audio, reconnect preserves database state, and token isolation tests pass.

## Phase 6 — QR exports and optional PWA

- Build protected admin QR panel and deterministic SVG/2048 PNG exports (4096 optional).
- Add independent decode, format, quiet-zone, downscale, and print tests.
- Produce and scan real proofs at 50 mm and recommended 70–100 mm sizes.
- Implement branch manifests, icons, safe service worker, standalone detection, dismissal cooldown, Android prompt integration, and iOS contextual guide.
- Verify branch launch identity on current target devices; document unavoidable OS limitations.

Exit gate: printed codes reliably open the correct canonical branch, installation never blocks the call UI, and an installed launch returns to the expected branch where the OS supports it.

## Phase 7 — Hardening and release

- End-to-end happy paths and permission/error paths.
- Full RLS/cross-tenant/capability/CSRF/XSS/security-header test matrix.
- Accessibility and Arabic RTL review on small screens.
- Load test enqueue and branch-lock contention at expected scale.
- Verify backups/restore, secret separation, alerts, runbooks, tenant suspension, and retention/deletion policy.
- Pilot with one controlled branch, including sign placement and real staff workflow, before multi-tenant rollout.

Exit gate: release checklist signed off by product owner and technical owner.

## Testing strategy by concern

| Concern | Minimum evidence |
|---|---|
| Call correctness | Database integration and parallel transaction tests; partial-index violation attempts. |
| Tenancy | RLS/API/realtime/voice negative matrix across two seeded tenants. |
| Proximity | Unit tests for distance/boundaries/accuracy/staleness plus device tests; assert coordinates are not persisted/logged. |
| Realtime | Duplicate, missed, delayed, reconnect, and authorization tests; refetch convergence. |
| Voice | Token scope, hold/resume, reconnect, device/network matrix; recording disabled. |
| QR | Exact URL, independent decode, SVG/PNG, quiet zone, downscale/degradation, physical proof. |
| PWA | Manifest validation, install UX, standalone detection, dismissals, offline truthfulness, Android/iOS devices. |
| UX | Arabic RTL, keyboard/screen reader, permission denial, slow/offline, small mobile viewport. |

## Open decisions to resolve before or during Phase 1

1. **Inaccurate location policy:** choose the maximum acceptable browser accuracy and retry wording. Do not expand the service radius silently.
2. **Stale waiting requests:** define when abandoned `WAITING` calls expire/cancel and how the customer is warned. Browser close alone is not reliable.
3. **Retention:** approve the retention period for terminal calls and `call_events`.
4. **Resume semantics:** this contract requires no current active call before `ON_HOLD -> ACTIVE`; confirm that staff should end the second call first rather than implement an implicit swap.
5. **Realtime capability:** prove secure request-scoped Supabase Realtime for non-account visitors; use a server relay if the provider flow cannot meet isolation cleanly.
6. **LiveKit hold enforcement:** choose and test the exact permission/mute mechanism across reconnects.
7. **PWA identity:** verify how many branch-specific installs target iOS/Android versions actually distinguish.
8. **Slug permanence:** decide whether production branch slugs become immutable after QR printing (recommended).
9. **Supported browsers/devices:** define the launch matrix, especially iOS Safari, Android Chrome, and common in-app QR browsers.

## Scope protections

Do not add billing, plans, menu/order/payment features, customer accounts, chat, AI, recordings, analytics infrastructure, structured vehicles, microservices, or complex staff scheduling during these phases. Any such request returns to product scoping before implementation.

