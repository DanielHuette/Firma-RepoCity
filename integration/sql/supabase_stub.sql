-- What the Supabase project provides before any migration runs, reduced to what the migrations use.
-- Context: integration tests on a throwaway PostgreSQL; never applied to the real project. | Input:
-- an empty database. | Output: roles anon, authenticated, service_role and authenticator; schema
-- auth with users, uid() and role() read from request.jwt.claims; schema storage with buckets and
-- objects; Vault with secrets and their decrypted view; pg_net's http_post recording every call in
-- net.calls; pg_cron's schedule and unschedule on cron.job; the publication supabase_realtime; and
-- Supabase's default grants on schema public.

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if not exists (select 1 from pg_roles where rolname = v_role) then
      execute format('create role %I nologin noinherit', v_role);
    end if;
  end loop;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator noinherit login;
  end if;
end $$;
alter role service_role bypassrls;
grant anon, authenticated, service_role to authenticator;

create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid
language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;
create function auth.role() returns text
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  created_at timestamptz default now(),
  metadata jsonb
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant all on all tables in schema storage to authenticated, service_role;

create schema vault;
create table vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text unique,
  secret text not null
);
create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(p_secret text, p_name text) returns uuid
language sql as $$ insert into vault.secrets (name, secret) values (p_name, p_secret) returning id $$;
create function vault.update_secret(p_id uuid, p_secret text) returns void
language sql as $$ update vault.secrets set secret = p_secret where id = p_id $$;
insert into vault.secrets (name, secret) values ('crm_service_key', 'test-service-key');

create schema net;
create table net.calls (
  id bigserial primary key,
  url text not null,
  headers jsonb not null,
  body jsonb not null
);
create function net.http_post(
  url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}',
  timeout_milliseconds int default 5000
) returns bigint
language sql as $$ insert into net.calls (url, headers, body) values (url, headers, body) returning id $$;

create schema cron;
create table cron.job (
  jobid bigserial primary key,
  jobname text unique,
  schedule text not null,
  command text not null
);
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint
language sql as $$
  insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid
$$;
create function cron.unschedule(p_job bigint) returns boolean
language sql as $$ delete from cron.job where jobid = p_job returning true $$;
create function cron.unschedule(p_name text) returns boolean
language sql as $$ delete from cron.job where jobname = p_name returning true $$;

create publication supabase_realtime;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
