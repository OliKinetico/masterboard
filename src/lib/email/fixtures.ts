import type { EmailAddress, EmailAttachment, EmailMessage } from "./types";

/**
 * Deterministic fixture mailbox for the FixtureEmailProvider (spec §5.7).
 * Covers: matched-by-address (flagship + other deals), matched-by-alias
 * (unknown sender, clinic name in subject/body), and unmatched messages.
 * Dates are relative to "now" so the demo always looks current; graphIds are
 * fixed so re-syncs upsert instead of duplicating.
 */

export const MAILBOX = "oli@kinetico.health";

const OLI: EmailAddress = { name: "Oli (Kinetico)", address: MAILBOX };
const SARAH: EmailAddress = { name: "Sarah Whitfield", address: "sarah@riversidephysio.co.uk" };
const MARK: EmailAddress = { name: "Mark Whitfield", address: "mark@riversidephysio.co.uk" };
const TOM: EmailAddress = { name: "Tom Bryce", address: "tom@brycecf.co.uk" };
const PRIYA: EmailAddress = { name: "Priya Shah", address: "priya.shah@hartleylaw.co.uk" };
const EMMA: EmailAddress = { name: "Emma Carlton", address: "emma@harbornespinesport.co.uk" };
const FRASER: EmailAddress = { name: "Fraser McAllister", address: "fraser@caledoniaphysio.co.uk" };

function dAgo(days: number, hour = 10, minute = 14): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

let n = 0;
function m(
  daysAgo: number,
  from: EmailAddress,
  to: EmailAddress[],
  subject: string,
  body: string,
  opts: { cc?: EmailAddress[]; attachments?: EmailAttachment[]; hour?: number } = {},
): EmailMessage {
  n += 1;
  return {
    graphId: `fixture-msg-${String(n).padStart(3, "0")}`,
    from,
    to,
    cc: opts.cc ?? [],
    subject,
    bodyPreview: body.slice(0, 120),
    body,
    receivedAt: dAgo(daysAgo, opts.hour ?? 9 + (n % 8)),
    attachments: opts.attachments ?? [],
  };
}

const sp = (file: string) =>
  `https://kinetico.sharepoint.com/sites/MA/Shared%20Documents/Riverside/${encodeURIComponent(file)}`;

