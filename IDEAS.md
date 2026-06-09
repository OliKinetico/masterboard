# IDEAS

Out-of-scope ideas that came up during the build — deliberately **not** implemented (spec §1.8: scope discipline). Each one is a candidate for a future iteration.

- **Postcode → region auto-fill**: derive `region` from the postcode area (e.g. `M`→North West) on clinic create/import instead of trusting the source data.
- **Deal room files via SharePoint Graph API**: today documents are link-cards; Graph's `driveItem` API could list the actual deal folder and keep statuses in sync with file activity.
- **Email send (not just read)**: a "reply from CRM" composer using Graph `sendMail`, logged automatically to the timeline.
- **Score model**: `clinics.score` is imported/manual; a transparent scoring formula (revenue band + discipline mix + region density + CH filing health) would make tier triage consistent.
- **Companies House officers sync**: auto-create `contacts` (role=director) from CH officers list on clinic enrichment.
- **WhatsApp Business API ingestion**: replace manual .txt export uploads with the Cloud API webhook for fully automatic day-collapsed logging.
- **Mobile PWA install + offline quick-log queue**: quick-log writes to an outbox when offline, syncs when back on signal (clinic visits often have poor reception).
- **Audit log table** capturing every mutation (who/what/before/after) beyond the status-history tables the spec requires.
- **Deal valuation scenarios**: side-by-side offer modelling (cash/loan-note/earn-out sliders showing vendor proceeds vs Kinetico cash-out) on the Offers tab.
- **Slack/Teams digest**: morning push of overdue next-actions, stale deals and legal docs needing a chase.
