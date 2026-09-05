# Solar Pulse OS

A multi-tenant ERP for Solar Pulse — covering HR, finance, sales, distribution, technical, O&M,
tender, DISCOM, marketing, store, and CEO oversight. Built on Next.js 16 with a Postgres /
Supabase backend where Row-Level Security (RLS) is the actual security boundary.

## Stack

- **Next.js 16.3.0** (App Router, Turbopack, React Compiler)
- **React 19.2.8**
- **Supabase** — Postgres + Auth + Storage, RLS-enforced
- **Tailwind CSS** with a brand-gold / brand-slate palette
- **Zod** for every input boundary
- **@anthropic-ai/sdk** for AI features (optional)
- **react-hook-form + zod** for the form-heavy modules

## Repository layout

```
app/                   Next.js App Router. One folder per module.
  api/                 Route handlers. Every body is zod-validated.
  <module>/            Per-module pages. Each guards via lib/auth/guards.
  error.tsx            Segment-level error boundary
  global-error.tsx     Last-line defence (root layout errors)
  not-found.tsx        Branded 404
components/            Shared UI + per-module components
lib/                   Domain services, auth guards, validation, audit
supabase/migrations/   24 SQL files applied in filename order
```

## Local development

### 1. Install

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
# then fill in the values — see .env.example for what each one does
```

You need a Supabase project (URL + anon key + service-role key). An Anthropic key is optional.

### 3. Database

Apply the migrations in `supabase/migrations/` in numeric order against your Supabase project.
The Supabase SQL editor is the simplest path; the Supabase CLI works too. Migrations 0009
onward are NOT idempotent — apply on a fresh database or one that already matches the prior
files, not in a partially-migrated state.

`0002_seed_departments_roles.sql` seeds the organisation, departments, roles, and permissions
(idempotent). It seeds NO users — Supabase auth users are created from the Auth dashboard, and the
provisioning helper requires an auth row to exist first.

For a fresh install, the full bootstrap flow is in `supabase/bootstrap_fresh_system.sql`. In short:

1. Apply the migrations in numeric order (Supabase SQL editor is the simplest path).
2. In the Supabase dashboard, create two auth users with confirmed emails:
   - `ceo@solarpulse.in` (the org-wide CEO)
   - `hr@gmail.com` (the HR lead)
3. Paste `supabase/bootstrap_fresh_system.sql` into the SQL editor and run it. It wires the two
   users to the public schema, sets their roles, and prints a verification query showing the
   resulting state. The script is idempotent and refuses to run if any prerequisite is missing.
4. Sign in as the CEO. The forced-password gate requires a password reset on first login (the
   `must_change_password` flag from the helper, enforced by `proxy.ts`).
5. From the CEO's first session, use `/hr/onboarding/new` to onboard every other employee. That
   is the system's design — the CEO is the lever everyone else is reached through.

## Resetting the database (preserve CEO + HR Lead)

For a development database or a staging mirror you want wiped clean, paste
`supabase/wipe_all_data_preserve_logins.sql` into the SQL editor. It empties every data
table — candidates, employees, salaries, leave, applications, reports, expenses, audit
logs, everything — while keeping `auth.users` rows for `ceo@solarpulse.in` and
`hr@gmail.com` so the two protected logins still work. Schema, policies, roles, and
permissions are untouched. The script prints a before/after row count for every
table so you can verify the wipe.

**This is irreversible** — the audit log is wiped too. Take a backup first.

## Re-seeding CEO + HR users after a manual wipe

If you wiped the database by hand and need the two protected logins back, paste
`supabase/reseed_ceo_and_hr.sql` into the SQL editor. It creates the auth.users rows
for `ceo@solarpulse.in` and `hr@solarpulse.in` with a known password (see the script
header for the default and how to change it), confirms their emails, and wires both
into the public schema via `provision_app_user()`. Idempotent — safe to re-run.

### 4. Run

```bash
npm run dev
```

The dev server uses Turbopack. **Do not run `npm run build` while it is live** — it clobbers
the `.next` directory the dev server is serving. Use `npx tsc --noEmit` and `npx eslint` to
typecheck and lint instead.

## Quality gates

```bash
npx tsc --noEmit     # typecheck
npx eslint .         # lint
```

Both must pass cleanly. `tsc` is on strict mode; `eslint` does not have `ignoreDuringBuilds`
set, so any lint error will fail `next build`.

## Deployment

### Vercel (the default)

1. Push to a Git provider connected to Vercel.
2. Set every env var from `.env.example` in the Vercel project settings. **Set
   `QR_RESOLVE_SECRET`** if your QR kiosk is reachable beyond a trusted LAN — without it the
   `/api/qr/resolve` endpoint serves employee PII unauthenticated.
3. `next build` runs `tsc` and `eslint`; both must pass.

### Self-hosted

Set `output: 'standalone'` in `next.config.ts` for a Docker-friendly bundle, then run:

```bash
node .next/standalone/server.js
```

Set the same env vars in the container / host.

## Health and observability

- `GET /api/health` — liveness/readiness for uptime monitors. Returns 200 + `{ok, app, db,
  timestamp}` when the app AND database are reachable; 503 with a `reason` otherwise.
- Runtime errors are caught by `app/error.tsx` and `app/global-error.tsx` and logged to the
  platform via `console.error` with the `digest`. Wire a real error tracker (Sentry) by adding
  the SDK call inside the `useEffect` in `app/error.tsx`.
- All mutating actions are audit-logged via `logAction`; sensitive reads via
  `logSensitiveAccess`. Audit rows are service-role only — no user can insert or modify them.

## Security model

- **RLS is the boundary.** `lib/auth/guards.ts` is a fast-fail UX layer that redirects
  unauthenticated users; Postgres policies decide which rows each user can see. Both must agree.
- **Service-role keys** bypass RLS and are used only in privileged server paths (onboarding,
  audit logging, AI settings, QR token mint/resolve). Each path has its own `assert*` permission
  check.
- **Input validation** — every API route validates its body with zod before use. No string-built
  SQL.
- **Signed URLs** — every read of HR/Finance/employee storage objects uses 5-minute signed URLs.

## Known gaps before going to production

The code and build are healthy; the operational scaffolding around them is what still needs
work before a real ship:

1. **RLS verification on the live database.** The policies are written but have not been
   exercised against real data. Before launch, run per-role access tests on a populated database
   to prove that an ordinary Sales employee cannot read another department's data or anyone's
   salary. This is a testing task, not a code fix.
2. **Test suite.** There is none. Add a smoke-test suite covering auth/home-route resolution, the
   finance approval thresholds, and at least one RLS-guarded service read for each tier.
3. **Real error tracker.** Wire Sentry (or equivalent) inside `app/error.tsx`. The `digest` is
   the correlation key.
4. **Finance approval thresholds** in `lib/finance/constants.ts` are placeholders awaiting the
   client's real numbers.
