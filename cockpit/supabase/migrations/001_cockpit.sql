-- RepoCity Cockpit: the message centre above all RepoCity apps.
-- Context: own schema "cockpit" in the shared Supabase project next to "crm"; builds on
-- public.is_admin(), the vault secret crm_service_key, pg_net and pg_cron. | Input: events of the
-- apps (CRM triggers today, marketing and trading later) via cockpit.notify(). | Output: messages
-- for the Cockpit app and a push to every registered device through the Edge Function cockpit-push.

create schema if not exists cockpit;

create table if not exists cockpit.messages (
  id uuid primary key default gen_random_uuid(),
  app text not null check (app in ('crm', 'marketing', 'trading', 'system')),
  kind text not null check (length(btrim(kind)) between 1 and 40),
  title text not null check (length(btrim(title)) between 1 and 200),
  body text not null default '',
  link text not null default '',
  priority text not null default 'info' check (priority in ('info', 'wichtig', 'dringend')),
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  pushed_at timestamptz,
  push_error text not null default ''
);
create index if not exists messages_recent on cockpit.messages (created_at desc);
create index if not exists messages_unread on cockpit.messages (created_at desc) where read_at is null;

create table if not exists cockpit.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique check (endpoint like 'https://%'),
  p256dh text not null,
  auth text not null,
  device text not null default '',
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  failures int not null default 0
);

-- Key pair of the push sender (Voluntary Application Server Identification). The Edge Function
-- creates it on first use; no policy grants access, so only the service role reads it.
create table if not exists cockpit.push_keys (
  id boolean primary key default true check (id),
  public_key text not null,
  private_jwk jsonb not null,
  created_at timestamptz not null default now()
);

alter table cockpit.messages enable row level security;
alter table cockpit.push_subscriptions enable row level security;
alter table cockpit.push_keys enable row level security;

