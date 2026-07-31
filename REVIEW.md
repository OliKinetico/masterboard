# REVIEW — executive summary

**What this is:** the complete Kinetico M&A CRM per the build spec — pipeline kanban, deal workhorse page, unified timeline, WhatsApp import, Outlook sync engine, legal tracker + cross-deal board, checklists, offers/properties, analytics, imports (clinic/Pipedrive/Companies House), full Admin, role-based access — seeded with a realistic anonymised dataset and a fully-worked flagship deal (**Riverside Physio Group**, multi-site, in HoTs with a spawned legal pack).

**Where to start:** log in as `admin@kinetico.test` / `REDACTED-ROTATE-BEFORE-USE` and open **/review** — a guided, deep-linked walkthrough of every module.

---

## What is real vs mocked

| Area | State |
|---|---|
| Schema, RLS, triggers (stage history, legal-pack spawn, checklist spawn, tier persistence, one-live-deal-per-clinic) | **Real** — enforced in Postgres, verified by scripted checks |
| Pipeline, deal page, timeline, quick-log, legal matrix + board, checklists, offers, properties, analytics, re-engage, admin, merge tool, saved views, CSV exports, command palette | **Real** — fully implemented UI + server actions |
| WhatsApp import | **Real** parser + flow (23 tests); fixtures ship for the demo |
| Outlook sync | **Engine real; data mocked.** Fixture mailbox (31 messages) by default. Graph implementation is complete (client-credentials, delta-by-date, paging, attachments) but **untested against a live tenant**. Flip: `EMAIL_PROVIDER=graph` + 4 vars (README). |
| Pipedrive migration | **Engine real; data mocked.** Fixture CSVs shipped; dry-run report + idempotent commit. API provider complete, untested live. Flip: `PIPEDRIVE_PROVIDER=api`. |
| Companies House | **Engine real; data mocked.** Fixture registry (2 newer filings → signals). Real API provider complete, untested live. Flip: `CH_PROVIDER=api`. |
| Playwright e2e | Skipped (spec-optional) — rationale + mitigation in ASSUMPTIONS #6 |

## Known gaps

- The three "go live" flips above have never touched real credentials/services (none were available, by design — spec §1.6).
- CH `director_change` signals exist in the schema/UI; the real-API provider currently derives only `accounts_filed` (officers diffing is in IDEAS.md).
- Fixture email deep-links point at Outlook-web URLs built from fixture ids; they resolve once real Graph ids flow in.
- At true 10k-deal scale the pipeline aggregates should move into a SQL RPC (seam documented in BUILDLOG P1).

---

## Self-test record (final clean pass)

Environment note: built and verified against Postgres 16 with the Supabase auth shim (the build container has no Docker, so the GoTrue login UI itself couldn't be click-tested here — ASSUMPTIONS #2). Everything testable below the UI was executed for real.

| Check | Result |
|---|---|
| Fresh `npm run db:reset` (migrations 0001–0014 + full seed) | ✅ 80 clinics, 31 deals (all ten columns: 6/4/4/3/3/2/2/2/3/2), 50+ interactions, 17 documents |
| `npm run check:rls` — 15 role assertions incl. **viewer sees exactly 2 deals**, exec writes only comments, deal_lead blocked from admin tables | ✅ 15/15 |
| `npm run test` — parser/matcher/mapper/fuzzy/CSV | ✅ 56/56 |
| `npm run lint` / `npm run typecheck` / `npm run build` | ✅ 0 errors |
| Tier persistence: flagship walked identified→gold→…→HoTs keeps `tier=gold` | ✅ verified in DB |
| `hots_signed_at` spawn: 7 template docs + **one lease per property** (2), HoTs born signed, statuses progressed with full history (27 status-history rows) | ✅ verified in DB |
| DD checklist spawned on entering due_diligence (7 items, part-completed mix) | ✅ verified in DB |
| One-live-deal-per-clinic trigger: attempted violation | ✅ correctly rejected |
| Dead/re-engage constraints (reason/date required) | ✅ DB CHECKs + UI prompts |
| WhatsApp fixture import round-trip (executed against seeded DB): seed had 3 day-rows → import of the 5-day fixture: **2 inserted, 3 replaced** → re-import: **0 inserted, 5 replaced**, 0 duplicate source_refs | ✅ executed |
| WhatsApp parser fixtures: Android 5 days/26 msgs, iOS 3 days, multiline preserved, 12h→24h, system lines + media counted, junk listed | ✅ 23 tests |
| Email matcher on fixture mailbox: address-matched (Riverside/Harborne/Caledonia), alias-matched (Albion via subject), unmatched → inbox | ✅ 9 tests + fixture sync paths |
| Pipedrive dry-run verdicts (executed against seeded clinics): Granite City **matched (1.00)**, Pennine **ambiguous (0.80)**, Lakeside/Brookfield **unmatched-will-create**; stage map incl. lost→dead and unknown-stage→needs-review | ✅ executed |
| Pipedrive commit idempotency: all writes upsert on external IDs (`pd-org-*`, `pipedrive_person_id`, `pipedrive_deal_id`, `pd-note/activity-*`); ambiguous orgs skipped | ✅ by construction + run-twice counts surfaced in Admin |
| Sync health: every runner writes `sync_runs`; reconciliation mismatch ⇒ `warning`; thrown errors recorded on the run row | ✅ code-path enforced |
| Every list view exports CSV; every view has a designed empty state; command palette reaches deals/clinics/contacts + actions | ✅ implemented throughout |

### Walkthrough scenarios (/review §2)
Scenarios 1–9 are deep-linked and the underlying mechanics of each were executed at the data layer as listed above. The browser-level click-through (drag interactions, dialogs, role logins) builds and typechecks but awaits a machine with the Supabase auth stack — run `/review` top-to-bottom on first local boot; it was written to be executed in ~15 minutes.
