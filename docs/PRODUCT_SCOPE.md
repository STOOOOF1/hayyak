# Product scope

## Product statement

**حياك — HAYYAK** is a simple, multi-tenant voice queue/intercom for coffee shops. A customer physically near a branch opens that branch's public QR link, may type a short vehicle description, and requests a live voice connection with a worker. Staff answer a FIFO queue and may hold at most one active customer while answering another.

Hayyak is not a restaurant ordering system.

## MVP users and roles

- `PLATFORM_ADMIN`: operates the Hayyak platform and may administer all tenants.
- `COFFEE_ADMIN`: administers only the coffee-shop tenant(s) to which the user belongs, including branches, staff, and QR exports.
- `STAFF`: operates call queues only for branches belonging to the user's assigned tenant membership(s).
- Customer: an anonymous visitor with no account or login.

An authenticated person may belong to more than one tenant, but every request must select and authorize one tenant context. Platform-wide privilege is kept separate from tenant membership.

## Tenant hierarchy

```text
Hayyak platform
└── Coffee shop / tenant
    ├── Branch
    ├── Coffee admins and staff
    └── Branch call queues
```

Each tenant's records, staff permissions, realtime events, and voice access are isolated from every other tenant.

## Customer journey

1. Scan the printed branch QR code.
2. Open `https://welcome.zarraqai.com/c/{branchSlug}`.
3. Optionally enter `car_description`.
4. Press **اتصل بالكوفي**.
5. Grant one-time browser location access.
6. Server verifies that the customer is within the branch radius.
7. Grant microphone access when needed for the connection.
8. Enter `WAITING`, then `ACTIVE` when answered.
9. Optionally move to `ON_HOLD`, then back to `ACTIVE`.
10. Finish in `ENDED`; a request withdrawn before answer finishes in `CANCELLED`.

Location denial, an out-of-range result, or microphone denial must produce a short Arabic explanation and a retry path. PWA installation is never a prerequisite for any step.

## Vehicle description

The only vehicle input is optional free text:

- Field: `car_description`
- Label: **وصف السيارة — اختياري**
- Placeholder: **مثال: كامري بيضاء**
- Helper: **اكتب اسم السيارة أو لونها ليسهل على العامل معرفتك**
- Maximum: 100 Unicode characters after trimming

Empty input is valid. Staff may correct the description. The most recent value may be remembered locally on that browser/device. There are no brand, model, plate, color-selector, image, or vehicle-database concepts.

## Proximity rules

- Each branch has latitude, longitude, and `service_radius_meters`.
- Default radius is 200 m; configured values are constrained to 50–500 m.
- The browser requests location only after the call-button interaction.
- The browser sends a single position and its reported accuracy to a server endpoint.
- The server calculates the distance and decides whether enqueueing is permitted.
- Hayyak does not continuously track the customer and does not persist the submitted precise coordinates.
- If reported accuracy is too poor to make a trustworthy decision, request a fresh reading and explain why rather than silently expanding the radius.

## Staff queue surface

The dashboard contains only:

- **المتصل الآن**: the one `ACTIVE` customer, if present.
- **المعلّق**: the one `ON_HOLD` customer, if present.
- **في الانتظار**: `WAITING` customers in FIFO order.

Available actions are: **رد**, **تعليق**, **تعليق والرد على التالي**, **استئناف**, and **إنهاء**, plus editing `car_description`. Invalid actions are rejected server-side even if a stale UI displays them.

## MVP functional requirements

- Many isolated coffee-shop tenants on one platform.
- Branch management and globally unique branch slugs.
- Staff authentication and tenant membership authorization.
- Anonymous, proximity-gated call requests.
- Database-authoritative FIFO queue and five-state lifecycle.
- At most one active and one held request per branch.
- Realtime customer and staff updates.
- LiveKit/WebRTC voice without recording.
- Per-branch, print-quality SVG and PNG QR exports.
- Optional, installable, branch-aware PWA experience.
- Arabic RTL, mobile-first customer and staff interfaces.

## Explicitly out of scope

The MVP has no menu, products, orders, shopping cart, payments, delivery, parking spot numbers, loyalty, CRM, customer accounts, phone verification, AI, chat, speech transcription, voice recording, vehicle database, advanced analytics, subscriptions, billing, or plans.

Adding any of these requires explicit product-owner approval and a scope revision.

## Product success criteria for the MVP

- A nearby anonymous visitor can join the correct branch queue in a few taps.
- The same visitor cannot create duplicate unresolved requests for that branch.
- Two staff members acting concurrently cannot violate queue or hold rules.
- Customer and staff screens converge on database state after reconnecting.
- Voice interruption does not corrupt the queue state.
- A printed branch QR reliably opens only that branch's canonical URL.
- The normal web flow remains fully usable on browsers that cannot install PWAs.
