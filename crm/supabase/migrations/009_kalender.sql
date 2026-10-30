-- RepoCity CRM, calendar: appointments with reminders, a calendar feed, confirmations and callbacks.
-- Context: builds on 001-008; decided with Daniel on 30.10.2026 (Nova point 2): an appointment has a
-- day, a time or none, a duration, a kind (on-site meeting, callback, call, other), a customer, a place
-- and a note; the Cockpit lists the day's appointments in the morning and pushes a reminder before
-- each one; a secret feed link shows them in the phone's calendar; a customer gets a confirmation only
-- when Daniel ticks it; a callback asked for on the phone lands at the named time when it lies in the
-- business hours, otherwise today without a time. | Input: Daniel's entries, the phone assistant's
-- wishes. | Output: crm.appointments, crm.create_appointment, crm.update_appointment,
-- crm.set_appointment_status, crm.remind_appointments (cron crm-appointments), crm.calendar_events,
-- crm.callback_from_call, mail text appointment, settings for business hours, reminder and feed token.
-- Re-runnable; crm.appointment_kind_label, crm.check_appointment and crm.today_overview are the versions
-- of 013_audit_anfragen.sql (video calls, today's appointments with kind and place), so running this
-- file again keeps the newer state.

-- Settings

alter table crm.settings add column if not exists business_hours_start time not null default '08:00';
alter table crm.settings add column if not exists business_hours_end time not null default '18:00';
-- ISO weekdays, 1 = Monday.
alter table crm.settings add column if not exists business_days smallint[] not null default '{1,2,3,4,5}';
alter table crm.settings add column if not exists reminder_minutes int not null default 60;
-- The secret part of the calendar feed link; a new value makes every old link useless.
alter table crm.settings add column if not exists calendar_token uuid not null default gen_random_uuid();
alter table crm.settings drop constraint if exists settings_business_hours_check;
alter table crm.settings add constraint settings_business_hours_check check (business_hours_start < business_hours_end);
alter table crm.settings drop constraint if exists settings_business_days_check;
alter table crm.settings add constraint settings_business_days_check
  check (cardinality(business_days) between 1 and 7 and business_days <@ '{1,2,3,4,5,6,7}');
alter table crm.settings drop constraint if exists settings_reminder_minutes_check;
alter table crm.settings add constraint settings_reminder_minutes_check check (reminder_minutes between 5 and 1440);

-- Appointments

create table if not exists crm.appointments (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('visit', 'callback', 'call', 'other')),
  title text not null check (length(btrim(title)) between 1 and 200),
  -- A callback without a time has only its day; then starts_at, ends_at and the reminder stay empty.
  starts_on date not null,
  starts_at timestamptz,
  ends_at timestamptz,
  -- Deleted with the customer: title and note name the person (crm.dismiss_customer).
  customer_id uuid references crm.customers (id) on delete cascade,
  location text not null default '' check (length(location) <= 300),
  note text not null default '' check (length(note) <= 2000),
  -- The line of a callback the phone assistant booked, so the call's record finds it.
  caller_number text,
  origin text not null default 'person' check (origin in ('person', 'phone', 'assistant')),
  status text not null default 'planned' check (status in ('planned', 'done', 'cancelled')),
  reminded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((starts_at is null) = (ends_at is null)),
  check (ends_at is null or ends_at > starts_at),
  check (starts_at is null or starts_on = (starts_at at time zone 'Europe/Berlin')::date)
);
create index if not exists appointments_day on crm.appointments (starts_on);
create index if not exists appointments_due on crm.appointments (starts_at) where status = 'planned' and reminded_at is null;
create or replace trigger appointments_touch before update on crm.appointments for each row execute function crm.touch_updated_at();

alter table crm.outbox add column if not exists appointment_id uuid references crm.appointments (id) on delete set null;

-- The kinds of mails, texts and approvals of migrations 009-013 (calendar, follow-ups, assistant,
-- audit requests), set once here so that running any of them again keeps all.
alter table crm.outbox drop constraint if exists outbox_kind_check;
alter table crm.outbox add constraint outbox_kind_check
  check (kind in ('contract', 'quote', 'invoice', 'dunning', 'review_request', 'review_reminder', 'appointment', 'follow_up', 'assistant',
                  'audit_proposal', 'appointment_cancel', 'appointment_reminder'));
alter table crm.mail_texts drop constraint if exists mail_texts_key_check;
alter table crm.mail_texts add constraint mail_texts_key_check
  check (key in ('quote', 'invoice', 'dunning_1', 'dunning_2', 'dunning_3', 'review_request', 'review_reminder', 'appointment',
                 'follow_up_1', 'follow_up_2', 'audit_confirmation', 'audit_rebooking', 'audit_cancellation', 'audit_proposal',
                 'appointment_reminder'));
