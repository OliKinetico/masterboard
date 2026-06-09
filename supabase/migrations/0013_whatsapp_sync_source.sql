-- 0013: WhatsApp imports write reconciliation rows to sync_runs too
-- (spec §1.5: every import produces a reconciliation count).
alter type sync_source add value if not exists 'whatsapp';
