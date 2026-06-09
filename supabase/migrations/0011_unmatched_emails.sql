-- 0011: Unmatched Inbox (spec §5.7 matcher step 3). Synced messages that
-- matched no contact address and no clinic alias land here for one-tap
-- assignment; assigning creates the interaction (+ optionally the contact).

create type unmatched_email_status as enum ('pending','assigned','dismissed');

create table public.unmatched_emails (
  id uuid primary key default gen_random_uuid(),
  graph_id text not null unique,
  from_name text,
  from_address text not null,
  to_addresses text[] not null default '{}',
  subject text,
  body_preview text,
  body text,
  received_at timestamptz not null,
  attachments jsonb not null default '[]'::jsonb,
  status unmatched_email_status not null default 'pending',
  assigned_deal_id uuid references public.deals (id) on delete set null,
  assigned_interaction_id uuid references public.interactions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_unmatched_emails_updated
  before update on public.unmatched_emails
  for each row execute function public.set_updated_at();

create index idx_unmatched_emails_pending
  on public.unmatched_emails (received_at desc) where status = 'pending';

alter table public.unmatched_emails enable row level security;
create policy unmatched_emails_select on public.unmatched_emails
  for select to authenticated using (public.role_of() in ('admin','deal_lead','exec'));
create policy unmatched_emails_write on public.unmatched_emails
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
