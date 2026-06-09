import type { Sql } from "postgres";
import { did, daysAgoISO, daysFromNowISO, rng } from "./helpers";
import { cid, type ClinicSeed } from "./clinics";
import { pid } from "./contacts";
import { USERS } from "./users";
import { FIXTURE_EMAILS, MAILBOX } from "../../src/lib/email/fixtures";
import { whatsappDayRef } from "../../src/lib/whatsapp/hash";

export const dealId = (key: string) => did(`deal:${key}`);

/**
 * Insert a deal and walk it through pipeline columns so the triggers build a
 * genuine stage_history / spawn checklists, then backdate the history rows.
 * steps = [column, daysAgo][] in chronological order; extras apply to the
 * final state (dead_reason etc. are applied with the step that needs them).
 */
async function walk(
  sql: Sql,
  opts: {
    key: string;
    name: string;
    primaryClinic: string; // clinic key
    clinics?: string[]; // extra clinic keys for multi-site deals
    owner: string; // user id
    steps: Array<[column: string, daysAgo: number]>;
    firstMetOn?: string;
    firstMetContext?: string;
    nextAction?: string;
    nextActionDueDays?: number; // relative to today (negative = overdue)
    deadReason?: string;
    reengageOnDays?: number;
    keyInfo?: Record<string, unknown>;
  },
) {
  const id = dealId(opts.key);
  const [firstColumn, firstDays] = opts.steps[0];

  await sql`
    insert into public.deals (
      id, primary_clinic_id, name, pipeline_column, owner_user_id,
      first_met_on, first_met_context, key_info
    ) values (
      ${id}, ${cid(opts.primaryClinic)}, ${opts.name},
      ${firstColumn}::pipeline_column, ${opts.owner},
      ${opts.firstMetOn ?? daysAgoISO(firstDays)},
      ${opts.firstMetContext ?? null},
      ${JSON.stringify(opts.keyInfo ?? {})}::jsonb
    ) on conflict (id) do nothing`;

  for (const clinicKey of [opts.primaryClinic, ...(opts.clinics ?? [])]) {
    await sql`
      insert into public.deal_clinics (deal_id, clinic_id)
      values (${id}, ${cid(clinicKey)})
      on conflict do nothing`;
  }

  for (const [column] of opts.steps.slice(1)) {
    if (column === "dead") {
      await sql`update public.deals set dead_reason = ${opts.deadReason ?? "No reason recorded"},
        pipeline_column = 'dead' where id = ${id}`;
    } else if (column === "reengage") {
      await sql`update public.deals set reengage_on = ${daysFromNowISO(opts.reengageOnDays ?? 30)},
        pipeline_column = 'reengage' where id = ${id}`;
    } else {
      await sql`update public.deals set pipeline_column = ${column}::pipeline_column
        where id = ${id}`;
    }
  }

  if (opts.nextAction) {
    await sql`update public.deals set
      next_action = ${opts.nextAction},
      next_action_due = ${daysFromNowISO(opts.nextActionDueDays ?? 7)}
      where id = ${id}`;
  }

  // backdate the trigger-written history to the intended dates
  const history = await sql`
    select id from public.stage_history where deal_id = ${id} order by moved_at`;
  for (let i = 0; i < history.length && i < opts.steps.length; i++) {
    await sql`update public.stage_history
      set moved_at = ${daysAgoISO(opts.steps[i][1])}::date + time '10:30',
          moved_by = ${opts.owner}
      where id = ${history[i].id}`;
  }

  return id;
}

async function addInteraction(
  sql: Sql,
  deal: string,
  i: {
    contact?: string; // contact key
    daysAgo: number;
    type: string;
    direction?: string;
    subject?: string;
    summary: string;
    body?: string;
    source?: string;
    sourceRef?: string;
  },
) {
  await sql`
    insert into public.interactions (
      deal_id, contact_id, occurred_on, occurred_at, type, direction,
      subject, summary, body, source, source_ref
    ) values (
      ${dealId(deal)}, ${i.contact ? pid(i.contact) : null},
      ${daysAgoISO(i.daysAgo)}, ${daysAgoISO(i.daysAgo)}::date + time '11:00',
      ${i.type}::interaction_type,
      ${i.direction ?? null},
      ${i.subject ?? null}, ${i.summary}, ${i.body ?? null},
      ${i.source ?? "manual"}::interaction_source, ${i.sourceRef ?? null}
    ) on conflict (source_ref) do nothing`;
}

