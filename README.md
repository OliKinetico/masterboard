# Kinetico M&A CRM

A production-grade M&A pipeline and deal-management CRM for Kinetico Health — a UK multi-site allied-health group acquiring physiotherapy/MSK clinics.

Built with **Next.js 15 (App Router) + TypeScript strict**, **Supabase** (Postgres + Auth + RLS), **Tailwind CSS v4** with a vendored shadcn-style component library, and **Vitest**.

> Start your review at **`/review`** — a guided walkthrough covering every module, with seeded data and fixture downloads.

---

## Quick start

### Prerequisites
- Node 20+ (built on Node 22)
- Either **Supabase CLI + Docker** (recommended) or any **Postgres 14+** (a built-in shim makes plain Postgres work for dev — see ASSUMPTIONS #2)

### 1. Install
```bash
npm install
cp .env.example .env.local
```

### 2. Database

**Option A — Supabase local (full stack incl. auth):**
```bash
supabase start                  # prints API URL + anon key
# put NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY into .env.local
# DATABASE_URL default (postgres://postgres:postgres@127.0.0.1:54322/postgres) already matches
npm run db:reset                # migrations + seed (idempotent, deterministic)
```

**Option B — plain Postgres (no Docker; auth pages need Option A):**
```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres npm run db:reset
```

### 3. Run
```bash
npm run dev      # http://localhost:3000
```

### Seeded logins (all passwords: `KineticoDemo1!`)

| Email | Role | What you'll see |
|---|---|---|
| `admin@kinetico.test` | admin ("Oli") | Everything, incl. Admin |
| `lead@kinetico.test` | deal_lead | Full deal work, no Admin |
| `exec@kinetico.test` | exec | Read everything; can write **only** comments |
| `viewer@kinetico.test` | viewer | Exactly **2** granted deals (Riverside + Harborne) |

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run lint` | ESLint (next/core-web-vitals + TS) |
| `npm run test` | Vitest — 56 tests over the critical surfaces (WhatsApp parser, email matcher, doc-type heuristics, Pipedrive mapper, fuzzy matching, CSV) |
| `npm run db:reset` | Drop public schema → apply `/supabase/migrations` in order → seed. Works on Supabase local **and** plain Postgres |
| `npm run check:rls` | Scripted proof of the role matrix (15 checks; impersonates each seeded user) |

---

## Integrations: every one is an adapter (spec §8)

All integrations run on deterministic **fixture providers by default** — no credentials needed for the full demo. The real implementations are complete code, selected by env var, and **untested against live services** (built in a fixture-only environment).

| Integration | Env to go live | Setup steps |
|---|---|---|
| **Outlook / Microsoft Graph** | `EMAIL_PROVIDER=graph`, `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_MAILBOX` | Azure AD → App registration → API permissions → **Application** permission `Mail.Read` (+ `offline_access` if you later switch to delegated/device-code) → **grant admin consent** → create a client secret. Initially scope access to the one deal mailbox via an application access policy (`New-ApplicationAccessPolicy` in Exchange Online PowerShell). |
| **Pipedrive** | `PIPEDRIVE_PROVIDER=api`, `PIPEDRIVE_API_KEY`, `PIPEDRIVE_DOMAIN` | Personal API token from Pipedrive → Settings. Or skip the API entirely: drop CSV exports into `/imports/pipedrive/` (orgs/persons/deals/notes/activities/files — fixtures show the expected columns). Always **dry-run first** (Admin → Syncs). |
| **Companies House** | `CH_PROVIDER=api`, `CH_API_KEY` | Free API key from developer.company-information.service.gov.uk. Basic auth, key as username. |
| **Clinic platform import** | none — file-based | Put `clinics.csv` (or `.json`) in `/imports/` — columns documented in `imports/clinics.example.csv`. Idempotent on `platform_clinic_id`. |

Sync health: every import/sync writes a `sync_runs` row with reconciled counts; a count mismatch surfaces as `warning` and errors are recorded on the run — visible in **Admin → Syncs & imports**. Nothing fails silently (spec §1.5).

## Deploying to Vercel

Set the env vars from `.env.example` (Supabase URL/anon key at minimum; `SUPABASE_SERVICE_ROLE_KEY` is server-only). No Node-API usage in edge paths; the default build deploys unchanged.

## Repo map

```
supabase/migrations/   14 ordered SQL migrations (schema, RLS, triggers, templates)
scripts/               db-reset, seed (deterministic), check-rls, pg shim
src/lib/               domain enums+chips meta, format (£), whatsapp parser, email
                       matcher/providers, pipedrive mapper/providers, ch provider, fuzzy
src/server/actions/    all mutations (server actions; RLS-gated)
src/app/(app)/         pipeline, deals, clinics, contacts, legal-board, unmatched,
                       reengage, analytics, admin, review
imports/               pipedrive fixture CSVs + clinics.example.csv
public/fixtures/       WhatsApp export fixtures (downloadable from /review)
```

## Project documents

- **REVIEW.md** — executive summary, what's mocked, self-test results
- **BUILDLOG.md** — per-step build log with decisions and trade-offs
- **ASSUMPTIONS.md** — 20 numbered judgement calls with reversal notes
- **IDEAS.md** — out-of-scope ideas, deliberately not built
