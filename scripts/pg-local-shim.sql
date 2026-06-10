-- Minimal Supabase-compatible shim for PLAIN Postgres (dev machines / CI
-- without Docker). Applied automatically by scripts/db-reset.ts ONLY when the
-- "auth" schema does not exist — i.e. never on a real Supabase instance.
-- It recreates just enough of Supabase's surface for the migrations, seeds
-- and RLS checks to run: the anon/authenticated/service_role roles, an
-- auth.users + auth.identities table, and auth.uid() reading the same
-- request.jwt.claims GUC Supabase sets.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

create schema if not exists auth;

create table if not exists auth.users (
  instance_id uuid,
  id uuid primary key,
  aud text,
  role text,
  email text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  -- GoTrue token columns (referenced by supabase/staging_setup.sql)
  confirmation_token text default '',
  recovery_token text default '',
  email_change text default '',
  email_change_token_new text default ''
);

create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  identity_data jsonb,
  provider text,
  provider_id text,
  last_sign_in_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      current_setting('request.jwt.claims', true)::jsonb ->> 'sub'
    ),
    ''
  )::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
