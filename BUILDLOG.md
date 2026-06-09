# BUILDLOG

Plain-English log of what was built at each step, key decisions, and trade-offs. Newest entries at the bottom. One git commit per step, message format `[P1.2] …`.

---

## P0 — Foundations

### [P0.1] Scaffold, tooling, design tokens
- Scaffolded Next.js **15.5.19** (App Router, TypeScript strict, `src/` dir, `@/*` alias) with Tailwind CSS v4. npm's `latest` Next tag was a *preview* build, so I pinned the newest stable 15.x (ASSUMPTIONS #1).
- Installed the UI/runtime stack: `@supabase/supabase-js` + `@supabase/ssr`, Radix primitives + `cmdk` + `sonner` (the shadcn/ui component set is vendored in `src/components/ui` rather than pulled through the shadcn CLI — same code style, zero CLI nondeterminism), `lucide-react`, `dnd-kit` (kanban drag), `recharts` (analytics), `postgres` (seed/scripts driver), `vitest` + `tsx` for tests/scripts.
- Design tokens in `globals.css` as Tailwind v4 `@theme`: Kinetico teal (`brand-600 #0D9488 / brand-700 #0F766E`) as primary, slate neutrals, light surfaces. Inter via `next/font`. `[data-financial]` opts tables/figures into tabular numerals; all £ formatting goes through `src/lib/format.ts`.
- npm scripts: `dev`, `build`, `typecheck`, `lint`, `test`, `db:reset` (full migrate + seed via `scripts/db-reset.ts`).
- Trade-off: vendoring the shadcn-style components adds files to the repo but makes the build reproducible offline and pins their behaviour; this is what shadcn itself recommends for products.

### [P0.3] Schema migrations 0001–0010
- 14 ordered SQL migrations covering every §4 entity, all with `id uuid pk`, trigger-maintained `updated_at`, and RLS from the first migration.
- **Triggers carry the business rules** so they hold no matter which surface writes: stage_history on every column change; tier set on entering silver/gold/platinum and persisted afterwards; reengage_on cleared on leaving Re-engage; dead/reengage invariants as CHECK constraints; legal pack spawn on `hots_signed_at` (one doc per template + one lease per property, idempotent); checklist spawn on entering a template's trigger column; document_status_history on every status change.
- **One-live-deal-per-clinic** uses paired triggers, not a partial unique index — an index can't see the joined `deals` table (ASSUMPTIONS #4). Verified by attempting the violation: correctly rejected.
- Trade-off: trigger-heavy designs are harder to unit-test in isolation, but they make the imports/seed honest — the seed walks deals through columns and gets real history/checklists for free.

