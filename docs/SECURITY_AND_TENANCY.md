# Security and tenancy

## Security goals

1. A tenant can never read, mutate, subscribe to, or join the voice of another tenant.
2. An anonymous visitor can access only public branch metadata and that visitor's own request.
3. Concurrent staff actions cannot violate call invariants.
4. Customer location, microphone, and vehicle text are handled with minimum collection and retention.
5. Server-only credentials and signing keys never reach browsers.

## Tenant boundary

- `tenant_id` is mandatory on every tenant-owned operational row.
- Composite foreign keys prevent a row from referring to a branch/call in a different tenant.
- Globally unique branch slugs resolve to exactly one branch and tenant.
- Coffee users obtain access only through `memberships(tenant_id, profile_id, role)`.
- `PLATFORM_ADMIN` is a separate platform role, not a tenant membership shortcut.
- Every request, database function, realtime topic, and LiveKit token is scoped to one resolved tenant and usually one branch/call.
- Tenant ids from URL/body input are never trusted without membership verification.

## Supabase Auth and authorization

- Supabase Auth is used only for platform and coffee staff/admin users.
- Staff/admin routes require a valid session and server-side membership check.
- RLS policies use `auth.uid()` and membership existence for tenant reads.
- `COFFEE_ADMIN` may administer its tenant; `STAFF` receives only queue operations/read projections needed for work.
- Platform operations require `profiles.platform_role = 'PLATFORM_ADMIN'` and are separated in route and policy code.
- Role assignment, staff invitation, and platform-admin promotion are privileged, audited actions.
- Service-role keys are server-only. Code using them must call narrow operations and explicitly establish the tenant scope because service role bypasses RLS.

## RLS policy shape

- Enable RLS on all exposed application tables, including `tenants`, `branches`, `profiles`, `memberships`, `call_requests`, and `call_events`.
- Authenticated tenant reads require an appropriate membership for the row's `tenant_id`.
- Direct client inserts/updates/deletes on `call_requests` and `call_events` are denied; transactional functions own mutations.
- Coffee admins can manage only rows in their memberships' tenants.
- Staff cannot edit tenant/branch configuration or memberships.
- Visitors receive no direct table grants. Public metadata and own-call views are returned by server endpoints with explicit projections.
- Database command functions use fixed `search_path`, qualified object names, strict argument validation, and the least privileged owner. Revoke default `PUBLIC` execute grants and grant only the intended server/staff role.

## Anonymous visitor security

- Create a cryptographically random visitor id server-side and bind it to a signed, `Secure`, `HttpOnly`, `SameSite=Lax` cookie.
- Do not use IP address as identity. IP may be processed transiently by infrastructure/rate limiting but is not an application customer identifier.
- A successful enqueue response provides a separate, random, short-lived capability for that request. Store only a hash server-side if persistent verification is required.
- Visitor endpoints derive visitor/request scope from verified cookies/capabilities, never solely from a request UUID in the URL.
- Customer realtime authorization is request-specific and expires. It must not reveal the branch queue or other vehicle descriptions.
- Remembered `car_description` uses local browser storage only, is optional, and can be cleared by the customer.

## Proximity and privacy

- Ask for location only after the customer presses **اتصل بالكوفي**.
- Send one recent position plus reported accuracy over HTTPS.
- Calculate proximity on the server/inside the enqueue transaction.
- Do not insert precise customer coordinates into logs, events, database rows, analytics, error traces, or realtime payloads.
- Avoid logging complete enqueue request bodies. Redact location and capability values at the logging boundary.
- Reject stale, impossible, or unacceptably inaccurate positions with a retryable Arabic response.
- Browser geolocation is a practical proximity control, not strong anti-spoofing. The MVP should state that limitation rather than collect invasive signals.

## Input and web security

- Validate `car_description` server-side: normalize safely, trim, convert empty to null, and enforce at most 100 Unicode characters.
- Render vehicle text as text, never HTML. Use parameterized SQL for all inputs.
- Validate branch slugs against a strict lowercase ASCII pattern.
- Use HTTPS, HSTS, secure cookies, CSRF protection for cookie-authenticated mutations, origin checks, and restrictive CORS.
- Apply a Content Security Policy compatible with Supabase and LiveKit endpoints; restrict camera access and request only microphone/geolocation permissions when needed.
- Rate-limit visitor initialization, enqueue, status, cancel, and token endpoints by layered signals (capability/cookie, branch, and transient network controls). Do not turn IP into identity.
- Add request body limits and command idempotency keys.
- Never place Supabase service-role, visitor-signing, or LiveKit API secrets in `NEXT_PUBLIC_*` variables.

## Voice security

- Mint short-lived, least-privilege LiveKit participant tokens server-side after checking tenant membership or visitor capability and current database state.
- Room names are random/non-semantic and unique per request.
- Customers cannot list rooms or join another request. Staff tokens are limited to the selected authorized call.
- Hold state is enforced in database first and reflected in participant permissions/audio controls.
- Disable LiveKit recording, egress, and transcription. Validate webhook signatures; webhooks are reconciliation signals only.

## Realtime security

- Staff branch topics require authenticated membership.
- Customer topics are private and request-scoped using expiring claims/capabilities.
- Realtime payloads contain only the minimum. Never broadcast the whole tenant queue to a public channel.
- A client treats messages as hints and re-fetches through an authorized endpoint.

## Audit and retention

- `call_events` records accepted business transitions and staff description edits with actor and timestamp.
- Do not put coordinates, voice, tokens, or secrets in events.
- Authentication/admin security events belong in provider/security logs; do not turn the product event table into a general telemetry store.
- Define and disclose a short retention period for ended/cancelled calls and events before launch. Delete or aggregate operational history when no longer necessary.

## Required security tests

- RLS matrix for all three roles and unauthenticated clients.
- Cross-tenant reads, writes, RPC calls, realtime subscriptions, QR admin exports, and LiveKit token requests all fail.
- A coffee admin cannot promote a platform admin or manage another tenant.
- Anonymous capability tampering, request-id guessing, replay, expiration, CSRF, and duplicate enqueue tests.
- XSS and Unicode length tests for `car_description`.
- Location is absent from database, events, realtime payloads, and application logs.
- Concurrency stress tests prove active, held, visitor, FIFO, and atomic-transition invariants.
- Secret scanning and production header/CSP checks.

## Operational safeguards

- Use separate development, staging, and production Supabase and LiveKit projects.
- Back up Postgres and practice restore before launch.
- Alert on elevated authorization failures, queue-command errors, token-mint failures, and realtime/voice service degradation without logging sensitive payloads.
- Maintain a documented way for platform operators to suspend a compromised tenant without affecting others.

