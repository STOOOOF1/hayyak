# حياك — HAYYAK

Hayyak is an intentionally simple, multi-tenant voice queue/intercom for coffee shops. This repository currently contains the **Phase 1 foundation only**: an Arabic RTL Next.js shell, Supabase staff authentication, a tenant-safe PostgreSQL schema, RLS, demo bootstrap, and automated isolation/constraint tests.

It does not yet implement the customer call flow, geolocation, microphone access, LiveKit, queue commands/UI, QR generation, or PWA installation.

## Requirements

- Node.js 20.9 or newer
- npm
- A Supabase project, or Docker Desktop for the optional local Supabase stack

## Local development

```bash
npm install
```

Copy `.env.example` to `.env.local` and replace the placeholders. Required application variables:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

`SUPABASE_SERVICE_ROLE_KEY` is server/script-only and is used by the demo bootstrap. It must never use a `NEXT_PUBLIC_` prefix.

Start the app:

```bash
npm run dev
```

The root application is Arabic-first (`lang="ar"`, `dir="rtl"`). Protected shells are available at `/staff`, `/admin`, and `/platform`. The Phase 1 public placeholder resolves `/c/hayyak-demo` through a narrow database function.

## Supabase and migrations

The local Supabase CLI commands are version-pinned through npm scripts:

```bash
npm run db:start
npm run db:reset
```

`db:reset` applies migrations in `supabase/migrations/` and then `supabase/seed.sql`. For a linked hosted project, review the target and run:

```bash
npm run db:push
```

The migration enables RLS on all seven application tables. Anonymous clients receive no table grants; the only anonymous database surface is `get_public_branch(text)`, which returns minimal metadata for an enabled branch in an active tenant.

## Demo setup

`supabase/seed.sql` creates only:

- tenant: **حياك كوفي**
- branch: **الفرع التجريبي**
- slug: `hayyak-demo`

To create the three Supabase Auth demo identities and their database memberships, supply strong local values for all `DEMO_*` variables in `.env.local`, then run:

```bash
npm run demo:seed
```

The script creates a global `PLATFORM_ADMIN`, a tenant `COFFEE_ADMIN`, and a branch-scoped `STAFF`. It rejects placeholder/short passwords and never prints passwords. Initial platform-admin creation requires the server-only service role; browser users cannot create or promote platform administrators.

## Quality commands

```bash
npm run lint
npm run typecheck
npm run test:db
npm run test:app
npm run test
npm run build
```

On normal CI/Linux environments, `npm run build` uses Next.js's native compiler. If the Windows native SWC binding cannot load, the build script automatically selects the pinned, matching WebAssembly compiler and Webpack; it remains a production build, only slower. `HAYYAK_FORCE_SWC_WASM=1` can explicitly select that fallback for diagnosis.

Database tests run the real migration in PGlite (PostgreSQL compiled to WebAssembly), so constraint and RLS tests do not require Docker. Supabase CLI/Docker remains the recommended local integration environment before deployment.

## Architecture references

- Phase 0 contract: `docs/`
- Implemented Phase 1 decisions: `docs/PHASE1_FOUNDATION.md`
- Repository guardrails: `AGENTS.md`
