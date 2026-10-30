-- RepoCity CRM, "Audit anfragen": a business asks for an audit appointment, Daniel decides in the Cockpit.
-- Context: builds on 001-012; decided with Daniel on 30.10.2026 (Nova point 6): the form on the website
-- offers only free hours of Daniel's calendar (one hour each, no buffer, inside the business hours, from
-- tomorrow for 21 days) and asks for business, contact person, e-mail, phone, kind of meeting (on site,
-- phone or video, an address for on site) and the wished hour, website and message optional. The request
-- lands in the CRM with channel and campaign; the business hears nothing until Daniel taps "Bestätigen"
-- (the wished hour is booked and confirmed with the calendar file; a video call gets its own Jitsi link),
-- "Anderen Termin vorschlagen" (the next three free hours, mailed after "Senden"; a click on a link books
-- at once) or "Prüfen" (the RadarAuditor audits the website). Proposed hours stay reserved for that
-- business for 48 hours (decided with Daniel on 30.10.2026 after the review). Every confirmation
-- carries the link "Anderen Termin wünschen"; the old appointment stays until a new one is booked, then
-- the customer gets the change and a cancellation of the old one as calendar file. A request without a
-- decision for 24 hours is pushed once more; customers get a reminder the day before a confirmed
-- appointment. | Input: the website form, Daniel's taps, the customer's clicks on the page /termin/.
-- | Output: crm.audit_requests, crm.audit_offers, crm.audit_slots and crm.request_audit (open to
-- anon), crm.open_audit_requests, the actions behind the buttons, the functions of the Edge Function
-- crm-termin, crm.remind_audit_requests (cron crm-audit-requests), crm.send_appointment_reminders (cron
-- crm-appointment-reminders), appointment kind video, mail texts audit_confirmation, audit_rebooking,
-- audit_cancellation, audit_proposal and appointment_reminder, outbox kinds audit_proposal,
-- appointment_cancel and appointment_reminder. Re-runnable; 009 and cockpit 002 carry the same newest
-- versions of what this file replaces from them.

-- Appointments: video calls, and when the customer got the reminder of the day before.

alter table crm.appointments drop constraint if exists appointments_kind_check;
alter table crm.appointments add constraint appointments_kind_check check (kind in ('visit', 'callback', 'call', 'video', 'other'));
alter table crm.appointments add column if not exists customer_reminded_at timestamptz;

-- Mails and their texts; 009 names the same full lists, so running it again keeps these kinds.
alter table crm.outbox drop constraint if exists outbox_kind_check;
alter table crm.outbox add constraint outbox_kind_check
  check (kind in ('contract', 'quote', 'invoice', 'dunning', 'review_request', 'review_reminder', 'appointment', 'follow_up', 'assistant',
                  'audit_proposal', 'appointment_cancel', 'appointment_reminder'));
alter table crm.mail_texts drop constraint if exists mail_texts_key_check;
alter table crm.mail_texts add constraint mail_texts_key_check
  check (key in ('quote', 'invoice', 'dunning_1', 'dunning_2', 'dunning_3', 'review_request', 'review_reminder', 'appointment',
                 'follow_up_1', 'follow_up_2', 'audit_confirmation', 'audit_rebooking', 'audit_cancellation', 'audit_proposal',
                 'appointment_reminder'));