export async function seedDeals(sql: Sql, fillerClinics: ClinicSeed[]) {
  const admin = USERS.admin.id;
  const lead = USERS.lead.id;
  const f = (i: number) => fillerClinics[i];

  // ── flagship: Riverside Physio Group ──────────────────────────────────────
  const flagship = await walk(sql, {
    key: "riverside",
    name: "Riverside Physio Group",
    primaryClinic: "riverside-richmond",
    clinics: ["riverside-kingston", "riverside-putney"],
    owner: admin,
    steps: [
      ["identified", 182],
      ["gold", 150],
      ["active_discussions", 120],
      ["due_diligence", 70],
      ["hots", 41],
    ],
    firstMetOn: daysAgoISO(183),
    firstMetContext: "Met Sarah Whitfield at Therapy Expo (NEC) — intro via stand neighbour.",
    nextAction: "Return SPA v3 markup to Hartley Law",
    nextActionDueDays: 3,
    keyInfo: {
      "EBITDA (normalised)": "£405k",
      "Revenue split": "Richmond £720k / Kingston £540k / Putney £360k",
      "Sellers": "Sarah & Mark Whitfield (50/50)",
      "Adviser": "Tom Bryce, Bryce CF",
      "Seller solicitors": "Hartley Law (Priya Shah)",
      "Project name": "Project Thames",
    },
  });

  // properties BEFORE HoTs signing so the legal pack binds leases to them
  const putneyProp = did("property:riverside-putney");
  const kingstonProp = did("property:riverside-kingston");
  await sql`
    insert into public.properties (
      id, deal_id, clinic_id, address, leasehold, rent_pa, lease_start,
      lease_expiry, break_date, lease_length_years, change_of_control,
      registration_required, landlord_name, notes
    ) values
    (${putneyProp}, ${flagship}, ${cid("riverside-putney")},
     '88 Lower Richmond Road, Putney SW15 1LN', true, 38000, '2017-03-25',
     '2027-03-24', null, 10, 'consent_required', true,
     'Thamesbank Estates Ltd',
     'Landlord consent process started — consent letter received, awaiting engrossment.'),
    (${kingstonProp}, ${flagship}, ${cid("riverside-kingston")},
     '3 Market Place, Kingston upon Thames KT1 1JT', true, 27500, '2021-06-24',
     '2031-06-23', '2026-06-24', 10, 'notify_only', true,
     'Kingston Market Holdings',
     'Break date imminent — do NOT trigger; notification letter drafted.')
    on conflict (id) do nothing`;

  // sign HoTs → trigger spawns the legal pack (7 docs + 2 leases)
  await sql`update public.deals set hots_signed_at = ${daysAgoISO(41)}::date + time '15:00'
    where id = ${flagship} and hots_signed_at is null`;

  // progress the spawned docs to the flagship mix (multiple updates on the
  // SPA build a real status history trail)
  const sp = (fileName: string) =>
    `https://kinetico.sharepoint.com/sites/MA/Shared%20Documents/Riverside/${fileName}`;
  await sql`update public.documents set status='drafting', responsible='buyer_solicitors',
    url=${sp("Riverside_SPA_v1.docx")}, location_hint='sharepoint', version_label='v1'
    where deal_id=${flagship} and doc_type='spa'`;
  await sql`update public.documents set status='issued', version_label='v2',
    url=${sp("Riverside_SPA_v2.docx")} where deal_id=${flagship} and doc_type='spa'`;
  await sql`update public.documents set status='with_sellers', version_label='v3',
    url=${sp("Riverside_SPA_v3.docx")}, due_on=${daysFromNowISO(5)}
    where deal_id=${flagship} and doc_type='spa'`;
  await sql`update public.documents set status='drafting', responsible='buyer_solicitors',
    version_label='v1', location_hint='word', due_on=${daysFromNowISO(9)}
    where deal_id=${flagship} and doc_type='loan_notes'`;
  await sql`update public.documents set status='agreed', responsible='sellers',
    url=${sp("Riverside_DDQ_responses.pdf")}, location_hint='sharepoint'
    where deal_id=${flagship} and doc_type='ddq'`;
  await sql`update public.documents set status='issued', responsible='seller_solicitors',
    url=${sp("Putney_lease_consent_letter.pdf")}, location_hint='sharepoint',
    due_on=${daysFromNowISO(12)}
    where deal_id=${flagship} and doc_type='lease' and property_id=${putneyProp}`;
  await sql`update public.documents set status='agreed', responsible='seller_solicitors'
    where deal_id=${flagship} and doc_type='lease' and property_id=${kingstonProp}`;
  await sql`update public.documents set status='drafting', responsible='sellers',
    due_on=${daysFromNowISO(14)}
    where deal_id=${flagship} and doc_type='disclosure_letter'`;
  // HoTs doc: spawned as signed; give it its link card
  await sql`update public.documents set url=${sp("Riverside_HoTs_signed.pdf")},
    location_hint='sharepoint', version_label='final'
    where deal_id=${flagship} and doc_type='hots'`;

  // DD checklist part-complete (spawned by the due_diligence step)
  const ddItems = await sql`
    select i.id, i.title from public.deal_checklist_items i
    join public.deal_checklists c on c.id = i.checklist_id
    where c.deal_id = ${flagship}`;
  const itemStatus: Record<string, [status: string, note: string | null]> = {
    "Financial DD (QoE)": ["done", "QoE report received from Forsters — no red flags; normalised EBITDA £405k confirmed."],
    "Legal DD": ["in_progress", "Awaiting responses on warranty cap + restrictive covenants."],
    "Property & leases review": ["in_progress", "Putney CoC consent in motion; Kingston notification drafted."],
    "Clinical/regulatory (CQC, HTM 01-05, IRMER)": ["done", "All sites compliant; last CQC visit Jan — Good."],
    "Employment & contractors": ["open", null],
    "IT & data": ["open", null],
    "Insurance": ["n/a", "Group policy supersedes — confirmed with brokers."],
  };
  for (const row of ddItems) {
    const v = itemStatus[row.title as string];
    if (v) {
      await sql`update public.deal_checklist_items
        set status=${v[0]}::checklist_item_status, note=${v[1]} where id=${row.id}`;
    }
  }

  // offer history: verbal → IOI → LOI (accepted, 70/30, ~5.5×)
  await sql`
    insert into public.offers (id, deal_id, offer_type, made_on, enterprise_value,
      ebitda_basis, cash_pct, loan_note_pct, earn_out_summary, structure_notes, status)
    values
    (${did("offer:riverside-verbal")}, ${flagship}, 'verbal', ${daysAgoISO(150)},
     2000000, 390000, 70, 30, null,
     'Ballpark shared over dinner after site tour — warm reception.', 'superseded'),
    (${did("offer:riverside-ioi")}, ${flagship}, 'ioi', ${daysAgoISO(146)},
     2100000, 390000, 70, 30, null,
     'Indicative offer letter issued; CFDF basis.', 'superseded'),
    (${did("offer:riverside-loi")}, ${flagship}, 'loi', ${daysAgoISO(104)},
     2250000, 405000, 70, 30,
     'Up to £200k over 2 years tied to revenue retention (cap raised from £150k).',
     '6 weeks exclusivity agreed; updated EBITDA basis from Bryce CF.', 'accepted')
    on conflict (id) do nothing`;

  // WhatsApp day-collapsed entries for Sarah — the fixture export covers the
  // same April dates, so re-importing demonstrates replace-not-duplicate
  const waDays: Array<[date: string, count: number, transcript: string]> = [
    ["2026-04-12", 6, "Sarah: Quick one — does the earn-out survive if we sell Putney?\nOli: It adjusts pro-rata, schedule 3 covers it\nSarah: Perfect thanks\nOli: Call tomorrow to walk through?\nSarah: Yes 8.30 before clinic\nOli: Booked 👍"],
    ["2026-04-13", 4, "Oli: Notes from this morning sent to Tom\nSarah: Seen — happy with the retention mechanics\nSarah: Mark wants the loan note coupon confirmed\nOli: 6% per the LOI, in the instrument draft"],
    ["2026-04-15", 9, "Sarah: Landlord's agent came back on Putney consent\nOli: Good news?\nSarah: They want a rent deposit from the buyer entity\nOli: Standard ask — legal will handle\nSarah: Also they asked about works we did in 2019\nOli: Send me the licence for alterations if you have it\nSarah: Digging it out tonight\nOli: 🙏\nSarah: Found it, emailing now"],
  ];
  for (const [date, count, transcript] of waDays) {
    await sql`
      insert into public.interactions (deal_id, contact_id, occurred_on, type,
        direction, summary, body, source, source_ref)
      values (
        ${flagship}, ${pid("sarah")}, ${date}, 'whatsapp_day', null,
        ${`WhatsApp — ${count} messages`}, ${transcript}, 'whatsapp_import',
        ${whatsappDayRef(pid("sarah"), date)}
      ) on conflict (source_ref) do nothing`;
  }

  // calls / meetings / notes
  await addInteraction(sql, "riverside", { contact: "sarah", daysAgo: 176, type: "meeting",
    summary: "Coffee at Richmond clinic — toured all 3 sites, met senior team", direction: "outbound" });
  await addInteraction(sql, "riverside", { contact: "mark", daysAgo: 151, type: "meeting",
    summary: "Dinner with Sarah & Mark — talked numbers, verbal range shared" });
  await addInteraction(sql, "riverside", { contact: "tom", daysAgo: 117, type: "call",
    summary: "Process call with Tom Bryce — agreed LOI timeline and exclusivity ask" });
  await addInteraction(sql, "riverside", { contact: "priya", daysAgo: 40, type: "call",
    summary: "Legal kickoff — Hartley Law walked through DDQ schedule and SPA timetable" });
  await addInteraction(sql, "riverside", { daysAgo: 14, type: "note",
    summary: "QoE final report in — EBITDA £405k holds, working capital peg agreed" });
  await addInteraction(sql, "riverside", { contact: "sarah", daysAgo: 3, type: "call",
    summary: "Sarah pre-announcement plan call — staff comms on the 24th, aligned" });

  await sql`
    insert into public.tasks (id, deal_id, title, owner_user_id, due_on, status)
    values
    (${did("task:riverside-1")}, ${flagship}, 'Chase landlord consent — Putney lease',
     ${admin}, ${daysFromNowISO(7)}, 'open'),
    (${did("task:riverside-2")}, ${flagship}, 'Instruct loan note instrument first draft',
     ${admin}, ${daysFromNowISO(5)}, 'open')
    on conflict (id) do nothing`;

  await sql`
    insert into public.comments (id, deal_id, author_user_id, body)
    values (${did("comment:riverside-exec")}, ${flagship}, ${USERS.exec.id},
     'Impressive retention numbers in the QoE. Keen we hold the line on the earn-out cap — £200k is already generous at this multiple.')
    on conflict (id) do nothing`;

  // ── other hand deals ──────────────────────────────────────────────────────
  await walk(sql, {
    key: "harborne", name: "Harborne Spine & Sport", primaryClinic: "harborne", owner: admin,
    steps: [["identified", 150], ["gold", 120], ["active_discussions", 80], ["due_diligence", 30]],
    firstMetContext: "Inbound enquiry via website after our Birmingham acquisition was announced.",
    nextAction: "Review week-3 financial DD responses", nextActionDueDays: 2,
    keyInfo: { "EBITDA (normalised)": "£210k", "Owner ask": "2 days/week clinical for 12 months" },
  });
  await sql`
    insert into public.properties (id, deal_id, clinic_id, address, leasehold, rent_pa,
      lease_start, lease_expiry, lease_length_years, change_of_control, registration_required, landlord_name)
    values (${did("property:harborne")}, ${dealId("harborne")}, ${cid("harborne")},
      '212 High Street, Birmingham B17 9PT', true, 24000, '2019-09-29', '2029-09-28',
      10, 'unknown', true, 'Calthorpe Estates')
    on conflict (id) do nothing`;
  await sql`
    insert into public.offers (id, deal_id, offer_type, made_on, enterprise_value,
      ebitda_basis, cash_pct, loan_note_pct, status, structure_notes)
    values (${did("offer:harborne-loi")}, ${dealId("harborne")}, 'loi', ${daysAgoISO(58)},
      1050000, 210000, 70, 30, 'accepted', '12-month transition, 2 days/week clinical.')
    on conflict (id) do nothing`;
  await sql`
    insert into public.tasks (id, deal_id, title, owner_user_id, due_on, status)
    values (${did("task:harborne-1")}, ${dealId("harborne")},
      'Book QoE kickoff with Forsters', ${admin}, ${daysFromNowISO(4)}, 'open')
    on conflict (id) do nothing`;

  await walk(sql, {
    key: "caledonia", name: "Caledonia Physio Partners", primaryClinic: "caledonia", owner: lead,
    steps: [["identified", 90], ["active_discussions", 48]],
    firstMetContext: "Referred by our Edinburgh clinical director.",
    nextAction: "Send group equity rollover overview", nextActionDueDays: -2, // deliberately overdue
    keyInfo: { "Structure": "Two minority partners at 10% each", "Lease": "Leith renewal due March" },
  });
  await addInteraction(sql, "caledonia", { contact: "fraser", daysAgo: 12, type: "email",
    direction: "inbound", summary: "Rollover option interest + Leith lease timing" });

  await walk(sql, {
    key: "albion", name: "Albion MSK Clinic", primaryClinic: "albion", owner: admin,
    steps: [["identified", 100], ["silver", 70], ["active_discussions", 35]],
    nextAction: "Meet Dee — review Q3 management accounts", nextActionDueDays: 6,
  });
  await addInteraction(sql, "albion", { contact: "dee", daysAgo: 22, type: "meeting",
    summary: "First sit-down with Dee — open to sale, wants staff continuity guarantees" });

  await walk(sql, {
    key: "westbourne", name: "Westbourne Osteopathy", primaryClinic: "westbourne", owner: lead,
    steps: [["identified", 80], ["platinum", 55]],
  });
  await sql`
    insert into public.offers (id, deal_id, offer_type, made_on, enterprise_value,
      ebitda_basis, cash_pct, loan_note_pct, status)
    values (${did("offer:westbourne-verbal")}, ${dealId("westbourne")}, 'verbal',
      ${daysAgoISO(20)}, 520000, 110000, 70, 30, 'made')
    on conflict (id) do nothing`;
  await addInteraction(sql, "westbourne", { contact: "karen", daysAgo: 20, type: "call",
    summary: "Verbal range discussed with Karen — receptive, wants to talk to family" });

  await walk(sql, {
    key: "pennine", name: "The Pennine Physio Co.", primaryClinic: "pennine", owner: admin,
    steps: [["identified", 75], ["gold", 50]],
  });
  await addInteraction(sql, "pennine", { contact: "joe", daysAgo: 38, type: "call",
    summary: "Intro call with Joe — happy to share accounts after summer" });

  await walk(sql, {
    key: "cathedral", name: "Cathedral Physiotherapy", primaryClinic: "cathedral", owner: admin,
    steps: [["identified", 300], ["gold", 250], ["active_discussions", 200],
      ["due_diligence", 160], ["hots", 130], ["complete", 100]],
    keyInfo: { "Completed": "Kinetico's third acquisition", "Integration": "Done — on group PMS since month 2" },
  });

  await walk(sql, {
    key: "granite", name: "Granite City Physio", primaryClinic: "granite", owner: lead,
    steps: [["identified", 200], ["active_discussions", 150], ["dead", 90]],
    deadReason: "Vendor wanted 8× EBITDA — unbridgeable gap on price after two revised offers.",
  });

  await walk(sql, {
    key: "severn", name: "Severn Sports Therapy", primaryClinic: "severn", owner: admin,
    steps: [["identified", 180], ["active_discussions", 120], ["reengage", 60]],
    reengageOnDays: 10,
    keyInfo: { "Paused because": "Gemma wanted to finish the clinic refit before diligence" },
  });
  await sql`
    insert into public.properties (id, deal_id, clinic_id, address, leasehold, rent_pa,
      lease_expiry, lease_length_years, change_of_control, registration_required, landlord_name)
    values (${did("property:severn")}, ${dealId("severn")}, ${cid("severn")},
      'Unit 4, Docks Way, Gloucester GL1 2EH', true, 19500, '2028-02-01', 6,
      'consent_required', false, 'Pearce Property')
    on conflict (id) do nothing`;

  await walk(sql, {
    key: "maple", name: "Maple House Chiropractic", primaryClinic: "maple", owner: lead,
    steps: [["identified", 60], ["silver", 40]],
  });

  // ── filler deals to fill every column (~31 total) ────────────────────────
  const filler: Array<{
    idx: number; steps: Array<[string, number]>; owner?: string;
    nextAction?: string; nextActionDueDays?: number;
    deadReason?: string; reengageOnDays?: number;
  }> = [
    // identified ×6
    { idx: 0, steps: [["identified", 25]] },
    { idx: 1, steps: [["identified", 18]] },
    { idx: 2, steps: [["identified", 45]] },
    { idx: 3, steps: [["identified", 12]] },
    { idx: 4, steps: [["identified", 70]] },
    { idx: 5, steps: [["identified", 9]] },
    // silver ×3 (maple is the 4th)
    { idx: 6, steps: [["identified", 55], ["silver", 30]] },
    { idx: 7, steps: [["identified", 65], ["silver", 42]] },
    { idx: 8, steps: [["identified", 35], ["silver", 15]] },
    // gold ×3 (pennine is the 4th)
    { idx: 9, steps: [["identified", 95], ["gold", 60]] },
    { idx: 10, steps: [["identified", 85], ["silver", 60], ["gold", 28]] },
    { idx: 11, steps: [["identified", 50], ["gold", 21]] },
    // platinum ×2 (westbourne is the 3rd)
    { idx: 12, steps: [["identified", 110], ["gold", 80], ["platinum", 40]] },
    { idx: 13, steps: [["identified", 90], ["platinum", 33]] },
    // active_discussions ×1 (caledonia + albion are the others)
    { idx: 14, steps: [["identified", 75], ["silver", 55], ["active_discussions", 26]],
      nextAction: "Issue NDA and request last 2 years accounts", nextActionDueDays: 1 },
    // due_diligence ×1 (harborne is the other)
    { idx: 15, steps: [["identified", 130], ["gold", 100], ["active_discussions", 70], ["due_diligence", 21]],
      nextAction: "Chase outstanding DDQ sections 5–7", nextActionDueDays: -1 },
    // hots ×1 (flagship is the other) — pack spawned below
    { idx: 16, steps: [["identified", 160], ["active_discussions", 100], ["due_diligence", 70], ["hots", 25]],
      nextAction: "Agree completion accounts mechanism", nextActionDueDays: 8 },
    // complete ×1 (cathedral is the other)
    { idx: 17, steps: [["identified", 320], ["active_discussions", 260], ["due_diligence", 220],
      ["hots", 190], ["complete", 150]] },
    // reengage ×2 (severn is the 3rd)
    { idx: 18, steps: [["identified", 140], ["active_discussions", 90], ["reengage", 50]], reengageOnDays: 4 },
    { idx: 19, steps: [["identified", 120], ["reengage", 45]], reengageOnDays: 25 },
    // dead ×1 (granite is the other)
    { idx: 20, steps: [["identified", 240], ["gold", 200], ["dead", 160]],
      deadReason: "Sold to a rival consolidator — we were second in a two-horse race." },
  ];

  const r = rng(424242);
  for (const fd of filler) {
    const clinic = f(fd.idx);
    await walk(sql, {
      key: `filler-${fd.idx}`,
      name: clinic.name,
      primaryClinic: clinic.key,
      owner: fd.owner ?? (r() < 0.5 ? admin : lead),
      steps: fd.steps,
      nextAction: fd.nextAction,
      nextActionDueDays: fd.nextActionDueDays,
      deadReason: fd.deadReason,
      reengageOnDays: fd.reengageOnDays,
    });
    // a light interaction scatter; leave some deals stale on purpose
    const last = fd.steps[fd.steps.length - 1];
    if (last[0] !== "dead" && last[0] !== "complete" && r() < 0.75) {
      const ago = r() < 0.3 ? 35 + Math.floor(r() * 25) : 2 + Math.floor(r() * 12);
      await addInteraction(sql, `filler-${fd.idx}`, {
        daysAgo: ago,
        type: r() < 0.5 ? "call" : "note",
        summary: r() < 0.5
          ? "Intro call — gauging appetite, owner curious about valuation"
          : "Desk note — strong Google reviews, NHS contract mix worth a look",
      });
    }
  }

  // second HoTs deal: sign + progress two docs so the Legal Board has depth
  const second = dealId("filler-16");
  await sql`
    insert into public.properties (id, deal_id, clinic_id, address, leasehold, rent_pa,
      lease_expiry, lease_length_years, change_of_control, registration_required, landlord_name)
    values (${did("property:filler-16")}, ${second}, ${cid(f(16).key)},
      ${f(16).address_line1 + ", " + f(16).city + " " + f(16).postcode}, true, 21000,
      '2030-03-01', 8, 'notify_only', true, 'Private landlord')
    on conflict (id) do nothing`;
  await sql`update public.deals set hots_signed_at = ${daysAgoISO(20)}::date + time '12:00'
    where id = ${second} and hots_signed_at is null`;
  await sql`update public.documents set status='issued', version_label='v1', due_on=${daysFromNowISO(2)}
    where deal_id=${second} and doc_type='spa'`;
  await sql`update public.documents set status='with_sellers', due_on=${daysAgoISO(3)}
    where deal_id=${second} and doc_type='ddq'`;
  await sql`
    insert into public.offers (id, deal_id, offer_type, made_on, enterprise_value,
      ebitda_basis, cash_pct, loan_note_pct, status)
    values (${did("offer:filler-16-loi")}, ${second}, 'loi', ${daysAgoISO(75)},
      900000, 180000, 70, 30, 'accepted')
    on conflict (id) do nothing`;

  // ── timeline: fixture emails for flagship/harborne/caledonia contacts ───
  // (after all hand deals exist; alias/unmatched fixtures stay for the sync demo)
  const contactByAddress: Record<string, string> = {
    "sarah@riversidephysio.co.uk": "sarah",
    "mark@riversidephysio.co.uk": "mark",
    "tom@brycecf.co.uk": "tom",
    "priya.shah@hartleylaw.co.uk": "priya",
    "emma@harbornespinesport.co.uk": "emma",
    "fraser@caledoniaphysio.co.uk": "fraser",
  };
  const dealByContact: Record<string, string> = {
    sarah: "riverside", mark: "riverside", tom: "riverside", priya: "riverside",
    emma: "harborne", fraser: "caledonia",
  };
  for (const msg of FIXTURE_EMAILS) {
    const participants = [msg.from, ...msg.to, ...msg.cc].map((a) => a.address);
    const contactKey = participants.map((a) => contactByAddress[a]).find(Boolean);
    if (!contactKey) continue;
    await sql`
      insert into public.interactions (deal_id, contact_id, occurred_on, occurred_at,
        type, direction, subject, summary, body, source, source_ref)
      values (
        ${dealId(dealByContact[contactKey])}, ${pid(contactKey)},
        ${msg.receivedAt.slice(0, 10)}, ${msg.receivedAt}, 'email',
        ${msg.from.address === MAILBOX ? "outbound" : "inbound"},
        ${msg.subject}, ${msg.subject}, ${msg.body}, 'outlook_sync', ${msg.graphId}
      ) on conflict (source_ref) do nothing`;
  }

  // ── viewer grants: exactly 2 deals (acceptance criterion) ────────────────
  await sql`
    insert into public.deal_access (user_id, deal_id) values
    (${USERS.viewer.id}, ${flagship}),
    (${USERS.viewer.id}, ${dealId("harborne")})
    on conflict do nothing`;

  // ── CH signals + historic sync runs + a saved view ───────────────────────
  await sql`
    insert into public.ch_signals (id, clinic_id, signal_type, detail, seen_on) values
    (${did("chsig:harborne")}, ${cid("harborne")}, 'accounts_filed',
     ${sql.json({ made_up_to: "2025-12-31", filed_on: daysAgoISO(6) })}, ${daysAgoISO(6)}),
    (${did("chsig:caledonia")}, ${cid("caledonia")}, 'director_change',
     ${sql.json({ change: "Appointment of NEIL ROSS as director", filed_on: daysAgoISO(11) })}, ${daysAgoISO(11)})
    on conflict (id) do nothing`;

  await sql`
    insert into public.sync_runs (id, source, started_at, finished_at, status, counts) values
    (${did("sync:clinic-import")}, 'clinic_import', ${daysAgoISO(30)}::date + time '08:00',
     ${daysAgoISO(30)}::date + time '08:01', 'success',
     ${sql.json({ records_in: 80, written: 80, skipped: 0 })}),
    (${did("sync:outlook-1")}, 'outlook', ${daysAgoISO(1)}::date + time '07:30',
     ${daysAgoISO(1)}::date + time '07:31', 'success',
     ${sql.json({ provider_delta: 24, written: 24, matched_by_address: 21, matched_by_alias: 3, unmatched: 0 })}),
    (${did("sync:ch-1")}, 'companies_house', ${daysAgoISO(6)}::date + time '06:00',
     ${daysAgoISO(6)}::date + time '06:02', 'success',
     ${sql.json({ clinics_checked: 12, signals_created: 2 })})
    on conflict (id) do nothing`;

  await sql`
    insert into public.saved_views (id, user_id, page, name, filters) values
    (${did("view:admin-platinum")}, ${admin}, 'pipeline', 'Platinum & beyond',
     ${sql.json({ tiers: ["platinum"], owner: "all" })})
    on conflict (id) do nothing`;
}
