# ASSUMPTIONS

Numbered log of every judgement call made while building unattended. Each entry: the assumption, the reasoning, and what to change if it's wrong.

1. **Next.js 15.5 (stable) rather than the npm `latest` tag.** At build time npm's `latest` tag pointed at `16.3.0-preview.0` — a preview release. The spec says "Next.js 15+" and "production-grade", so I pinned `next@15.5.19`, the newest stable 15.x. *If wrong:* bump `next` + `eslint-config-next` in package.json; no App Router APIs used here are 15-specific.

2. **Local verification ran against plain Postgres 16 with a Supabase-compatible auth shim, not the full Supabase stack.** The build container has no Docker daemon, which `supabase start` requires. All migrations are written for Supabase (they create/replace nothing in `auth.*` except reading `auth.uid()`/`auth.users`); a small bootstrap script (`scripts/pg-local-shim.sql`, applied only when the `auth` schema is absent) recreates the minimal `auth` schema (`auth.users`, `auth.uid()`) so migrations, seeds and RLS role checks could actually be executed and verified here. On a real Supabase instance the shim is skipped automatically. *If wrong:* run `supabase db reset` on a machine with Docker; the migrations apply unchanged.

3. **Seeded auth users are inserted directly into `auth.users` with bcrypt password hashes** (the standard Supabase local-dev seeding pattern) rather than via the GoTrue admin API, so `npm run db:reset` needs only a database URL and no running auth server. *If wrong:* swap `seedUsers()` in `scripts/seed/users.ts` for `supabase.auth.admin.createUser()` calls using the service-role key.

4. **"A clinic may appear on at most one live deal" is enforced with a trigger, not a partial unique index.** A partial unique index on `deal_clinics` can't reference the joined `deals.pipeline_column`, so the constraint is enforced by a `BEFORE INSERT OR UPDATE` trigger on `deal_clinics` *and* a trigger on `deals` column changes (reviving a dead deal re-checks its clinics). Documented in the migration. *If wrong:* the trigger can be relaxed/dropped without schema changes.

5. **Default valuation multiple for the weighted pipeline is 1.0× revenue when a deal has no offer.** Clinics carry `revenue_estimate`, not EBITDA; healthcare roll-ups commonly pay ~0.8–1.2× revenue for MSK clinics. Weighted value = latest offer EV when present, else `revenue_estimate × 1.0`, × column probability. The multiple is a constant in `src/lib/analytics/constants.ts`. *If wrong:* change `DEFAULT_REVENUE_MULTIPLE` there.

6. **Playwright e2e was skipped** per the spec's "optional" clause: the critical surfaces (WhatsApp parser, email matcher, Pipedrive mapper, fuzzy matching, CSV, RLS) are covered by Vitest + scripted SQL role checks, and e2e browsers can't be exercised meaningfully in the build container. *If wrong:* the app uses stable `data-testid`s on key interactions to make adding Playwright cheap.

7. **Search uses Postgres `pg_trgm`** (trigram GIN indexes on clinics/contacts/deals name+postcode+region+CH number) rather than full-text search: M&A search terms are names and codes, not prose, and trigram similarity gives typo tolerance that FTS lacks. Justification expanded in BUILDLOG P1.

8. **Pipeline "process stages" for funnel conversion are**: identified → silver → gold → platinum → active_discussions → due_diligence → hots → complete. `reengage` and `dead` are terminal/holding states, excluded from the linear funnel but reported separately.

9. **WhatsApp `source_ref` = sha256(contact_id + ISO day)** exactly as specced; the *deal* attached is the contact's clinic's live deal at import time. If the contact has no live deal the import flow requires the user to choose one at the preview step.

10. **Outlook attachment → document `doc_type` heuristics** live in `src/lib/email/doc-type-guess.ts`: filename keywords (spa→`spa`, "loan note"→`loan_notes`, "earn"→`earn_out`, "hots"/"heads"→`hots`, "lease"→`lease`, "ddq"/"due diligence"→`ddq`, "employment"→`employment_contracts`, "disclosure"→`disclosure_letter`, else `other`). All editable after sync.

11. **Roles are stored in `user_profiles.role` and read by `security definer` helpers** (`role_of()`, `is_admin()`) as instructed; JWT custom claims were avoided so role changes apply immediately without re-login.

12. **Exec write access**: execs can write *only* the `comments` table (per spec §4.11). The deal-page Comments tab is therefore the one mutating surface execs see enabled; all other forms check the role server-side too.

13. **Money columns are `numeric` and pass through the API as strings**; all formatting goes through `formatGBP()` in `src/lib/format.ts` (en-GB, £, thousands separators, tabular numerals via `[data-financial]`).

14. **`registration_required` default**: computed as `lease_length_years > 7` in the property form (UK Land Registry threshold), editable per spec.

15. **Pipedrive column mapping** assumes the existing Pipedrive pipeline uses the same ten stage names (case/spacing-insensitive: "Active Discussions" → `active_discussions`, "HoTs" → `hots`, etc.). Unmappable stage names land in the dry-run report as `needs-review` and default to `identified` on commit. *If wrong:* edit the `STAGE_MAP` in `src/lib/pipedrive/mapper.ts`.

16. **deal_lead can also write clinics, contacts and clinic_aliases.** Spec §4.11 lists deal_lead writes as "deals/interactions/documents/checklists/tasks/offers/properties", but day-to-day flows the spec demands (quick-add a clinic, "add sender as contact" in the Unmatched Inbox, imports) all require contact/clinic writes by the person doing deal work. Admin-only would bottleneck on Oli. *If wrong:* tighten `clinics_write`/`contacts_write`/`clinic_aliases_write` policies in `0009_rls.sql` to `is_admin()`.

17. **Added `contacts.pipedrive_person_id` and `deals.pipedrive_deal_id` (migration 0014).** Spec §1.5 requires external IDs as unique upsert keys; §4 didn't define columns for Pipedrive entity ids (orgs reuse `clinics.platform_clinic_id` with a `pd-org-` prefix). *If wrong:* the columns are nullable and ignorable.

18. **Added `whatsapp` to the `sync_runs.source` enum (migration 0013).** §4.12 lists four sources, but §1.5 says *every* import produces a persisted reconciliation count — WhatsApp imports now write one too.

19. **Viewers see clinics/contacts only through their granted deals.** Spec says viewers read "deals granted … and their child rows"; clinics/contacts are master data, not child rows, so the conservative reading is enforced: a viewer sees a clinic only if it sits on a granted deal, and contacts only at those clinics. Config tables (column settings, templates, aliases) are readable by all authenticated users — they leak no deal data.

20. **Ambiguous Pipedrive orgs are skipped on commit** (with their persons/deals) rather than guessed at — the dry-run report tells the operator to resolve and re-run. Conservative by design for a data-merge.
