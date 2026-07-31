# DEPLOY — staging preview (Supabase hosted + Vercel)

Two paths. **Path A** needs two things from you and I do the rest from this
session; **Path B** is the full click-by-click if you'd rather connect it
yourself. Either way the app deploys with fixture providers — no Graph/
Pipedrive/CH credentials needed.

---

## Path A — unblock me and I'll do it (fastest once unblocked)

This session's sandbox has a network allowlist that currently blocks
`*.supabase.co`, `vercel.com` and `api.github.com`, and the keys you shared
(anon + service role) deliberately **cannot run DDL**, so migrations need a
database connection.

1. **Network**: in Claude Code on the web → your environment settings →
   Network policy → allow `*.supabase.co` (and `api.vercel.com` if you also
   create a Vercel token), or set the policy to "All".
2. **Database connection string**: Supabase Dashboard → Project Settings →
   Database → Connection string → **Direct connection** (port 5432) — the one
   that looks like
   `postgresql://postgres:[PASSWORD]@db.nwwxprydowrqhboerjry.supabase.co:5432/postgres`.
   Paste it to me in chat (staging-only credential).
3. I then run `npm run db:reset` against staging (migrations 0001–0014 + full
   seed, identical to what was verified locally) and `npm run smoke:staging`
   to prove the admin login + seed.
4. *(Optional)* a Vercel token (`vercel.com/account/tokens`) lets me create
   and deploy the project too; otherwise do the 3-minute Vercel part of
   Path B below.

> Why the extra string: anon/service-role JWTs go through PostgREST, which
> can't execute `CREATE TABLE`. Schema changes need a real Postgres
> connection (or the dashboard SQL editor).

---

## Path B — do it yourself (≈10 minutes)

### B1. Database: migrations + seed (one command)

On your machine, in this repo (branch `claude/new-session-vtynj4`):

```bash
npm install
DATABASE_URL='postgresql://postgres:[YOUR-DB-PASSWORD]@db.nwwxprydowrqhboerjry.supabase.co:5432/postgres' npm run db:reset
```

- Use the **Direct connection** string (port 5432), not the transaction
  pooler (port 6543) — DDL over the transaction pooler is unreliable.
- The script drops/recreates the `public` schema (fine on staging), applies
  all 14 migrations in order, and seeds everything including the four demo
  logins (it inserts them straight into `auth.users` — ASSUMPTIONS #3).
- Expected output ends with:
  `seeded: 80 clinics, 31 deals, 50 interactions, 17 documents`.

Verify from your machine (uses `.env.local` — see the env table below):

```bash
npm run smoke:staging
```

### B2. GitHub

Nothing to create — the code is already pushed to
**`OliKinetico/masterboard`**, branch **`claude/new-session-vtynj4`**.
(A second private repo would just be a copy; if you specifically want one,
create it empty on github.com → then
`git remote add staging <url> && git push staging claude/new-session-vtynj4`.)

### B3. Vercel (click-by-click)

1. vercel.com → **Add New… → Project** → **Import** `OliKinetico/masterboard`
   (install the Vercel GitHub app on the org if prompted).
2. Framework preset auto-detects **Next.js** — leave build settings as-is.
3. **Environment Variables** — add these (all environments):

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://nwwxprydowrqhboerjry.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon key you gave me |
   | `SUPABASE_SERVICE_ROLE_KEY` | the service-role key (server-only; Vercel never exposes non-`NEXT_PUBLIC_` vars to the browser) |
   | `EMAIL_PROVIDER` | `fixture` |
   | `PIPEDRIVE_PROVIDER` | `fixture` |
   | `CH_PROVIDER` | `fixture` |
   | `GRAPH_MAILBOX` | `oli@kinetico.health` |

4. Click **Deploy**. First build ≈2–3 min.
5. **Make the build branch production**: Project → Settings → **Git** →
   Production Branch → set to `claude/new-session-vtynj4` → save → Deployments
   → … menu on the latest → **Redeploy**. (Skip this if you'd rather merge the
   branch to `main` first — then main is already the production branch.)
6. *(Recommended)* Supabase Dashboard → Authentication → URL Configuration →
   set **Site URL** to your Vercel URL and add it to **Redirect URLs**.

### B4. Smoke test

- Open the Vercel URL → you're redirected to `/login`.
- Sign in `admin@kinetico.test` / `REDACTED-ROTATE-BEFORE-USE` → the **Pipeline** board
  loads. Set the owner filter to "All owners" to see all 31 seeded deals
  across the ten columns (the default view is "My deals" = the admin's own).
- Scripted equivalent: `npm run smoke:staging -- https://<your-app>.vercel.app`
- Then start the guided tour at `/review`.

---

## Continuous preview from now on

Once Vercel is connected to the repo, **every push redeploys automatically**
(production for the production branch, preview URLs for any other branch).
I push at the end of every phase, so the live preview stays current without
any extra step.
