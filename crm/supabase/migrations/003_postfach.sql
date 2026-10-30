-- RepoCity CRM, mailbox automation: secrets in Supabase Vault, a lease against overlapping runs,
-- and the schedules that call the mail worker every five minutes and the daily routine at 6 o'clock.
-- Context: builds on 002_kundenakte.sql; needs the extensions pg_cron, pg_net and supabase_vault.
-- | Input: none. | Output: functions for the worker, two cron jobs.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Secrets are written once by a setup script with the service key and read only by the worker.
create or replace function crm.set_secret(p_name text, p_value text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid;
begin
  if p_name not in ('crm_mail_address', 'crm_mail_password', 'crm_anthropic_key', 'crm_service_key') then
    raise exception 'Unbekannter Schlüssel %.', p_name;
  end if;
  if coalesce(p_value, '') = '' then raise exception 'Leerer Wert für %.', p_name; end if;
  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then perform vault.create_secret(p_value, p_name); else perform vault.update_secret(v_id, p_value); end if;
end $$;

create or replace function crm.mail_config() returns jsonb
language sql stable security definer set search_path = public, vault as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
    from vault.decrypted_secrets where name in ('crm_mail_address', 'crm_mail_password', 'crm_anthropic_key')
$$;

revoke all on function crm.set_secret(text, text) from public, anon, authenticated;
revoke all on function crm.mail_config() from public, anon, authenticated;
grant execute on function crm.set_secret(text, text) to service_role;
grant execute on function crm.mail_config() to service_role;

-- One run at a time; a crashed run frees the lease after its time is up.
create table if not exists crm.worker_lease (
  id int primary key default 1 check (id = 1),
  held_until timestamptz not null default '-infinity'
);
alter table crm.worker_lease add column if not exists auth_failed_hash text not null default '';
insert into crm.worker_lease (id) values (1) on conflict do nothing;
alter table crm.worker_lease enable row level security;

create or replace function crm.acquire_mail_lease(p_seconds int) returns boolean
language sql as $$
  with taken as (
    update crm.worker_lease set held_until = now() + make_interval(secs => p_seconds)
     where id = 1 and held_until < now() returning 1
  ) select exists (select 1 from taken)
$$;

create or replace function crm.release_mail_lease() returns void
language sql as $$ update crm.worker_lease set held_until = '-infinity' where id = 1 $$;

revoke all on function crm.acquire_mail_lease(int) from public, anon, authenticated;
revoke all on function crm.release_mail_lease() from public, anon, authenticated;
grant execute on function crm.acquire_mail_lease(int) to service_role;
grant execute on function crm.release_mail_lease() to service_role;
grant select, insert, update on crm.worker_lease to service_role;

-- Schedules. The worker URL follows the project reference of this database.
select cron.schedule('crm-mail', '*/5 * * * *', $job$
  select net.http_post(
    url := 'https://yizvntdwdajlgcbjcves.supabase.co/functions/v1/crm-mail',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'crm_service_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000)
$job$);

-- Daily routine without anyone opening the app: dunning approvals and subscription invoices.
select cron.schedule('crm-daily', '0 5 * * *', $job$ select crm.run_dunning(); select crm.bill_subscriptions(); $job$);

notify pgrst, 'reload schema';