export const FIXTURE_EMAILS: EmailMessage[] = [
  // ── Riverside Physio Group (flagship) — ~6 months of thread ──────────────
  m(182, OLI, [SARAH], "Great to meet at Therapy Expo",
    "Sarah — really enjoyed our chat at the NEC yesterday. As discussed, Kinetico is building a clinician-led group and Riverside is exactly the kind of practice we admire. Would you be open to a coffee in the next couple of weeks?"),
  m(178, SARAH, [OLI], "RE: Great to meet at Therapy Expo",
    "Hi Oli, likewise! Mark and I have been thinking about the next chapter for a while. Happy to meet — Thursdays are best at the Richmond clinic."),
  m(165, OLI, [SARAH, MARK], "Following up — high-level numbers",
    "Thanks both for the tour on Thursday. To take this forward we'd need last two years' accounts and a rough split of clinic revenue across Richmond, Kingston and Putney. Happy to sign an NDA first of course."),
  m(160, MARK, [OLI], "RE: Following up — high-level numbers",
    "NDA signed and attached. Headline: group did £1.62m last year across the three sites, EBITDA around £390k after our salaries. Detail to follow from our accountant.",
    { attachments: [{ name: "Riverside_NDA_signed.pdf", deepLink: sp("Riverside_NDA_signed.pdf") }] }),
  m(146, OLI, [MARK], "Indicative offer — Riverside Physio Group",
    "Mark, Sarah — following our call, please find attached our indicative offer letter: £2.1m enterprise value on a cash-free debt-free basis, 70% cash at completion and 30% loan notes over 3 years.",
    { attachments: [{ name: "Riverside_IOI_v1.pdf", deepLink: sp("Riverside_IOI_v1.pdf") }] }),
  m(139, SARAH, [OLI], "RE: Indicative offer — Riverside Physio Group",
    "Oli — thank you, it's a fair starting point. We'd like to talk about the earn-out element and what happens with the Putney lease renewal before we respond formally."),
  m(126, TOM, [OLI], "Introducing myself — acting for Riverside",
    "Oli, I'm advising Sarah and Mark Whitfield on the potential sale of Riverside Physio Group. Could we set up a call this week to discuss process and timetable?"),
  m(118, OLI, [TOM], "RE: Introducing myself — acting for Riverside",
    "Welcome aboard Tom. Call booked for Thursday. Our revised LOI will reflect the updated EBITDA figure of £405k your team shared."),
  m(104, OLI, [TOM], "LOI — Riverside Physio Group",
    "Tom — attached is our LOI: £2.25m EV (~5.5x), 70/30 cash/loan notes, plus a 2-year earn-out of up to £150k tied to revenue retention. We propose 8 weeks exclusivity.",
    { cc: [SARAH, MARK], attachments: [{ name: "Riverside_LOI_v2.pdf", deepLink: sp("Riverside_LOI_v2.pdf") }] }),
  m(96, TOM, [OLI], "RE: LOI — Riverside Physio Group",
    "Oli — clients are minded to accept. Two asks: earn-out cap at £200k and exclusivity at 6 weeks. If agreeable we'll countersign this week."),
  m(88, OLI, [TOM], "RE: LOI — agreed position",
    "Agreed on both. Amended LOI attached for countersignature. Looking forward to getting into DD.",
    { attachments: [{ name: "Riverside_LOI_v3_final.pdf", deepLink: sp("Riverside_LOI_v3_final.pdf") }] }),
  m(74, PRIYA, [OLI], "Hartley Law instructed — Riverside / Project Thames",
    "Dear Oli, we are instructed by the sellers of Riverside Physio Group. Please direct legal correspondence to me. Our DDQ responses will follow by the end of next week.",
    { cc: [TOM] }),
  m(60, PRIYA, [OLI], "DDQ responses + data room access",
    "DDQ responses uploaded to the data room. Note the Putney lease has a landlord consent requirement on change of control — flagged in section 7.",
    { attachments: [{ name: "Riverside_DDQ_responses.pdf", deepLink: sp("Riverside_DDQ_responses.pdf") }] }),
  m(41, OLI, [PRIYA], "Heads of Terms — execution copies",
    "Priya — HoTs signed by both sides today. Our solicitors will issue the first draft SPA within two weeks. Property: we'll need the landlord consent process started on Putney now please.",
    { cc: [TOM, SARAH, MARK] }),
  m(20, PRIYA, [OLI], "SPA first draft — comments",
    "Our markup of the SPA is attached. Main points: warranty cap, restrictive covenants duration, and the earn-out mechanics schedule.",
    { attachments: [{ name: "Riverside_SPA_v2_HL_markup.docx", deepLink: sp("Riverside_SPA_v2_HL_markup.docx") }] }),
  m(6, PRIYA, [OLI], "SPA v3 + loan note instrument",
    "SPA v3 attached reflecting Friday's call — now with sellers for review. First draft of the loan note instrument to follow from your side per the agreed split.",
    { cc: [TOM], attachments: [
      { name: "Riverside_SPA_v3.docx", deepLink: sp("Riverside_SPA_v3.docx") },
      { name: "Putney_lease_consent_letter.pdf", deepLink: sp("Putney_lease_consent_letter.pdf") },
    ] }),
  m(2, SARAH, [OLI], "Team announcement timing",
    "Oli — once the SPA settles, can we agree the staff announcement plan? We'd like to tell the senior physios in person at the Richmond team day on the 24th."),

  // ── Harborne Spine & Sport (due diligence) ───────────────────────────────
  m(95, EMMA, [OLI], "Accounts as requested",
    "Oli, attached the FY23 and FY24 accounts plus practitioner utilisation split. EBITDA normalises to about £210k once you add back my locum cover.",
    { attachments: [{ name: "Harborne_accounts_FY24.pdf", deepLink: "https://kinetico.sharepoint.com/sites/MA/Harborne/Harborne_accounts_FY24.pdf" }] }),
  m(58, OLI, [EMMA], "Offer letter — Harborne Spine & Sport",
    "Emma — formal offer attached: £1.05m EV, 70/30 structure, with a 12-month transition period for you at 2 days a week."),
  m(33, EMMA, [OLI], "RE: Offer letter — accepted in principle",
    "Happy to proceed on that basis. My accountant will send the DD pack contents this week. CQC inspection report from January also attached.",
    { attachments: [{ name: "Harborne_CQC_Jan_report.pdf", deepLink: "https://kinetico.sharepoint.com/sites/MA/Harborne/Harborne_CQC_Jan_report.pdf" }] }),
  m(9, EMMA, [OLI], "DD queries — week 3 responses",
    "Responses to the outstanding financial DD queries attached. Two employment contracts are still on old templates — our solicitor suggests a deed of variation pre-completion."),

  // ── Caledonia Physio Partners (active discussions) ───────────────────────
  m(48, FRASER, [OLI], "Caledonia — partnership structure question",
    "Oli, before we go further: two of our senior physios hold 10% each. Any acquisition would need to address their positions — how has Kinetico handled minority holders before?"),
  m(27, OLI, [FRASER], "RE: partnership structure question",
    "Fraser — we've done this twice: minority holders either sell alongside on identical terms or roll into Kinetico group equity. Happy to walk through both models on a call."),
  m(12, FRASER, [OLI], "RE: partnership structure question",
    "The rollover option is interesting. Can you send the group equity overview? Also our Leith lease renews in March — worth factoring into timing."),

  // ── matched-by-alias: unknown senders, clinic name in subject/body ───────
  m(36, { name: "Gail Hutton", address: "gail.hutton@gmail.com" }, [OLI],
    "Harborne Spine & Sport — reference request",
    "Hello, I understand you may be acquiring Harborne Spine & Sport. I run the pilates studio next door and wanted to ask about the shared car park arrangement going forward."),
  m(23, { name: "Raj Patel", address: "raj.patel.accounts@outlook.com" }, [OLI],
    "Albion MSK Clinic — management accounts",
    "Hi Oli, Dee asked me to send over the Albion MSK Clinic management accounts for Q3 ahead of your meeting. Apologies for sending from my personal address — office 365 migration this week.",
    { attachments: [{ name: "Albion_MSK_Q3_management_accounts.xlsx", deepLink: "https://kinetico.sharepoint.com/sites/MA/Albion/Albion_MSK_Q3.xlsx" }] }),
  m(15, { name: "Donna Pearce", address: "d.pearce@pearceproperty.co.uk" }, [OLI],
    "Lease query re Severn Sports Therapy",
    "Good afternoon — I act for the landlord of the Severn Sports Therapy unit in Gloucester. We've heard a sale may be in progress; please note the lease requires consent on any change of control."),

  // ── unmatched: should land in the Unmatched Inbox ────────────────────────
  m(31, { name: "Hugo Lindqvist", address: "hugo@medibrokers.eu" }, [OLI],
    "Off-market opportunity — podiatry group, South Coast",
    "Oli — we have a 4-site podiatry group on the South Coast coming to market quietly. £2.8m revenue, owner retiring. Interested in a teaser?"),
  m(25, { name: "CQC Updates", address: "no-reply@cqc.org.uk" }, [OLI],
    "Your CQC bulletin — November",
    "The latest provider bulletin includes changes to registration requirements for multi-site providers and an update on IR(ME)R inspection scheduling."),
  m(17, { name: "Janet Mills", address: "janet.mills@nhs.net" }, [OLI],
    "MSK triage pathway meeting",
    "Dear Oliver, following the ICS meeting, are you free to discuss the community MSK triage pathway pilot? We're inviting independent providers to tender in the spring."),
  m(11, { name: "Ben Tan", address: "ben.tan@equipmed.co.uk" }, [OLI],
    "Shockwave therapy units — group pricing",
    "Hi, saw Kinetico is growing — we offer group purchasing rates on ESWT units and rehab equipment. Could I get 15 minutes?"),
  m(4, { name: "Laura Finch", address: "laura@finchrecruitment.co.uk" }, [OLI],
    "MSK physio candidates available",
    "Two band 7 equivalent MSK physios available in the Midlands, both happy to relocate. CVs on request."),
];