### [P0.4] Tooling: db:reset, auth shim, RLS proof
- `npm run db:reset` drops/recreates `public`, applies migrations in filename order, seeds — against Supabase local *or* plain Postgres (a shim recreates `auth.users` + `auth.uid()` only when missing — ASSUMPTIONS #2).
- `npm run check:rls` impersonates each seeded role via `set role authenticated` + the `request.jwt.claims` GUC and asserts the §4.11 matrix — 15 checks, all passing (incl. "viewer sees exactly 2 deals").

### [P0.5] Seed
- Deterministic (seeded PRNG + sha-derived uuids): 80 clinics (12 hand-authored for fixtures, 68 generated), 31 deals across all ten columns (2 dead with reasons, 3 re-engage with dates, 2 complete, 2 in HoTs), 4 demo logins.
- Flagship "Riverside Physio Group" is *walked* through identified→gold→active→DD→HoTs so triggers build genuine stage history, spawn the DD checklist and the legal pack; statuses then progressed to the §7 mix (SPA with_sellers v3, loan notes drafting, two leases at different statuses on CoC-flagged properties).
- WhatsApp/email fixtures share IDs with the seed so import demos genuinely round-trip (re-import → replace, not duplicate).

### [P1] Core CRM
- App shell: left nav with role-aware Admin entry + Re-engage/Unmatched badges; top bar with search trigger, quick-add, user menu + role badge.
- Pipeline kanban: dnd-kit drag with optimistic updates, dead/re-engage prompt dialogs, per-column count + weighted value headers, capped rendering with "show more" (never thousands of cards), owner=me default filter, full filter bar, saved views (per-user), list-view toggle, CSV.
- Scale note: aggregates are computed from a single lightweight query over filtered deals; at true 10k+ scale the next step is a SQL RPC for per-column aggregates — seam documented here on purpose.
- Search: pg_trgm GIN indexes + ILIKE through one `/api/search` endpoint feeding the Cmd+K palette (records + actions), quick-log picker and new-deal dialog. Trigram over FTS because deal search terms are names/postcodes/CH numbers, not prose (ASSUMPTIONS #7).
- Deal page: header (clinic badges, persisted tier chip, owner select, latest-offer summary, column mover with HoTs signing) + blocking next-action banner in active/DD/HoTs; tabs for timeline, key info (+ editable jsonb facts), offers, properties, legal matrix, checklists, documents (link-cards), contacts, tasks, comments (exec-writable).
- Quick-log: recent-first deal picker → type → text → optional follow-up task; ≤3 taps, mobile-sized tap targets.

### [P2] WhatsApp import
- Parser handles Android + iOS formats, 12h/24h, 2/4-digit years, multiline continuation, media placeholders (counted, never stored), system lines, U+200E/NBSP — 23 tests over 4 shipped fixture exports.
- Flow: upload .txt/.zip (fflate) → parse preview (days/messages/media/range/unparseable list) → deal confirm (contact's live deal suggested) → commit upserts one interaction per day on sha256(contact+day). Reconciliation row written to sync_runs (enum extended — ASSUMPTIONS #18).

### [P3] Email engine
- `EmailProvider` interface + FixtureEmailProvider (31 deterministic messages: address-matched, alias-matched, unmatched) + GraphEmailProvider — complete client-credentials + paged fetch implementation with attachment listing, env-gated, clearly marked untested-live.
- Matcher is a pure function over prebuilt indexes (address → contact/live-deal, alias list longest-first) — 9 tests. Attachment doc-type heuristics — 11 tests.
- Sync runner: delta from last successful run, idempotent upserts on graphId, attachments → document link-cards (deduped on deal+url), unmatched → Unmatched Inbox; one sync_runs row per run with reconciliation (provider count vs accounted) — mismatch ⇒ status=warning; thrown errors are recorded on the run row before returning. No silent failures.
- Unmatched Inbox: one-tap assign with deal search, optional "save sender as contact" (matcher learns), dismiss.

### [P4] Legal board
- Deal-level matrix + status history shipped with the deal page in P1; this phase added the cross-deal Legal Board: outstanding docs across live post-HoTs deals with inline status change, due-date/staleness sorting and CSV.

### [P5] Analytics, re-engage, stale
- Funnel (reached counts from stage_history, conversion %, median days-in-stage), weighted forecast (headline + per-column bar), activity pulse (stacked weekly by source), dead-reason breakdown, stale-deals list with 14/30-day toggle.
- Re-engage view: due ≤14 days highlighted; re-open moves to Active Discussions and the DB trigger clears the date.

### [P6] Imports & Admin
- Pipedrive: CSV provider (fixtures shipped) + complete env-gated API provider; fuzzy org→clinic matching (token+bigram similarity, postcode boost; matched ≥0.85 / ambiguous ≥0.6 / else create) — 13 tests incl. the CSV parser; dry-run produces a markdown reconciliation report (stored on the sync_runs row, viewable + downloadable in Admin); commit is idempotent on pd ids (ASSUMPTIONS #17), ambiguous orgs skipped (#20).
- Companies House: fixture provider (two clinics file newer accounts → signals) + real basic-auth API provider env-gated; enrichment scoped to clinics on live deals, deduped signals, updates `ch_last_accounts_date`.
- Clinic import: `imports/clinics.csv` (documented example shipped) upserted on `platform_clinic_id`; reconciliation incl. per-row skip reasons.
- Admin: users/roles + viewer deal grants, legal pack & checklist template editors, alias editor, column probabilities, sync-runs log + manual trigger buttons, CH signals, merge tool (re-points FKs, soft-marks merged, unions contact emails, keeps the dup clinic name as an alias, audited in merge_log).

### [P7] Review & hardening
- `/review`: module status table, 9-scenario guided walkthrough with deep links + fixture download, assumptions digest, known gaps with env flips.
- Full clean pass: db:reset → 15/15 RLS checks → 56/56 unit tests → lint 0 → build 0. Executed self-tests recorded in REVIEW.md (incl. the WhatsApp re-import idempotency round-trip and the Pipedrive dry-run verdicts run against the seeded database).