insert into crm.mail_texts (key, subject, body) values
('audit_confirmation', 'Terminbestätigung {{termin}}', '{{anrede}}

vielen Dank für Ihre Anfrage. Hiermit bestätige ich unseren Termin am {{termin}} ({{art}}, eine Stunde).
{{treffpunkt}}

Den Termin finden Sie auch als Kalenderdatei im Anhang. Passt die Zeit doch nicht, wählen Sie hier einen anderen Termin: {{umbuchungslink}}

Mit freundlichen Grüßen
{{inhaber}}'),
('audit_rebooking', 'Terminänderung: neuer Termin {{termin}}', '{{anrede}}

wie gewünscht haben wir einen neuen Termin: {{termin}} ({{art}}, eine Stunde).
{{treffpunkt}}

Ihr bisheriger Termin am {{alter_termin}} entfällt. Dafür bekommen Sie eine eigene E-Mail mit der Absage als Kalenderdatei, damit er auch aus Ihrem Kalender verschwindet.

Den neuen Termin finden Sie als Kalenderdatei im Anhang. Passt auch diese Zeit nicht, wählen Sie hier einen anderen Termin: {{umbuchungslink}}

Mit freundlichen Grüßen
{{inhaber}}'),
('audit_cancellation', 'Absage: Termin {{termin}}', '{{anrede}}

der Termin am {{termin}} entfällt, weil wir einen neuen Termin vereinbart haben; dazu bekommen Sie eine eigene E-Mail.

Im Anhang finden Sie die Absage als Kalenderdatei. Öffnen Sie sie, verschwindet der alte Termin aus Ihrem Kalender.

Mit freundlichen Grüßen
{{inhaber}}'),
('audit_proposal', 'Terminvorschläge zu Ihrer Anfrage', '{{anrede}}

vielen Dank für Ihre Anfrage. Für unser Gespräch ({{art}}, eine Stunde) schlage ich Ihnen diese Termine vor:

{{vorschlaege}}

Ein Klick auf einen Link öffnet eine Seite, auf der Sie den Termin mit einem Knopf buchen. Danach bekommen Sie die Bestätigung mit Kalenderdatei.

Mit freundlichen Grüßen
{{inhaber}}'),
('appointment_reminder', 'Erinnerung an unseren Termin morgen, {{termin}}', '{{anrede}}

ich freue mich auf {{gespraech}} morgen, {{termin}}.
{{treffpunkt}}

Falls etwas dazwischenkommt, antworten Sie einfach auf diese E-Mail.

Mit freundlichen Grüßen
{{inhaber}}')
on conflict (key) do nothing;

-- Tables

create table if not exists crm.audit_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references crm.customers (id) on delete cascade,
  inquiry_id uuid references crm.inquiries (id) on delete set null,
  company text not null check (length(btrim(company)) between 1 and 200),
  contact text not null check (length(btrim(contact)) between 1 and 200),
  email text not null check (length(email) between 3 and 200),
  phone text not null check (length(btrim(phone)) between 1 and 40),
  website text not null default '' check (length(website) <= 300),
  address text not null default '' check (length(address) <= 300),
  kind text not null check (kind in ('visit', 'call', 'video')),
  wished_at timestamptz not null,
  message text not null default '' check (length(message) <= 5000),
  -- open: waits for Daniel; proposed: times mailed, waits for the customer; booked: appointment confirmed.
  status text not null default 'open' check (status in ('open', 'proposed', 'booked')),
  appointment_id uuid references crm.appointments (id) on delete set null,
  -- The secret part of the link "Anderen Termin wünschen" in every confirmation.
  reschedule_token uuid not null default gen_random_uuid(),
  audit_id uuid references public.audits (id) on delete set null,
  -- Sent by the form with each submission; a repeated submission with the same key stores nothing new.
  request_key uuid,
  -- Since when the current question waits for Daniel (the request, or the customer's wish for another time).
  asked_at timestamptz not null default now(),
  owner_reminded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'visit' or btrim(address) <> '')
);
alter table crm.audit_requests add column if not exists request_key uuid;
create unique index if not exists audit_requests_reschedule_token on crm.audit_requests (reschedule_token);
create unique index if not exists audit_requests_request_key on crm.audit_requests (request_key) where request_key is not null;
create index if not exists audit_requests_customer on crm.audit_requests (customer_id, created_at desc);
create index if not exists audit_requests_waiting on crm.audit_requests (asked_at) where status = 'open';
create index if not exists audit_requests_appointment on crm.audit_requests (appointment_id) where appointment_id is not null;
create or replace trigger audit_requests_touch before update on crm.audit_requests for each row execute function crm.touch_updated_at();

-- The hours "Anderen Termin vorschlagen" found: draft until "Senden", then sent with one link each.
-- A draft or sent hour stays reserved for its business for 48 hours (crm.audit_reserved).
create table if not exists crm.audit_offers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references crm.audit_requests (id) on delete cascade,
  batch uuid not null,
  starts_at timestamptz not null,
  token uuid not null default gen_random_uuid(),
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (batch, starts_at)
);
-- The appointment this hour became; a link shows "gebucht" only while the request still points to it.
alter table crm.audit_offers add column if not exists appointment_id uuid references crm.appointments (id) on delete set null;
alter table crm.audit_offers drop constraint if exists audit_offers_status_check;
alter table crm.audit_offers add constraint audit_offers_status_check
  check (status in ('draft', 'sent', 'booked', 'taken', 'expired', 'void'));
create unique index if not exists audit_offers_token on crm.audit_offers (token);
create index if not exists audit_offers_request on crm.audit_offers (request_id, status);
create index if not exists audit_offers_reserved on crm.audit_offers (starts_at) where status in ('draft', 'sent');

-- Words

create or replace function crm.appointment_kind_label(p_kind text) returns text
language sql immutable as $$
  select case p_kind when 'visit' then 'Vor-Ort-Gespräch' when 'callback' then 'Rückruf' when 'call' then 'Telefonat'
                     when 'video' then 'Videogespräch' else 'Termin' end
$$;

-- The meeting as the object of "ich freue mich auf …" in the reminder.
create or replace function crm.appointment_talk(p_kind text) returns text
language sql immutable as $$
  select case p_kind when 'visit' then 'unser Gespräch vor Ort' when 'call' then 'unser Telefonat' when 'callback' then 'unser Telefonat'
                     when 'video' then 'unser Videogespräch' else 'unseren Termin' end
$$;

-- "Dienstag, 03.11.2026, 10:00 Uhr" for an instant, in Berlin time.
create or replace function crm.berlin_when(p_at timestamptz) returns text
language sql stable as $$
  select crm.weekday_de((p_at at time zone 'Europe/Berlin')::date) || ', ' || crm.date_de((p_at at time zone 'Europe/Berlin')::date)
         || ', ' || to_char(p_at at time zone 'Europe/Berlin', 'HH24:MI') || ' Uhr'
$$;

-- Where or how the meeting takes place, as one sentence for the customer's mails.
create or replace function crm.appointment_place(p_kind text, p_location text) returns text
language sql immutable as $$
  select case
    when p_kind = 'video' and p_location like 'https://meet.jit.si/%' then
      'Wir sprechen per Video. Öffnen Sie zum Termin einfach diesen Link im Browser, eine Anmeldung ist nicht nötig: ' || p_location
    when p_kind in ('call', 'callback') and p_location ~ '^\+?[0-9 ()/.-]{6,}$' then 'Ich rufe Sie zum Termin unter ' || p_location || ' an.'
    else 'Ort: ' || coalesce(nullif(btrim(p_location), ''), 'nach Absprache') end
$$;

-- The town of "Ludgeristraße 1, 48143 Münster"; empty without a postal code.
create or replace function crm.city_from_address(p_address text) returns text
language sql immutable as $$
  select coalesce(btrim((regexp_match(coalesce(p_address, ''), '\m\d{5}\s+([^,\n]+)'))[1]), '')
$$;

-- Booking rules

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

-- The first version took no request; nothing outside this file calls it.
drop function if exists crm.audit_slot_free(timestamptz);
drop function if exists crm.audit_slot_open(timestamptz);

-- An hour proposed to another business within the last 48 hours, drafted or sent, and not yet decided.
create or replace function crm.audit_reserved(p_at timestamptz, p_request uuid) returns boolean
language sql stable as $$
  select exists (
    select 1 from crm.audit_offers o
     where o.status in ('draft', 'sent') and coalesce(o.sent_at, o.created_at) > now() - interval '48 hours'
       and o.request_id is distinct from p_request
       and o.starts_at < p_at + interval '1 hour' and o.starts_at + interval '1 hour' > p_at)
$$;

-- Free for the request (null: for anyone): no appointment that is not cancelled overlaps the hour from
-- p_at, and it is not reserved for another business.
create or replace function crm.audit_slot_free(p_at timestamptz, p_request uuid) returns boolean
language sql stable as $$
  select not exists (
    select 1 from crm.appointments a
     where a.status <> 'cancelled' and a.starts_at is not null
       and a.starts_on between (p_at at time zone 'Europe/Berlin')::date - 1 and (p_at at time zone 'Europe/Berlin')::date + 1
       and a.starts_at < p_at + interval '1 hour' and a.ends_at > p_at)
     and not crm.audit_reserved(p_at, p_request)
$$;

-- Bookable now for the request: ahead, inside the business hours and free.
create or replace function crm.audit_slot_open(p_at timestamptz, p_request uuid) returns boolean
language sql stable as $$
  select p_at > now() and coalesce(crm.in_business_hours(p_at, 60), false) and crm.audit_slot_free(p_at, p_request)
$$;

create or replace function crm.check_audit_kind(p_kind text) returns void
language plpgsql immutable as $$
begin
  if p_kind is null or p_kind not in ('visit', 'call', 'video') then
    raise exception 'Bitte wählen Sie, wie das Gespräch stattfinden soll: vor Ort, am Telefon oder per Video.';
  end if;
end $$;

-- Free hour starts for the request from tomorrow 0:00 in Berlin for 21 days. 504 = 21 days of 24 hours,
-- more than any setting of business days and hours can give.
create or replace function crm.audit_free_hours(p_kind text, p_request uuid) returns table (starts_at timestamptz)
language plpgsql stable as $$
declare v_first date := (now() at time zone 'Europe/Berlin')::date + 1;
begin
  perform crm.check_audit_kind(p_kind);
  return query
  select slot.at
    from crm.settings s
   cross join generate_series(v_first, v_first + 20, interval '1 day') as d(day)
   cross join lateral generate_series(
       (d.day::date + s.business_hours_start) at time zone 'Europe/Berlin',
       ((d.day::date + s.business_hours_end) at time zone 'Europe/Berlin') - interval '1 hour',
       interval '1 hour') as slot(at)
   where s.id = 1 and extract(isodow from d.day)::smallint = any (s.business_days)
     and crm.in_business_hours(slot.at, 60) and crm.audit_slot_free(slot.at, p_request)
   order by slot.at
   limit 504;
end $$;

-- The form: the free hours for anyone, nothing about other appointments.
create or replace function crm.audit_slots(p_kind text) returns table (starts_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select f.starts_at from crm.audit_free_hours(p_kind, null) f
$$;

-- The Cockpit

-- The buttons that still make sense for a request; "Prüfen" stays until the audit was started.
create or replace function crm.audit_buttons(p_request uuid) returns jsonb
language sql stable as $$
  with r as (
    select q.*, exists (select 1 from crm.audit_offers o where o.request_id = q.id and o.status = 'draft') as has_draft
      from crm.audit_requests q where q.id = p_request
  )
  select coalesce(jsonb_agg(b.button order by b.position), '[]'::jsonb) from (
    select 1 as position, '{"action": "audit_send", "title": "Senden"}'::jsonb as button from r where r.status = 'open' and r.has_draft
    union all
    select 2, '{"action": "audit_confirm", "title": "Bestätigen"}' from r
     where r.status = 'open' and not r.has_draft and r.appointment_id is null and crm.audit_slot_open(r.wished_at, r.id)
    union all
    select 3, '{"action": "audit_propose", "title": "Anderen Termin vorschlagen"}' from r where r.status = 'open' and not r.has_draft
    union all
    select 4, '{"action": "audit_check", "title": "Prüfen"}' from r where r.website <> '' and r.audit_id is null
  ) b
$$;

create or replace function crm.audit_payload(p_request uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object('request_id', p_request, 'batch',
    (select o.batch from crm.audit_offers o where o.request_id = p_request and o.status = 'draft' limit 1))
$$;

-- A notice about a request with the buttons that fit now; p_always false skips it when none fits. A
-- tap on a notice with buttons opens the Cockpit's message centre, where all of them stand; one without
-- opens the customer in the CRM.
create or replace function crm.audit_notice(p_request uuid, p_kind text, p_title text, p_detail text, p_priority text,
  p_dedupe text, p_always boolean default true) returns void
language plpgsql as $$
declare v_row crm.audit_requests; v_buttons jsonb := crm.audit_buttons(p_request);
begin
  select * into v_row from crm.audit_requests where id = p_request;
  if not p_always and jsonb_array_length(v_buttons) = 0 then return; end if;
  perform crm.notify_cockpit(p_kind, left(p_title || v_row.company, 200),
    concat_ws(' · ', nullif(p_detail, ''), v_row.contact, crm.appointment_kind_label(v_row.kind), nullif(v_row.website, ''),
              case when v_row.kind = 'visit' then v_row.address else v_row.phone end, nullif(left(v_row.message, 200), '')),
    case when jsonb_array_length(v_buttons) > 0 then '/' else 'https://crm.speedofthespirit.dev/kunde/' || v_row.customer_id end,
    p_priority, p_dedupe, v_buttons, crm.audit_payload(p_request));
end $$;

-- Website form

-- The first version had no request key; it was never live.
drop function if exists crm.request_audit(text, text, text, text, text, text, text, timestamptz, text, text, text, text);

-- The limits of the form, each refused with a sentence the customer understands (SQLSTATE P0001).
create or replace function crm.check_audit_fields(p_company text, p_contact text, p_email text, p_phone text, p_website text,
  p_address text, p_kind text, p_message text) returns void
language plpgsql immutable as $$
begin
  if length(p_company) < 2 then raise exception 'Bitte geben Sie den Namen Ihres Betriebs an (mindestens 2 Zeichen).'; end if;
  if length(p_company) > 200 then raise exception 'Der Name des Betriebs ist zu lang (höchstens 200 Zeichen).'; end if;
  if length(p_contact) < 2 then raise exception 'Bitte geben Sie den Namen Ihres Ansprechpartners an (mindestens 2 Zeichen).'; end if;
  if length(p_contact) > 200 then raise exception 'Der Name des Ansprechpartners ist zu lang (höchstens 200 Zeichen).'; end if;
  if length(p_email) > 200 then raise exception 'Die E-Mail-Adresse ist zu lang (höchstens 200 Zeichen).'; end if;
  if p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Bitte geben Sie eine gültige E-Mail-Adresse an, zum Beispiel name@betrieb.de.';
  end if;
  if p_phone !~ '^\+?[0-9 ()/.-]+$' or length(p_phone) > 40 or length(regexp_replace(p_phone, '\D', '', 'g')) not between 6 and 20 then
    raise exception 'Bitte geben Sie Ihre Telefonnummer an: 6 bis 20 Ziffern, dazu Leerzeichen, Klammern, Schrägstrich, Punkt, Bindestrich und ein + am Anfang.';
  end if;
  perform crm.check_audit_kind(p_kind);
  if p_kind = 'visit' and length(p_address) < 5 then
    raise exception 'Für ein Gespräch vor Ort brauchen wir Ihre Anschrift (Straße, Hausnummer, Postleitzahl und Ort).';
  end if;
  if length(p_address) > 300 then raise exception 'Die Anschrift ist zu lang (höchstens 300 Zeichen).'; end if;
  if p_website <> '' and (length(p_website) > 300 or p_website ~ '\s' or coalesce(public.website_host(p_website), '') !~ '^[^.]+(\.[^.]+)+$') then
    raise exception 'Bitte prüfen Sie die Adresse Ihrer Webseite, zum Beispiel beispiel.de (höchstens 300 Zeichen).';
  end if;
  if length(p_message) > 5000 then raise exception 'Ihre Nachricht ist zu lang (höchstens 5.000 Zeichen).'; end if;
end $$;

create or replace function crm.request_audit(p_company text, p_contact text, p_email text, p_phone text, p_website text,
  p_address text, p_kind text, p_starts_at timestamptz, p_message text, p_utm_source text, p_utm_medium text, p_utm_campaign text,
  p_request_key uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_company text := btrim(coalesce(p_company, ''));
  v_contact text := btrim(coalesce(p_contact, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_website text := btrim(coalesce(p_website, ''));
  v_address text := btrim(coalesce(p_address, ''));
  v_message text := btrim(coalesce(p_message, ''));
  v_inquiry uuid;
  v_customer uuid;
  v_request uuid;
begin
  -- A submission sent again, for example after a lost answer, is answered as the first one was.
  if p_request_key is not null then
    perform pg_advisory_xact_lock(hashtext('crm.request_audit:' || p_request_key));
    if exists (select 1 from crm.audit_requests where request_key = p_request_key) then
      return jsonb_build_object('ok', true);
    end if;
  end if;
  perform crm.check_audit_fields(v_company, v_contact, v_email, v_phone, v_website, v_address, p_kind, v_message);
  if length(coalesce(p_utm_source, '')) > 100 or length(coalesce(p_utm_medium, '')) > 100 or length(coalesce(p_utm_campaign, '')) > 100 then
    raise exception 'Die Angaben im Link sind zu lang.';
  end if;
  if p_starts_at is null then raise exception 'Bitte wählen Sie einen Wunschtermin.'; end if;
  if not exists (select 1 from crm.audit_free_hours(p_kind, null) s where s.starts_at = p_starts_at) then
    raise exception 'Dieser Termin ist leider nicht mehr frei. Bitte wählen Sie einen anderen.';
  end if;

  -- The intake of the contact form: one customer per address, channel and campaign of the link. The
  -- notice "Audit-Anfrage" below replaces the Cockpit's "Neuer Kunde" (cockpit.on_crm_customer).
  perform set_config('repocity.quiet_customer_notice', 'on', true);
  v_inquiry := crm.submit_inquiry(p_name => v_contact, p_email => v_email, p_phone => v_phone, p_company => v_company,
    p_message => left(concat_ws(E'\n', 'Gesprächsart: ' || crm.appointment_kind_label(p_kind), 'Wunschtermin: ' || crm.berlin_when(p_starts_at),
                                'Telefon: ' || v_phone, nullif('Webseite: ' || v_website, 'Webseite: '),
                                nullif('Anschrift: ' || v_address, 'Anschrift: '), nullif(E'\n' || v_message, E'\n')), 5000),
    p_source => 'Audit anfragen', p_utm_source => p_utm_source, p_utm_medium => p_utm_medium, p_utm_campaign => p_utm_campaign);
  perform set_config('repocity.quiet_customer_notice', '', true);
  select customer_id into v_customer from crm.inquiries where id = v_inquiry;
  -- The notice in the Cockpit takes the place of the task the form leaves.
  delete from crm.tasks where customer_id = v_customer and origin = 'system' and not done and created_at = now()
     and title like 'Anfrage von % beantworten';
  insert into crm.audit_requests (customer_id, inquiry_id, company, contact, email, phone, website, address, kind, wished_at, message,
                                  request_key)
  values (v_customer, v_inquiry, v_company, v_contact, v_email, v_phone, v_website, v_address, p_kind, p_starts_at, v_message,
          p_request_key)
  returning id into v_request;
  perform crm.audit_notice(v_request, 'audit-anfrage', 'Audit-Anfrage: ', 'Wunsch ' || crm.berlin_when(p_starts_at), 'wichtig',
    'audit-anfrage-' || v_request);
  return jsonb_build_object('ok', true);
end $$;

-- Booking

-- Books the hour and queues the confirmation with calendar file. An appointment it replaces is
-- cancelled: the confirmation names it (text audit_rebooking), and a mail of its own carries the
-- cancellation as calendar file (outbox kind appointment_cancel, METHOD:CANCEL with the same UID).
create or replace function crm.book_audit_appointment(p_request crm.audit_requests, p_at timestamptz) returns crm.appointments
language plpgsql as $$
declare v_location text; v_appointment crm.appointments; v_old crm.appointments; v_mail crm.outbox;
begin
  select * into v_old from crm.appointments where id = p_request.appointment_id and status = 'planned';
  v_location := case p_request.kind when 'visit' then p_request.address when 'call' then p_request.phone
    else 'https://meet.jit.si/RepoCity-' || replace(gen_random_uuid()::text, '-', '') end;
  v_appointment := crm.book_appointment(p_request.kind, crm.appointment_kind_label(p_request.kind) || ' ' || p_request.company, p_at,
    null, 60, p_request.customer_id, v_location,
    'Audit-Anfrage über die Webseite' || coalesce(': ' || nullif(p_request.message, ''), ''), 'person');
  if v_old.id is not null then
    v_old := crm.set_appointment_status(v_old.id, 'cancelled');
    v_mail := crm.queue_mail('appointment_cancel', p_request.customer_id, 'audit_cancellation',
      crm.base_values(p_request.customer_id, '', v_old.title) || jsonb_build_object('termin', crm.appointment_when(v_old)));
    update crm.outbox set appointment_id = v_old.id where id = v_mail.id;
  end if;
  v_mail := crm.queue_mail('appointment', p_request.customer_id, case when v_old.id is null then 'audit_confirmation' else 'audit_rebooking' end,
    crm.base_values(p_request.customer_id, '', v_appointment.title) || jsonb_build_object(
      'termin', crm.appointment_when(v_appointment), 'alter_termin', coalesce(crm.appointment_when(v_old), ''),
      'art', crm.appointment_kind_label(p_request.kind), 'ort', v_location,
      'treffpunkt', crm.appointment_place(p_request.kind, v_location),
      'umbuchungslink', crm.functions_url() || '/crm-termin?anders=' || p_request.reschedule_token));
  update crm.outbox set appointment_id = v_appointment.id where id = v_mail.id;
  -- Every earlier link of the request is done, also one that booked the appointment replaced now.
  update crm.audit_offers set status = 'void' where request_id = p_request.id and status in ('draft', 'sent', 'expired', 'booked');
  update crm.audit_requests set status = 'booked', appointment_id = v_appointment.id where id = p_request.id;
  update crm.inquiries set status = 'done' where id = p_request.inquiry_id and status in ('new', 'in_progress');
  return v_appointment;
end $$;

create or replace function crm.lock_audit_request(p_request uuid) returns crm.audit_requests
language plpgsql as $$
declare v_row crm.audit_requests;
begin
  -- One booking at a time, so two clicks never take the same hour.
  perform pg_advisory_xact_lock(hashtext('crm.audit_booking'));
  select * into v_row from crm.audit_requests where id = p_request for update;
  if v_row.id is null then raise exception 'Diese Anfrage gibt es nicht mehr.'; end if;
  return v_row;
end $$;

create or replace function crm.require_open_audit_request(p_row crm.audit_requests) returns void
language plpgsql as $$
begin
  if p_row.status = 'booked' then raise exception 'Für diese Anfrage ist schon ein Termin gebucht.'; end if;
  if p_row.status = 'proposed' then raise exception 'Die Vorschläge sind schon beim Kunden.'; end if;
end $$;

-- "Bestätigen"
create or replace function crm.confirm_audit_request(p_request uuid) returns text
language plpgsql as $$
declare v_row crm.audit_requests; v_appointment crm.appointments;
begin
  perform crm.require_writer();
  v_row := crm.lock_audit_request(p_request);
  perform crm.require_open_audit_request(v_row);
  if v_row.appointment_id is not null then
    raise exception 'Der Kunde möchte einen anderen Termin. Bitte „Anderen Termin vorschlagen“ nutzen.';
  end if;
  if not crm.audit_slot_open(v_row.wished_at, v_row.id) then
    raise exception 'Der Wunschtermin ist nicht mehr frei. Bitte „Anderen Termin vorschlagen“ nutzen.';
  end if;
  v_appointment := crm.book_audit_appointment(v_row, v_row.wished_at);
  perform crm.log(v_row.customer_id, 'Audit-Anfrage bestätigt: ' || crm.appointment_when(v_appointment) || '.');
  perform crm.audit_notice(p_request, 'audit-termin', 'Termin bestätigt: ', crm.appointment_when(v_appointment), 'info', null, false);
  return 'Termin bestätigt: ' || crm.appointment_when(v_appointment) || '. Die Bestätigung geht an ' || v_row.email || '.';
end $$;

-- "Anderen Termin vorschlagen": the next three hours free for this business, never the hour it wished
-- (Daniel chose not to confirm that one), wait for "Senden".
create or replace function crm.propose_audit_times(p_request uuid) returns text
language plpgsql as $$
declare v_row crm.audit_requests; v_batch uuid := gen_random_uuid(); v_times text;
begin
  perform crm.require_writer();
  v_row := crm.lock_audit_request(p_request);
  perform crm.require_open_audit_request(v_row);
  update crm.audit_offers set status = 'void' where request_id = p_request and status = 'draft';
  insert into crm.audit_offers (request_id, batch, starts_at)
  select p_request, v_batch, s.starts_at from crm.audit_free_hours(v_row.kind, p_request) s
   where s.starts_at <> v_row.wished_at order by s.starts_at limit 3;
  if not found then raise exception 'In den nächsten drei Wochen ist keine Stunde mehr frei.'; end if;
  select string_agg(crm.berlin_when(o.starts_at), '; ' order by o.starts_at) into v_times from crm.audit_offers o where o.batch = v_batch;
  perform crm.notify_cockpit('audit-vorschlag', left('Vorschlag für ' || v_row.company, 200), v_times, '/', 'wichtig',
    'audit-vorschlag-' || v_batch, crm.audit_buttons(p_request), crm.audit_payload(p_request));
  return 'Vorschläge: ' || v_times || '. Zum Verschicken auf „Senden“ tippen.';
end $$;

-- "Senden": the proposal mail with one link per hour; an hour taken meanwhile brings new proposals.
create or replace function crm.send_audit_proposal(p_request uuid, p_batch uuid) returns text
language plpgsql as $$
declare v_row crm.audit_requests; v_lines text; v_mail crm.outbox;
begin
  perform crm.require_writer();
  v_row := crm.lock_audit_request(p_request);
  perform crm.require_open_audit_request(v_row);
  if not exists (select 1 from crm.audit_offers where request_id = p_request and batch = p_batch and status = 'draft') then
    raise exception 'Dieser Vorschlag gilt nicht mehr.';
  end if;
  if exists (select 1 from crm.audit_offers where batch = p_batch and status = 'draft' and not crm.audit_slot_open(starts_at, p_request)) then
    perform crm.propose_audit_times(p_request);
    return 'Eine der Zeiten ist inzwischen belegt. Neue Vorschläge kommen gleich als Mitteilung.';
  end if;
  update crm.audit_offers set status = 'void' where request_id = p_request and status in ('sent', 'expired');
  update crm.audit_offers set status = 'sent', sent_at = now() where batch = p_batch and status = 'draft';
  select string_agg('- ' || crm.berlin_when(starts_at) || E':\n  ' || crm.functions_url() || '/crm-termin?buchen=' || token, E'\n'
                    order by starts_at)
    into v_lines from crm.audit_offers where batch = p_batch;
  v_mail := crm.queue_mail('audit_proposal', v_row.customer_id, 'audit_proposal',
    crm.base_values(v_row.customer_id, '', '') || jsonb_build_object('art', crm.appointment_kind_label(v_row.kind), 'vorschlaege', v_lines));
  update crm.audit_requests set status = 'proposed' where id = p_request;
  perform crm.log(v_row.customer_id, 'Terminvorschläge zur Audit-Anfrage verschickt.');
  perform crm.audit_notice(p_request, 'audit-vorschlag', 'Vorschläge verschickt: ', '', 'info', null, false);
  return 'Vorschläge an ' || v_mail.to_address || ' verschickt.';
end $$;

-- "Prüfen": the RadarAuditor audits the website, as a field audit started in its app would.
create or replace function crm.check_audit_website(p_request uuid) returns text
language plpgsql as $$
declare v_row crm.audit_requests; v_host text; v_audit uuid;
begin
  perform crm.require_writer();
  select * into v_row from crm.audit_requests where id = p_request for update;
  if v_row.id is null then raise exception 'Diese Anfrage gibt es nicht mehr.'; end if;
  if v_row.website = '' then raise exception 'Ohne Webseite gibt es nichts zu prüfen.'; end if;
  if v_row.audit_id is not null then raise exception 'Die Prüfung läuft schon.'; end if;
  v_host := public.website_host(v_row.website);
  -- A website the RadarAuditor knows keeps its name and town; giving new ones would count as a correction.
  if exists (select 1 from public.customers c where public.website_host(c.website) = v_host) then
    v_audit := public.start_field_audit(p_website => v_row.website);
  else
    v_audit := public.start_field_audit(p_website => v_row.website, p_name => v_row.company, p_city => crm.city_from_address(v_row.address));
  end if;
  update public.customers set crm_customer_id = v_row.customer_id
   where id = (select a.customer_id from public.audits a where a.id = v_audit) and crm_customer_id is null;
  update crm.audit_requests set audit_id = v_audit where id = p_request;
  perform crm.log(v_row.customer_id, 'Prüfung der Webseite ' || v_host || ' gestartet.');
  perform crm.audit_notice(p_request, 'audit-anfrage', 'Audit-Anfrage: ', 'Prüfung von ' || v_host || ' gestartet', 'info', null, false);
  return 'Prüfung von ' || v_host || ' gestartet.';
end $$;

-- The page /termin/ (Edge Function crm-termin)

-- What a proposal link is now: booked (only while the request still holds the appointment it became),
-- open (sent, reserved for 48 hours and ahead), expired (sent, the reservation ran out) or invalid.
create or replace function crm.audit_offer_state(p_offer crm.audit_offers, p_request crm.audit_requests) returns text
language sql stable as $$
  select case
    when p_offer.id is null or p_request.id is null then 'invalid'
    when p_offer.status = 'booked' then
      case when p_offer.appointment_id is not null and p_offer.appointment_id = p_request.appointment_id
                and exists (select 1 from crm.appointments a where a.id = p_offer.appointment_id and a.status = 'planned')
           then 'booked' else 'invalid' end
    when p_offer.status not in ('sent', 'expired') or p_request.status = 'booked' then 'invalid'
    when p_offer.status = 'expired' or p_offer.sent_at <= now() - interval '48 hours' or p_offer.starts_at <= now() then 'expired'
    else 'open' end
$$;

create or replace function crm.audit_offer_view(p_token uuid) returns jsonb
language plpgsql stable as $$
declare v_offer crm.audit_offers; v_row crm.audit_requests; v_state text;
begin
  perform crm.require_writer();
  select o.* into v_offer from crm.audit_offers o where o.token = p_token;
  select r.* into v_row from crm.audit_requests r where r.id = v_offer.request_id;
  v_state := crm.audit_offer_state(v_offer, v_row);
  if v_state = 'invalid' then return jsonb_build_object('state', 'invalid'); end if;
  return jsonb_build_object('state', v_state, 'starts_at', v_offer.starts_at, 'kind', v_row.kind);
end $$;

-- The button "Diesen Termin buchen": booked at once, since Daniel released the hours. After the 48 hours
-- of the reservation nothing is booked: the customer reads so, Daniel is asked as for a new request.
create or replace function crm.book_audit_offer(p_token uuid) returns jsonb
language plpgsql as $$
declare v_offer crm.audit_offers; v_row crm.audit_requests; v_appointment crm.appointments; v_state text;
begin
  perform crm.require_writer();
  select o.* into v_offer from crm.audit_offers o where o.token = p_token;
  if v_offer.id is null then return jsonb_build_object('result', 'invalid'); end if;
  v_row := crm.lock_audit_request(v_offer.request_id);
  select o.* into v_offer from crm.audit_offers o where o.id = v_offer.id for update;
  v_state := crm.audit_offer_state(v_offer, v_row);
  if v_state = 'booked' then return jsonb_build_object('result', 'booked', 'starts_at', v_offer.starts_at); end if;
  if v_state = 'invalid' then return jsonb_build_object('result', 'invalid'); end if;
  if v_state = 'expired' then
    if v_offer.status = 'sent' then
      update crm.audit_offers set status = 'expired' where id = v_offer.id;
      update crm.audit_requests set status = 'open', asked_at = now(), owner_reminded_at = null where id = v_row.id;
      perform crm.log(v_row.customer_id, 'Wollte den Termin ' || crm.berlin_when(v_offer.starts_at)
        || ' buchen; die Reservierung war abgelaufen.', 'system', 'Kunde');
      perform crm.audit_notice(v_row.id, 'audit-anfrage', 'Vorschlag abgelaufen: ',
        'Der Kunde wollte ' || crm.berlin_when(v_offer.starts_at) || ' buchen, die Reservierung war abgelaufen', 'wichtig',
        'audit-abgelaufen-' || v_offer.id);
    end if;
    return jsonb_build_object('result', 'expired');
  end if;
  if not crm.audit_slot_open(v_offer.starts_at, v_row.id) then
    update crm.audit_offers set status = 'taken' where id = v_offer.id;
    update crm.audit_requests set status = 'open', asked_at = now(), owner_reminded_at = null where id = v_row.id;
    perform crm.log(v_row.customer_id, 'Wollte den Termin ' || crm.berlin_when(v_offer.starts_at) || ' buchen; er war inzwischen belegt.',
      'system', 'Kunde');
    perform crm.audit_notice(v_row.id, 'audit-anfrage', 'Wunschzeit belegt: ',
      'Der Kunde wollte ' || crm.berlin_when(v_offer.starts_at) || ' buchen', 'wichtig', 'audit-belegt-' || v_offer.id);
    return jsonb_build_object('result', 'taken');
  end if;
  v_appointment := crm.book_audit_appointment(v_row, v_offer.starts_at);
  update crm.audit_offers set status = 'booked', appointment_id = v_appointment.id where id = v_offer.id;
  perform crm.log(v_row.customer_id, 'Termin über den Vorschlag gebucht: ' || crm.appointment_when(v_appointment) || '.', 'meeting', 'Kunde');
  perform crm.audit_notice(v_row.id, 'audit-termin', 'Termin gebucht: ', crm.appointment_when(v_appointment), 'wichtig',
    'audit-gebucht-' || v_offer.id);
  return jsonb_build_object('result', 'booked', 'starts_at', v_offer.starts_at);
end $$;

-- The link "Anderen Termin wünschen" works while the booked appointment lies ahead.
create or replace function crm.audit_reschedule_view(p_token uuid) returns jsonb
language plpgsql stable as $$
declare v_status text; v_starts timestamptz;
begin
  perform crm.require_writer();
  select r.status, a.starts_at into v_status, v_starts
    from crm.audit_requests r join crm.appointments a on a.id = r.appointment_id
   where r.reschedule_token = p_token and a.status = 'planned' and a.starts_at > now();
  if v_status is null then return jsonb_build_object('state', 'invalid'); end if;
  return jsonb_build_object('state', case when v_status = 'booked' then 'open' else 'requested' end, 'starts_at', v_starts);
end $$;

-- The button "Anderen Termin wünschen": Daniel is asked as for a new request, the appointment stays.
create or replace function crm.request_audit_reschedule(p_token uuid) returns jsonb
language plpgsql as $$
declare v_id uuid; v_row crm.audit_requests; v_starts timestamptz;
begin
  perform crm.require_writer();
  select r.id into v_id from crm.audit_requests r where r.reschedule_token = p_token;
  if v_id is null then return jsonb_build_object('result', 'invalid'); end if;
  v_row := crm.lock_audit_request(v_id);
  select a.starts_at into v_starts from crm.appointments a
   where a.id = v_row.appointment_id and a.status = 'planned' and a.starts_at > now();
  if v_starts is null then return jsonb_build_object('result', 'invalid'); end if;
  if v_row.status <> 'booked' then return jsonb_build_object('result', 'already'); end if;
  update crm.audit_requests set status = 'open', asked_at = now(), owner_reminded_at = null where id = v_id;
  perform crm.log(v_row.customer_id, 'Wünscht einen anderen Termin statt ' || crm.berlin_when(v_starts) || '.', 'system', 'Kunde');
  perform crm.audit_notice(v_id, 'audit-anfrage', 'Anderer Termin gewünscht: ', 'Bisher ' || crm.berlin_when(v_starts), 'wichtig',
    'audit-umbuchen-' || v_id || '-' || extract(epoch from now())::bigint);
  return jsonb_build_object('result', 'requested');
end $$;

-- Recurring runs

-- Hourly: a request waiting 24 hours for Daniel is pushed once more, with the same buttons.
create or replace function crm.remind_audit_requests() returns int
language plpgsql as $$
declare v_row crm.audit_requests; v_count int := 0;
begin
  perform crm.require_writer();
  for v_row in
    select * from crm.audit_requests
     where status = 'open' and owner_reminded_at is null and asked_at <= now() - interval '24 hours'
     order by asked_at for update skip locked
  loop
    perform crm.audit_notice(v_row.id, 'audit-anfrage', 'Seit einem Tag offen: ', 'Noch nicht entschieden', 'wichtig',
      'audit-offen-' || v_row.id || '-' || extract(epoch from v_row.asked_at)::bigint);
    update crm.audit_requests set owner_reminded_at = now() where id = v_row.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Daily: the customer of every appointment tomorrow whose confirmation went out gets a reminder.
create or replace function crm.send_appointment_reminders() returns int
language plpgsql as $$
declare v_row crm.appointments; v_mail crm.outbox; v_count int := 0;
begin
  perform crm.require_writer();
  for v_row in
    select a.* from crm.appointments a join crm.customers c on c.id = a.customer_id
     where a.status = 'planned' and a.starts_at is not null and a.customer_reminded_at is null
       and a.starts_on = (now() at time zone 'Europe/Berlin')::date + 1 and nullif(btrim(c.email), '') is not null
       and exists (select 1 from crm.outbox m where m.appointment_id = a.id and m.kind = 'appointment' and m.status = 'sent')
     order by a.starts_at for update of a skip locked
  loop
    v_mail := crm.queue_mail('appointment_reminder', v_row.customer_id, 'appointment_reminder',
      crm.base_values(v_row.customer_id, '', v_row.title) || jsonb_build_object(
        'termin', crm.appointment_when(v_row), 'art', crm.appointment_kind_label(v_row.kind), 'gespraech', crm.appointment_talk(v_row.kind),
        'ort', v_row.location, 'treffpunkt', crm.appointment_place(v_row.kind, v_row.location)));
    update crm.outbox set appointment_id = v_row.id where id = v_mail.id;
    update crm.appointments set customer_reminded_at = now() where id = v_row.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- The list in the RadarAuditor app: requests whose website was not checked yet and that are not booked.

create or replace function crm.open_audit_requests() returns table (
  id uuid, customer_id uuid, company text, contact text, website text, kind text, wished_at timestamptz, status text,
  created_at timestamptz)
language plpgsql stable as $$
begin
  if not public.is_admin() then raise exception 'Nur der Administrator darf das.'; end if;
  return query
  select r.id, r.customer_id, r.company, r.contact, r.website, r.kind, r.wished_at, r.status, r.created_at
    from crm.audit_requests r
   where r.status <> 'booked' and r.audit_id is null
   order by (r.status = 'open') desc, r.created_at desc
   limit 200;
end $$;

-- Overview: today's appointments with kind and place, for the start page of the CRM.
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

alter table crm.audit_requests enable row level security;
alter table crm.audit_offers enable row level security;
-- Created once; a re-run keeps them (the rules never change). The customer page reads requests.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'crm' and tablename = 'audit_requests' and policyname = 'admin_read') then
    create policy admin_read on crm.audit_requests for select to authenticated using (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'crm' and tablename = 'audit_offers' and policyname = 'admin_read') then
    create policy admin_read on crm.audit_offers for select to authenticated using (public.is_admin());
  end if;
end $$;
revoke all on crm.audit_requests, crm.audit_offers from anon, authenticated;
grant select on crm.audit_requests, crm.audit_offers to authenticated;
grant select, insert, update, delete on crm.audit_requests, crm.audit_offers to service_role;

revoke all on function crm.appointment_kind_label(text), crm.appointment_talk(text), crm.berlin_when(timestamptz),
  crm.appointment_place(text, text), crm.city_from_address(text), crm.check_appointment(text, timestamptz, date, int, uuid),
  crm.audit_reserved(timestamptz, uuid), crm.audit_slot_free(timestamptz, uuid), crm.audit_slot_open(timestamptz, uuid),
  crm.check_audit_kind(text), crm.audit_free_hours(text, uuid), crm.audit_slots(text), crm.audit_buttons(uuid), crm.audit_payload(uuid),
  crm.audit_notice(uuid, text, text, text, text, text, boolean),
  crm.check_audit_fields(text, text, text, text, text, text, text, text),
  crm.request_audit(text, text, text, text, text, text, text, timestamptz, text, text, text, text, uuid),
  crm.book_audit_appointment(crm.audit_requests, timestamptz), crm.lock_audit_request(uuid),
  crm.require_open_audit_request(crm.audit_requests), crm.confirm_audit_request(uuid), crm.propose_audit_times(uuid),
  crm.send_audit_proposal(uuid, uuid), crm.check_audit_website(uuid), crm.audit_offer_state(crm.audit_offers, crm.audit_requests),
  crm.audit_offer_view(uuid), crm.book_audit_offer(uuid), crm.audit_reschedule_view(uuid), crm.request_audit_reschedule(uuid),
  crm.remind_audit_requests(), crm.send_appointment_reminders(), crm.open_audit_requests(), crm.today_overview()
  from public, anon, authenticated;
grant execute on function crm.appointment_kind_label(text), crm.appointment_talk(text), crm.berlin_when(timestamptz),
  crm.appointment_place(text, text), crm.city_from_address(text), crm.check_appointment(text, timestamptz, date, int, uuid),
  crm.audit_reserved(timestamptz, uuid), crm.audit_slot_free(timestamptz, uuid), crm.audit_slot_open(timestamptz, uuid),
  crm.check_audit_kind(text), crm.audit_free_hours(text, uuid), crm.check_audit_fields(text, text, text, text, text, text, text, text),
  crm.open_audit_requests(), crm.today_overview()
  to authenticated, service_role;
grant execute on function crm.audit_buttons(uuid), crm.audit_payload(uuid), crm.audit_notice(uuid, text, text, text, text, text, boolean),
  crm.book_audit_appointment(crm.audit_requests, timestamptz), crm.lock_audit_request(uuid),
  crm.require_open_audit_request(crm.audit_requests), crm.confirm_audit_request(uuid), crm.propose_audit_times(uuid),
  crm.send_audit_proposal(uuid, uuid), crm.check_audit_website(uuid), crm.audit_offer_state(crm.audit_offers, crm.audit_requests),
  crm.audit_offer_view(uuid), crm.book_audit_offer(uuid), crm.audit_reschedule_view(uuid), crm.request_audit_reschedule(uuid),
  crm.remind_audit_requests(), crm.send_appointment_reminders()
  to service_role;
-- The website form reaches the free hours and its request without sign-in, and nothing else.
grant execute on function crm.audit_slots(text),
  crm.request_audit(text, text, text, text, text, text, text, timestamptz, text, text, text, text, uuid)
  to anon, authenticated, service_role;

select cron.schedule('crm-audit-requests', '19 * * * *', $job$ select crm.remind_audit_requests(); $job$);
-- 07:47 UTC is 08:47 in Münster in winter and 09:47 in summer, the morning of the day before.
select cron.schedule('crm-appointment-reminders', '47 7 * * *', $job$ select crm.send_appointment_reminders(); $job$);

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
