import Link from "next/link";
import {
  CheckCircle2, CircleDashed, Download, ExternalLink, FlaskConical,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Review" };
export const dynamic = "force-dynamic";

type BuildStatus = "built" | "partial" | "mocked";

const STATUS_META: Record<BuildStatus, { label: string; chip: string }> = {
  built: { label: "Built", chip: "bg-green-50 text-green-700 border-green-200" },
  partial: { label: "Partially built", chip: "bg-amber-50 text-amber-700 border-amber-200" },
  mocked: { label: "Mocked", chip: "bg-violet-50 text-violet-700 border-violet-200" },
};

export default async function ReviewPage() {
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  const [{ data: flagship }, { data: harborne }, { data: sarah }, { data: secondHots }] =
    await Promise.all([
      supabase.from("deals").select("id").eq("name", "Riverside Physio Group").maybeSingle(),
      supabase.from("deals").select("id").eq("name", "Harborne Spine & Sport").maybeSingle(),
      supabase.from("contacts").select("id").eq("full_name", "Sarah Whitfield").maybeSingle(),
      supabase
        .from("deals")
        .select("id, name")
        .eq("pipeline_column", "due_diligence")
        .is("hots_signed_at", null)
        .limit(1)
        .maybeSingle(),
    ]);

  const flagshipUrl = flagship ? `/deals/${flagship.id}` : "/deals";
  const sarahUrl = sarah ? `/contacts/${sarah.id}` : "/contacts";

  const modules: Array<{
    name: string;
    status: BuildStatus;
    note: string;
    href: string;
  }> = [
    { name: "Pipeline kanban + list view", status: "built", note: "Ten columns, drag with dead/re-engage prompts, weighted headers, filters, saved views, CSV.", href: "/" },
    { name: "Deal page", status: "built", note: "Header with next-action enforcement + HoTs signing; 10 tabs incl. legal matrix and offer history.", href: flagshipUrl },
    { name: "Quick-log", status: "built", note: "Topbar + button or Cmd+K → 'Log a call'. Recent-first deal picker, ≤3 taps.", href: "/" },
    { name: "Unified timeline", status: "built", note: "Type filters, expandable bodies, WhatsApp day transcripts, Outlook deep-links, stage history.", href: flagshipUrl },
    { name: "WhatsApp import", status: "built", note: "Parser handles Android/iOS/12h/multiline/media/system lines; preview → commit; re-import replaces days.", href: sarahUrl },
    { name: "Outlook sync", status: "mocked", note: "Fixture mailbox by default; complete Graph delta implementation env-gated (EMAIL_PROVIDER=graph), untested live.", href: "/unmatched" },
    { name: "Unmatched Inbox", status: "built", note: "One-tap assign + 'save sender as contact' so the matcher learns.", href: "/unmatched" },
    { name: "Legal engine", status: "built", note: "HoTs signing spawns the pack (incl. lease per property); matrix view; full status history.", href: flagshipUrl },
    { name: "Cross-deal Legal Board", status: "built", note: "Outstanding docs on live post-HoTs deals, sortable by due date and staleness.", href: "/legal-board" },
    { name: "Checklists (DD pack)", status: "built", note: "Generic engine; DD Pack spawns on entering Due Diligence; templates editable in Admin.", href: harborne ? `/deals/${harborne.id}` : "/deals" },
    { name: "Offers & properties", status: "built", note: "Offer timeline with implied multiple + 70/30 prefill; properties with CoC/expiry risk chips.", href: flagshipUrl },
    { name: "Analytics", status: "built", note: "Funnel + conversion + median time-in-stage, weighted forecast, pulse, dead reasons, stale deals.", href: "/analytics" },
    { name: "Search & command palette", status: "built", note: "Cmd+K — records and actions; trigram-indexed ILIKE stays fast at 10k+ rows.", href: "/" },
    { name: "Clinic import", status: "built", note: "Reads imports/clinics.csv (see clinics.example.csv); idempotent; reconciliation to sync_runs.", href: "/admin" },
    { name: "Pipedrive migration", status: "mocked", note: "Fixture CSVs shipped; dry-run report + idempotent commit. API provider env-gated, untested live.", href: "/admin" },
    { name: "Companies House signals", status: "mocked", note: "Fixture provider (2 clinics file newer accounts). Real API env-gated (CH_API_KEY), untested live.", href: "/admin" },
    { name: "Admin (roles, templates, merge…)", status: "built", note: "Users/roles/grants, template editors, aliases, probabilities, sync log, audited merge tool.", href: "/admin" },
    { name: "Re-engage & hygiene", status: "built", note: "Due ≤14d nudge in nav; re-opening clears the date via trigger.", href: "/reengage" },
  ];

  const walkthrough: Array<{ title: string; steps: string[]; href: string; download?: string }> = [
    {
      title: "Drag a deal across the pipeline",
      href: "/?owner=all",
      steps: [
        "Set the owner filter to 'All owners', then drag any Identified card to Gold — its tier chip appears and persists.",
        "Drag a deal to Dead — a reason is required; to Re-engage — a date is required.",
        `Open the deal and expand 'Stage history' at the bottom of the timeline to see the trigger-written trail.`,
      ],
    },
    {
      title: "Work the flagship deal (Riverside Physio Group)",
      href: flagshipUrl,
      steps: [
        "Header: 3 clinic badges (multi-site), tier persisted from Gold, accepted LOI at ~5.6× with 70/30 split, next action due.",
        "Timeline: 6 months of synced emails, WhatsApp day entries, calls and notes — filter by type, expand a WhatsApp day for the transcript.",
        "Legal tab: the matrix shows SPA with sellers (v3), loan notes drafting, two leases at different statuses; click a row for its status history.",
        "Properties: Putney is consent-required on change of control; Kingston has an imminent break date.",
      ],
    },
    {
      title: "Run a WhatsApp import (round-trips with seed data)",
      href: sarahUrl,
      download: "/fixtures/whatsapp/android-sarah.txt",
      steps: [
        "Download the fixture export (link below), then on Sarah Whitfield's contact page choose 'Import WhatsApp'.",
        "Upload the file: preview shows 5 days, 26 messages, 1 media omitted, the date range, and no unparseable lines.",
        "Commit to the suggested Riverside deal: 2 new day entries, 3 replaced (the seed already had those days) — zero duplicates.",
        "Run it again: 0 new, 5 replaced. Idempotency in action.",
      ],
    },
    {
      title: "Sync email + clear the Unmatched Inbox",
      href: "/unmatched",
      steps: [
        "Press 'Run email sync': the fixture mailbox delivers address-matched, alias-matched and unmatched messages; the banner shows reconciled counts.",
        "Alias demo: mail from raj.patel.accounts@outlook.com lands on Albion MSK because the clinic name appears in the subject.",
        "Assign the 'Off-market opportunity' broker email to any deal, ticking 'save sender as contact' — the matcher catches them next run.",
        "Attachments arrive as document link-cards with guessed doc types (SPA, lease, …).",
      ],
    },
    {
      title: "Spawn a legal pack",
      href: secondHots ? `/deals/${secondHots.id}` : "/deals",
      steps: [
        secondHots
          ? `Open ${secondHots.name} (in Due Diligence) and move it to HoTs via the header column selector.`
          : "Open any due-diligence deal and move it to HoTs via the header column selector.",
        "Press 'Mark HoTs signed' — the legal pack spawns instantly: one document per template plus one lease per property, HoTs already marked signed.",
        "The new outstanding docs appear on the cross-deal Legal Board.",
      ],
    },
    {
      title: "Pipedrive migration dry-run → commit",
      href: "/admin",
      steps: [
        "Admin → Syncs & imports → 'Pipedrive dry-run': the report shows matched (Granite City, 1.00), ambiguous (Pennine, 0.80 — skipped on commit) and unmatched-will-create orgs, plus the stage mapping table ('Initial Outreach' → needs review).",
        "Run 'Pipedrive commit': two new clinics + deals are created; Granite City's lost deal maps to Dead with its lost reason.",
        "Run commit again — counts show reused/upserted, zero duplicates.",
      ],
    },
    {
      title: "Companies House enrichment",
      href: "/admin",
      steps: [
        "Admin → Syncs & imports → 'CH enrichment': the fixture registry has newer accounts for Caledonia and Westbourne → two accounts_filed signals.",
        "Check the CH signals tab, then the amber 'CH' badge on those deals' pipeline cards. Acknowledge to clear.",
      ],
    },
    {
      title: "Prove the roles (log out, log back in)",
      href: "/login",
      steps: [
        "viewer@kinetico.test → sees exactly 2 deals (Riverside + Harborne); no quick-add, no edits anywhere.",
        "exec@kinetico.test → reads everything, and the ONLY thing they can write is a Comment on a deal.",
        "lead@kinetico.test → full deal work but no Admin in the nav (and RLS blocks admin writes server-side).",
        "All passwords: REDACTED-ROTATE-BEFORE-USE",
      ],
    },
    {
      title: "Analytics & hygiene",
      href: "/analytics",
      steps: [
        "Funnel with conversion % and median days per stage (from real stage history).",
        "Weighted pipeline = latest offer EV (else revenue × 1.0) × column probability — edit probabilities in Admin and watch it move.",
        "Stale deals: toggle 14/30 days. Re-engage: Severn Sports Therapy is due — re-open it to Active Discussions.",
      ],
    },
  ];

  const assumptions: Array<[string, string]> = [
    ["#1", "Pinned Next.js 15.5 stable over npm's 'latest' (a 16-preview tag)."],
    ["#3", "Demo users seeded directly into auth.users with bcrypt hashes — the standard Supabase local pattern."],
    ["#4", "'One live deal per clinic' is enforced by paired triggers (a partial unique index can't see the joined deals table)."],
    ["#5", "Weighted pipeline uses 1.0× revenue when a deal has no offer (constant in src/lib/analytics/constants.ts)."],
    ["#7", "Search is pg_trgm (typo-tolerant names/postcodes/CH numbers) rather than full-text search."],
    ["#8", "The linear funnel excludes Re-engage and Dead — they're holding/terminal states reported separately."],
    ["#9", "WhatsApp day rows key on sha256(contact + ISO day); re-imports replace, never duplicate."],
    ["#11", "Roles live in user_profiles read by security-definer helpers — changes apply without re-login."],
    ["#14", "Lease 'registration required' defaults to true when term > 7 years (UK Land Registry threshold), editable."],
    ["#15", "Pipedrive stage names map case/spacing-insensitively; unknown stages are flagged and default to Identified."],
  ];

  const gaps: Array<[string, string]> = [
    ["Outlook → live Graph", "Set EMAIL_PROVIDER=graph + GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET/MAILBOX (Azure AD app: Mail.Read application permission + admin consent). Code complete, untested against a live tenant."],
    ["Pipedrive → live API", "Set PIPEDRIVE_PROVIDER=api + PIPEDRIVE_API_KEY + PIPEDRIVE_DOMAIN. Or drop real CSV exports into /imports/pipedrive/."],
    ["Companies House → live API", "Set CH_PROVIDER=api + CH_API_KEY. Director-change detection is fixture-only today (the real API needs an officers diff — noted in IDEAS)."],
    ["Email deep links", "Fixture messages link to Outlook web with fixture ids — they resolve once real Graph ids flow in."],
    ["Playwright e2e", "Skipped per spec's optional clause; key flows carry data-testid hooks to make adding it cheap (ASSUMPTIONS #6)."],
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="rounded-lg border bg-gradient-to-br from-brand-50 to-card p-5">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-brand-600" />
          <h1 className="text-xl font-semibold tracking-tight">Review & guided test</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Welcome {profile.full_name.split(" ")[0]} — everything below is seeded and ready to try.
          Status per module, then a walkthrough that exercises every feature. REVIEW.md in the
          repo records the build&apos;s own pass through these scenarios.
        </p>
      </div>

      {/* 1. status table */}
      <Card>
        <CardHeader>
          <CardTitle>Module status</CardTitle>
          <CardDescription>Built / partially built / mocked — with a deep link to try each one.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {modules.map((m) => (
              <li key={m.name} className="flex items-start gap-3 py-2.5">
                {m.status === "built" ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                ) : (
                  <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={m.href} className="text-sm font-medium hover:text-brand-700 hover:underline">
                      {m.name}
                    </Link>
                    <Badge variant="outline" className={STATUS_META[m.status].chip}>
                      {STATUS_META[m.status].label}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{m.note}</p>
                </div>
                <Link href={m.href} className="mt-1 text-slate-300 hover:text-brand-600">
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* 2. walkthrough */}
      <Card>
        <CardHeader>
          <CardTitle>Guided walkthrough</CardTitle>
          <CardDescription>Run these in order — together they cover every module.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {walkthrough.map((w, i) => (
            <div key={w.title} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-[11px] font-bold text-white">
                  {i + 1}
                </span>
                <Link href={w.href} className="text-sm font-semibold hover:text-brand-700 hover:underline">
                  {w.title}
                </Link>
                {w.download ? (
                  <a
                    href={w.download}
                    download
                    className="ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
                  >
                    <Download className="h-3 w-3" /> fixture file
                  </a>
                ) : null}
              </div>
              <ol className="mt-2 list-decimal space-y-1 pl-9 text-xs text-slate-600">
                {w.steps.map((s, j) => (
                  <li key={j}>{s}</li>
                ))}
              </ol>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 3. assumptions digest */}
      <Card>
        <CardHeader>
          <CardTitle>Assumptions digest</CardTitle>
          <CardDescription>
            Top 10 of the judgement calls made while building unattended — full list with
            reasoning and reversal notes in ASSUMPTIONS.md.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5">
            {assumptions.map(([num, text]) => (
              <li key={num} className="flex gap-2 text-sm">
                <span className="shrink-0 font-mono text-xs font-semibold text-brand-700">{num}</span>
                <span className="text-slate-600">{text}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* 4. known gaps */}
      <Card>
        <CardHeader>
          <CardTitle>Known gaps & what&apos;s mocked</CardTitle>
          <CardDescription>Each one lists the exact env flip to go live (full table in README).</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {gaps.map(([title, text]) => (
              <li key={title} className="rounded-md border bg-slate-50/60 px-3 py-2">
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs text-muted-foreground">{text}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