alter table crm.approvals drop constraint if exists approvals_kind_check;
alter table crm.approvals add constraint approvals_kind_check
  check (kind in ('dunning', 'publication', 'quote', 'invoice', 'payment', 'contract', 'reversal', 'follow_up', 'assistant_mail', 'other'));
insert into crm.mail_texts (key, subject, body) values
('appointment', 'Terminbestätigung {{termin}}', '{{anrede}}

hiermit bestätige ich unseren Termin am {{termin}}.
Ort: {{ort}}

Den Termin finden Sie auch als Kalenderdatei im Anhang. Falls etwas dazwischenkommt, antworten Sie einfach auf diese E-Mail.

Mit freundlichen Grüßen
{{inhaber}}')
on conflict (key) do nothing;

-- Words

create or replace function crm.appointment_kind_label(p_kind text) returns text
language sql immutable as $$
  select case p_kind when 'visit' then 'Vor-Ort-Gespräch' when 'callback' then 'Rückruf' when 'call' then 'Telefonat'
                     when 'video' then 'Videogespräch' else 'Termin' end
$$;

create or replace function crm.weekday_de(p_day date) returns text
language sql immutable as $$
  select (array['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'])[extract(isodow from p_day)::int]
$$;

-- "Freitag, 31.10.2026, 10:00 Uhr", or the day alone when there is no time.
create or replace function crm.appointment_when(p_appointment crm.appointments) returns text
language sql stable as $$
  select crm.weekday_de(p_appointment.starts_on) || ', ' || crm.date_de(p_appointment.starts_on)
         || coalesce(', ' || to_char(p_appointment.starts_at at time zone 'Europe/Berlin', 'HH24:MI') || ' Uhr', '')
$$;

-- Within the business days and hours of the settings, judged in Berlin time.
create or replace function crm.in_business_hours(p_at timestamptz, p_minutes int default 0) returns boolean
language sql stable as $$
  select extract(isodow from (p_at at time zone 'Europe/Berlin'))::smallint = any (s.business_days)
     and (p_at at time zone 'Europe/Berlin')::time >= s.business_hours_start
     and ((p_at + make_interval(mins => p_minutes)) at time zone 'Europe/Berlin')::time <= s.business_hours_end
     and (p_at at time zone 'Europe/Berlin')::date = ((p_at + make_interval(mins => p_minutes)) at time zone 'Europe/Berlin')::date
    from crm.settings s where s.id = 1
$$;

-- Booking

-- Refuses what no appointment may be; answers the customer's name, null without a customer.
create or replace function crm.check_appointment(p_kind text, p_starts_at timestamptz, p_starts_on date, p_duration int,
  p_customer uuid) returns text
language plpgsql stable as $$
declare v_name text;
begin
  if p_kind is null or p_kind not in ('visit', 'callback', 'call', 'video', 'other') then
    raise exception 'Unbekannte Art des Termins.';
  end if;
  if p_starts_at is null and p_starts_on is null then raise exception 'Bitte einen Tag angeben.'; end if;
  if p_starts_at is not null and coalesce(p_duration, 0) not between 5 and 720 then
    raise exception 'Die Dauer muss zwischen 5 Minuten und 12 Stunden liegen.';
  end if;
  if p_customer is not null then
    select name into v_name from crm.customers where id = p_customer;
    if v_name is null then raise exception 'Diesen Kunden gibt es nicht.'; end if;
  end if;
  return v_name;
end $$;

create or replace function crm.book_appointment(p_kind text, p_title text, p_starts_at timestamptz, p_starts_on date,
  p_duration int, p_customer uuid, p_location text, p_note text, p_origin text) returns crm.appointments
language plpgsql as $$
declare v_row crm.appointments; v_name text;
begin
  perform crm.require_writer();
  v_name := crm.check_appointment(p_kind, p_starts_at, p_starts_on, p_duration, p_customer);
  insert into crm.appointments (kind, title, starts_on, starts_at, ends_at, customer_id, location, note, origin)
  values (p_kind,
          left(coalesce(nullif(btrim(p_title), ''), crm.appointment_kind_label(p_kind) || coalesce(' ' || v_name, '')), 200),
          coalesce((p_starts_at at time zone 'Europe/Berlin')::date, p_starts_on), p_starts_at,
          p_starts_at + make_interval(mins => p_duration), p_customer,
          left(btrim(coalesce(p_location, '')), 300), left(btrim(coalesce(p_note, '')), 2000), p_origin)
  returning * into v_row;
  if p_customer is not null then
    perform crm.log(p_customer, 'Termin eingetragen: ' || v_row.title || ', ' || crm.appointment_when(v_row) || '.', 'meeting');
  end if;
  return v_row;
end $$;

create or replace function crm.confirm_appointment(p_appointment uuid) returns crm.outbox
language plpgsql as $$
declare v_row crm.appointments; v_mail crm.outbox;
begin
  perform crm.require_writer();
  select * into v_row from crm.appointments where id = p_appointment;
  if v_row.customer_id is null then raise exception 'Eine Bestätigung geht nicht ohne Kunde.'; end if;
  if v_row.starts_at is null then raise exception 'Eine Bestätigung braucht eine Uhrzeit.'; end if;
  v_mail := crm.queue_mail('appointment', v_row.customer_id, 'appointment',
    crm.base_values(v_row.customer_id, '', v_row.title)
      || jsonb_build_object('termin', crm.appointment_when(v_row), 'ort', coalesce(nullif(v_row.location, ''), 'nach Absprache')));
  update crm.outbox set appointment_id = v_row.id where id = v_mail.id returning * into v_mail;
  return v_mail;
end $$;

-- From the calendar page.
create or replace function crm.create_appointment(p_kind text, p_title text, p_starts_at timestamptz, p_duration int,
  p_customer uuid, p_location text, p_note text, p_confirm boolean default false, p_starts_on date default null)
returns crm.appointments
language plpgsql as $$
declare v_row crm.appointments;
begin
  perform crm.require_writer();
  v_row := crm.book_appointment(p_kind, p_title, p_starts_at, p_starts_on, p_duration, p_customer, p_location, p_note, 'person');
  if coalesce(p_confirm, false) then perform crm.confirm_appointment(v_row.id); end if;
  return v_row;
end $$;

-- Moving an appointment makes its reminder due again.
create or replace function crm.update_appointment(p_appointment uuid, p_kind text, p_title text, p_starts_at timestamptz,
  p_duration int, p_customer uuid, p_location text, p_note text, p_starts_on date default null) returns crm.appointments
language plpgsql as $$
declare v_old crm.appointments; v_row crm.appointments;
begin
  perform crm.require_writer();
  select * into v_old from crm.appointments where id = p_appointment for update;
  if v_old.id is null then raise exception 'Diesen Termin gibt es nicht.'; end if;
  perform crm.check_appointment(p_kind, p_starts_at, p_starts_on, p_duration, p_customer);
  update crm.appointments set kind = p_kind,
    title = left(coalesce(nullif(btrim(p_title), ''), v_old.title), 200),
    starts_on = coalesce((p_starts_at at time zone 'Europe/Berlin')::date, p_starts_on), starts_at = p_starts_at,
    ends_at = p_starts_at + make_interval(mins => p_duration), customer_id = p_customer,
    location = left(btrim(coalesce(p_location, '')), 300), note = left(btrim(coalesce(p_note, '')), 2000),
    reminded_at = case when p_starts_at is distinct from v_old.starts_at then null else reminded_at end
   where id = p_appointment returning * into v_row;
  return v_row;
end $$;

create or replace function crm.set_appointment_status(p_appointment uuid, p_status text) returns crm.appointments
language plpgsql as $$
declare v_row crm.appointments;
begin
  perform crm.require_writer();
  if p_status is null or p_status not in ('planned', 'done', 'cancelled') then raise exception 'Unbekannter Status.'; end if;
  update crm.appointments set status = p_status where id = p_appointment returning * into v_row;
  if v_row.id is null then raise exception 'Diesen Termin gibt es nicht.'; end if;
  if p_status = 'cancelled' and v_row.customer_id is not null then
    perform crm.log(v_row.customer_id, 'Termin abgesagt: ' || v_row.title || ', ' || crm.appointment_when(v_row) || '.', 'meeting');
  end if;
  return v_row;
end $$;

-- Every 5 minutes: a push for each planned appointment that starts within the reminder time.
create or replace function crm.remind_appointments() returns int
language plpgsql as $$
declare v_row crm.appointments; v_minutes int; v_count int := 0; v_customer text;
begin
  perform crm.require_writer();
  select reminder_minutes into v_minutes from crm.settings where id = 1;
  for v_row in
    select * from crm.appointments
     where status = 'planned' and reminded_at is null and starts_at > now()
       and starts_at <= now() + make_interval(mins => v_minutes)
     order by starts_at for update skip locked
  loop
    select name into v_customer from crm.customers where id = v_row.customer_id;
    perform crm.notify_cockpit('termin',
      'Termin um ' || to_char(v_row.starts_at at time zone 'Europe/Berlin', 'HH24:MI') || ': ' || v_row.title,
      concat_ws(' · ', crm.appointment_kind_label(v_row.kind), v_customer, nullif(v_row.location, ''), nullif(v_row.note, '')),
      'https://crm.speedofthespirit.dev/kalender', 'wichtig', 'termin-' || v_row.id || '-' || extract(epoch from v_row.starts_at)::bigint);
    update crm.appointments set reminded_at = now() where id = v_row.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- What the calendar feed shows: planned and done appointments from 90 days back to a year ahead.
create or replace function crm.calendar_events(p_token uuid) returns table (
  id uuid, kind text, title text, starts_on date, starts_at timestamptz, ends_at timestamptz, location text, note text,
  customer_name text, status text, updated_at timestamptz)
language sql stable as $$
  select a.id, a.kind, a.title, a.starts_on, a.starts_at, a.ends_at, a.location, a.note, c.name, a.status, a.updated_at
    from crm.appointments a left join crm.customers c on c.id = a.customer_id
   where exists (select 1 from crm.settings s where s.id = 1 and s.calendar_token = p_token)
     and a.status <> 'cancelled' and a.starts_on between current_date - 90 and current_date + 366
   order by a.starts_on, a.starts_at nulls first
$$;

-- The phone assistant: a callback at the named time when it is ahead, within 60 days and inside the
-- business hours; otherwise today without a time, with the wish in the note. Daniel gets a notice.
create or replace function crm.callback_from_call(p_caller_number text, p_name text, p_reason text, p_wished_at timestamptz)
returns uuid
language plpgsql as $$
declare
  v_caller text := nullif(btrim(coalesce(p_caller_number, '')), '');
  v_customer uuid := crm.customer_by_phone(v_caller);
  v_who text;
  v_fits boolean;
  v_note text;
  v_row crm.appointments;
begin
  perform crm.require_writer();
  v_who := coalesce(nullif(btrim(p_name), ''), (select name from crm.customers where id = v_customer), v_caller, 'Anrufer ohne Rufnummer');
  v_fits := p_wished_at is not null and p_wished_at > now() and p_wished_at < now() + interval '60 days'
            and crm.in_business_hours(p_wished_at, 15);
  v_note := concat_ws(' · ', nullif(left(btrim(coalesce(p_reason, '')), 500), ''), 'Rufnummer ' || coalesce(v_caller, 'unbekannt'));
  if p_wished_at is not null and not v_fits then
    v_note := v_note || ' · Gewünschte Zeit '
      || case when p_wished_at <= now() then 'lag in der Vergangenheit'
              when p_wished_at >= now() + interval '60 days' then 'lag mehr als 60 Tage voraus'
              else 'lag außerhalb der Geschäftszeiten' end || ': '
      || crm.weekday_de((p_wished_at at time zone 'Europe/Berlin')::date) || ', '
      || to_char(p_wished_at at time zone 'Europe/Berlin', 'DD.MM.YYYY, HH24:MI') || ' Uhr';
  end if;
  v_row := crm.book_appointment('callback', 'Rückruf ' || v_who,
    case when v_fits then p_wished_at end, (now() at time zone 'Europe/Berlin')::date, 15, v_customer, '', v_note, 'phone');
  update crm.appointments set caller_number = v_caller where id = v_row.id;
  -- The appointment replaces the callback task the same call filed (crm.intake_call).
  delete from crm.tasks where customer_id = v_customer and origin = 'agent' and not done and title like 'Rückruf %'
     and created_at > now() - interval '30 minutes';
  perform crm.notify_cockpit('termin', 'Rückruf gewünscht: ' || v_who,
    crm.appointment_when(v_row) || ' · ' || v_note, 'https://crm.speedofthespirit.dev/kalender', 'wichtig', 'rueckruf-' || v_row.id);
  return v_row.id;
end $$;

-- Overview: today's appointments for the start page and the morning brief.
create or replace function crm.today_overview() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'new_inquiries', (select count(*) from crm.inquiries where status = 'new'),
    'due_deals', (select count(*) from crm.deals where stage not in ('won', 'lost') and next_step_due <= current_date),
    'expiring_quotes', (select count(*) from crm.quotes where status = 'sent' and valid_until <= current_date + 7),
    'open_orders', (select count(*) from crm.orders where status in ('open', 'in_progress')),
    'draft_invoices', (select count(*) from crm.invoices where status = 'draft'),
    'overdue_invoices', (select count(*) from crm.invoices where status = 'open' and cancels_invoice_id is null and due_date < current_date),
    'pending_approvals', (select count(*) from crm.approvals where status = 'pending'),
    'open_tickets', (select count(*) from crm.tickets where status <> 'solved'),
    'tasks_due', (select count(*) from crm.tasks where not done and due_date <= current_date),
    'receivables', (select coalesce(sum(gross - paid_amount), 0) from crm.invoices where status = 'open' and cancels_invoice_id is null),
    'paid_this_month', (select coalesce(sum(amount), 0) from crm.payments where date_trunc('month', paid_on) = date_trunc('month', current_date)),
    'open_quotes_value', (select coalesce(sum(net), 0) from crm.quotes where status = 'sent'),
    'pipeline_value', (select coalesce(sum(value_net), 0) from crm.deals where stage not in ('won', 'lost')),
    'unknown_senders', (select count(*) from crm.mail_review where status = 'open' and verdict <> 'automated'),
    'failed_mails', (select count(*) from crm.outbox where status = 'failed'),
    'mailbox_stale', (select exists (select 1 from crm.mail_sync where last_error <> '' or synced_at < now() - interval '1 hour')),
    'due_audits', (select count(*) from crm.audit_runs where status = 'due'),
    'mail_triage_waiting', (select count(*) from crm.mail_triage where status in ('queued', 'claimed')),
    'mail_triage_failed', (select count(*) from crm.mail_triage where status = 'failed'),
    'appointments_today', (select count(*) from crm.appointments
                            where status = 'planned' and starts_on = (now() at time zone 'Europe/Berlin')::date),
    'appointments_today_list', (select coalesce(jsonb_agg(coalesce(to_char(starts_at at time zone 'Europe/Berlin', 'HH24:MI') || ' ', '') || title
                                                     order by starts_at nulls first), '[]')
                                  from crm.appointments
                                 where status = 'planned' and starts_on = (now() at time zone 'Europe/Berlin')::date),
    'appointments_today_items', (select coalesce(jsonb_agg(jsonb_build_object(
                                          'clock', to_char(starts_at at time zone 'Europe/Berlin', 'HH24:MI'), 'title', title,
                                          'kind', kind, 'location', location) order by starts_at nulls first), '[]')
                                   from crm.appointments
                                  where status = 'planned' and starts_on = (now() at time zone 'Europe/Berlin')::date)
  )