drop policy if exists admin_all on cockpit.messages;
create policy admin_all on cockpit.messages for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_all on cockpit.push_subscriptions;
create policy admin_all on cockpit.push_subscriptions for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Hands a message to the push function. Runs asynchronously through pg_net, so a slow push
-- service never holds up the transaction that caused the message.
create or replace function cockpit.push(p_message uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform net.http_post(
    url := 'https://yizvntdwdajlgcbjcves.supabase.co/functions/v1/cockpit-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'crm_service_key')),
    body := jsonb_build_object('action', 'send', 'message_id', p_message),
    timeout_milliseconds := 30000);
end $$;

-- The one way into the message centre. A repeated dedupe key is ignored, so recurring checks can
-- report the same state every hour without flooding the phone.
create or replace function cockpit.notify(
  p_app text, p_kind text, p_title text, p_body text default '', p_link text default '',
  p_priority text default 'info', p_dedupe text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;
  insert into cockpit.messages (app, kind, title, body, link, priority, dedupe_key)
  values (p_app, p_kind, left(btrim(p_title), 200), coalesce(p_body, ''), coalesce(p_link, ''), p_priority, p_dedupe)
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  if v_id is not null then
    perform cockpit.push(v_id);
  end if;
  return v_id;
end $$;

-- A failing message must never undo the business event that caused it.
create or replace function cockpit.notify_safe(
  p_app text, p_kind text, p_title text, p_body text, p_link text, p_priority text, p_dedupe text default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform cockpit.notify(p_app, p_kind, p_title, p_body, p_link, p_priority, p_dedupe);
exception when others then
  raise warning 'cockpit.notify failed: %', sqlerrm;
end $$;

-- German money format without depending on the server locale: 1.234,50
create or replace function cockpit.euro(p numeric) returns text
language sql immutable set search_path = '' as $$
  select translate(to_char(coalesce(p, 0), 'FM999,999,990.00'), ',.', '.,')
$$;

-- CRM events

create or replace function cockpit.on_crm_customer() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform cockpit.notify_safe('crm', 'kunde', 'Neuer Kunde: ' || new.name,
    'Quelle: ' || case new.source when 'website' then 'Webseite' when 'phone' then 'Telefon' when 'email' then 'E-Mail'
      when 'referral' then 'Empfehlung' when 'agent' then 'KI-Agent' when 'manual' then 'von Hand' else 'sonstige' end
      || case when coalesce(new.email, '') <> '' then ' · ' || new.email else '' end,
    'https://crm.speedofthespirit.dev/kunde/' || new.id, 'wichtig', 'kunde-' || new.id);
  return new;
end $$;
drop trigger if exists cockpit_customer on crm.customers;
create trigger cockpit_customer after insert on crm.customers for each row execute function cockpit.on_crm_customer();

create or replace function cockpit.on_crm_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'pending' then
    perform cockpit.notify_safe('crm', 'freigabe', 'Freigabe nötig: ' || new.title,
      left(regexp_replace(new.body, '\s+', ' ', 'g'), 240),
      'https://crm.speedofthespirit.dev/freigaben', 'wichtig', 'freigabe-' || new.id);
  end if;
  return new;
end $$;
drop trigger if exists cockpit_approval on crm.approvals;
create trigger cockpit_approval after insert on crm.approvals for each row execute function cockpit.on_crm_approval();

create or replace function cockpit.on_crm_payment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_number text; v_customer text;
begin
  select i.number, c.name into v_number, v_customer
    from crm.invoices i join crm.customers c on c.id = i.customer_id where i.id = new.invoice_id;
  perform cockpit.notify_safe('crm', 'zahlung',
    'Zahlung eingegangen: ' || cockpit.euro(new.amount) || ' €',
    coalesce(v_customer, '') || coalesce(' · Rechnung ' || v_number, ''),
    'https://crm.speedofthespirit.dev/rechnung/' || new.invoice_id, 'info', 'zahlung-' || new.id);
  return new;
end $$;
drop trigger if exists cockpit_payment on crm.payments;
create trigger cockpit_payment after insert on crm.payments for each row execute function cockpit.on_crm_payment();

create or replace function cockpit.on_crm_review() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'open' and new.verdict = 'unsure' then
    perform cockpit.notify_safe('crm', 'absender', 'Möglicher Kunde: ' || coalesce(nullif(new.name, ''), new.address),
      coalesce(nullif(new.subject, ''), '(ohne Betreff)') || ' · ' || new.address,
      'https://crm.speedofthespirit.dev/freigaben?ansicht=absender', 'wichtig', 'absender-' || new.id);
  end if;
  return new;
end $$;
drop trigger if exists cockpit_review on crm.mail_review;
create trigger cockpit_review after insert on crm.mail_review for each row execute function cockpit.on_crm_review();

create or replace function cockpit.on_crm_outbox() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'failed' and old.status is distinct from 'failed' then
    perform cockpit.notify_safe('crm', 'mail-fehler', 'Mail nicht verschickt: ' || new.subject,
      'An ' || new.to_address || ' · ' || left(new.error, 200),
      'https://crm.speedofthespirit.dev/einstellungen?bereich=anbindungen', 'dringend', 'outbox-' || new.id || '-' || new.attempts);
  end if;
  return new;
end $$;
drop trigger if exists cockpit_outbox on crm.outbox;
create trigger cockpit_outbox after update on crm.outbox for each row execute function cockpit.on_crm_outbox();

-- Recurring checks

-- The mailbox is checked every five minutes; an hour of silence means something is wrong. One
-- message per day at most.
create or replace function cockpit.check_health() returns void
language plpgsql security definer set search_path = '' as $$
declare v_error text;
begin
  select string_agg(nullif(last_error, ''), ' · ') into v_error from crm.mail_sync;
  if exists (select 1 from crm.mail_sync where last_error <> '' or synced_at < now() - interval '1 hour') then
    perform cockpit.notify_safe('system', 'postfach', 'Postfach wird nicht abgerufen',
      coalesce(left(v_error, 240), 'Seit über einer Stunde kein erfolgreicher Abruf.'),
      'https://crm.speedofthespirit.dev/einstellungen?bereich=anbindungen', 'dringend',
      'postfach-' || to_char(now() at time zone 'Europe/Berlin', 'YYYY-MM-DD'));
  end if;
end $$;

-- Morning overview for the lock screen.
create or replace function cockpit.daily_brief() returns uuid
language plpgsql security definer set search_path = '' as $$
declare o jsonb; v_lines text[] := '{}'; v_title text;
begin
  o := crm.today_overview();
  if (o ->> 'pending_approvals')::int > 0 then v_lines := v_lines || ((o ->> 'pending_approvals') || ' Freigaben offen'); end if;
  if (o ->> 'unknown_senders')::int > 0 then v_lines := v_lines || ((o ->> 'unknown_senders') || ' unbekannte Absender'); end if;
  if (o ->> 'new_inquiries')::int > 0 then v_lines := v_lines || ((o ->> 'new_inquiries') || ' neue Anfragen'); end if;
  if (o ->> 'overdue_invoices')::int > 0 then v_lines := v_lines || ((o ->> 'overdue_invoices') || ' Rechnungen überfällig'); end if;
  if (o ->> 'tasks_due')::int > 0 then v_lines := v_lines || ((o ->> 'tasks_due') || ' Aufgaben fällig'); end if;
  if (o ->> 'open_tickets')::int > 0 then v_lines := v_lines || ((o ->> 'open_tickets') || ' Service-Fälle offen'); end if;
  v_lines := v_lines || ('Offene Forderungen ' || cockpit.euro((o ->> 'receivables')::numeric) || ' €');
  v_lines := v_lines || ('Eingang im Monat ' || cockpit.euro((o ->> 'paid_this_month')::numeric) || ' €');
  v_title := case array_length(v_lines, 1) - 2 when 0 then 'Guten Morgen – alles ruhig' when 1 then 'Guten Morgen – 1 Punkt wartet'
    else 'Guten Morgen – ' || (array_length(v_lines, 1) - 2) || ' Punkte warten' end;
  return cockpit.notify('system', 'tagesueberblick', v_title, array_to_string(v_lines, ' · '),
    '/', 'info', 'tag-' || to_char(now() at time zone 'Europe/Berlin', 'YYYY-MM-DD'));
end $$;

-- Live updates for the open app
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'cockpit' and tablename = 'messages') then
    alter publication supabase_realtime add table cockpit.messages;
  end if;
end $$;

grant usage on schema cockpit to authenticated, service_role;
grant select, insert, update, delete on cockpit.messages, cockpit.push_subscriptions to authenticated, service_role;
grant select, insert, update, delete on cockpit.push_keys to service_role;
revoke all on all functions in schema cockpit from public, anon;
grant execute on function cockpit.notify(text, text, text, text, text, text, text) to authenticated, service_role;
grant execute on function cockpit.daily_brief() to authenticated, service_role;

-- The REST interface serves only listed schemas; keep the existing list and add cockpit.
do $$
declare v_current text;
begin
  select substr(c, length('pgrst.db_schemas=') + 1) into v_current
    from pg_roles r, unnest(r.rolconfig) c
   where r.rolname = 'authenticator' and c like 'pgrst.db_schemas=%';
  v_current := coalesce(v_current, 'public, graphql_public');
  if v_current !~ '(^|,\s*)cockpit(\s*,|$)' then
    execute format('alter role authenticator set pgrst.db_schemas = %L', v_current || ', cockpit');
  end if;
end $$;

-- 06:00 UTC is 07:00 in Münster in winter and 08:00 in summer.
select cron.unschedule(jobid) from cron.job where jobname in ('cockpit-brief', 'cockpit-health');
select cron.schedule('cockpit-brief', '0 6 * * *', $job$ select cockpit.daily_brief(); $job$);
select cron.schedule('cockpit-health', '17 * * * *', $job$ select cockpit.check_health(); $job$);

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