$$;

-- Rights

alter table crm.appointments enable row level security;
-- Created once; a re-run keeps it (the rule never changes).
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'crm' and tablename = 'appointments' and policyname = 'admin_all') then
    create policy admin_all on crm.appointments for all to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
end $$;
grant select, insert, update, delete on crm.appointments to authenticated, service_role;

revoke all on function crm.appointment_kind_label(text), crm.weekday_de(date), crm.appointment_when(crm.appointments),
  crm.in_business_hours(timestamptz, int), crm.check_appointment(text, timestamptz, date, int, uuid),
  crm.book_appointment(text, text, timestamptz, date, int, uuid, text, text, text), crm.confirm_appointment(uuid),
  crm.create_appointment(text, text, timestamptz, int, uuid, text, text, boolean, date),
  crm.update_appointment(uuid, text, text, timestamptz, int, uuid, text, text, date), crm.set_appointment_status(uuid, text),
  crm.remind_appointments(), crm.calendar_events(uuid), crm.callback_from_call(text, text, text, timestamptz)
  from public, anon;
grant execute on function crm.appointment_kind_label(text), crm.weekday_de(date), crm.appointment_when(crm.appointments),
  crm.in_business_hours(timestamptz, int), crm.check_appointment(text, timestamptz, date, int, uuid),
  crm.book_appointment(text, text, timestamptz, date, int, uuid, text, text, text), crm.confirm_appointment(uuid),
  crm.create_appointment(text, text, timestamptz, int, uuid, text, text, boolean, date),
  crm.update_appointment(uuid, text, text, timestamptz, int, uuid, text, text, date), crm.set_appointment_status(uuid, text)
  to authenticated, service_role;
revoke all on function crm.remind_appointments(), crm.calendar_events(uuid), crm.callback_from_call(text, text, text, timestamptz)
  from authenticated;
grant execute on function crm.remind_appointments(), crm.calendar_events(uuid), crm.callback_from_call(text, text, text, timestamptz)
  to service_role;

select cron.schedule('crm-appointments', '*/5 * * * *', $job$ select crm.remind_appointments(); $job$);

-- Every function of this migration gets the fixed search path of 008.
do $$
declare v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure from pg_proc p
     where p.pronamespace = 'crm'::regnamespace and p.prokind = 'f'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public, extensions', v_function);
  end loop;
end $$;

notify pgrst, 'reload schema';
