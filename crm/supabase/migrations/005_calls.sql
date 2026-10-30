-- RepoCity CRM, the phone assistant: greeting and facts, inquiries by phone, quote decisions on the
-- phone and the record of every call.
-- Context: builds on 001-004 and cockpit 002; the contract is the section "Phone assistant" of
-- Dokumentation/INTEGRATION.md. The agent on the RepoCity server calls the three entry functions
-- with the service key; the caller number comes from the phone line, everything else from speech
-- recognition and is untrusted. | Input: none. | Output: settings columns, table crm.calls,
-- crm.intake_call, crm.phone_quote_decision, crm.record_call. Re-runnable: every statement checks first.

-- Settings

-- Art. 50(1) and (5) of Regulation (EU) 2024/1689: the caller is told at the first interaction that
-- an AI answers. The text cannot be emptied, so the disclosure can only be reworded, never dropped.
alter table crm.settings add column if not exists assistant_greeting text not null default
  'Guten Tag, hier ist die digitale Assistentin von RepoCity. Ich bin eine künstliche Intelligenz, kein Mensch. '
  'Unser Gespräch wird mitgeschrieben, damit Ihr Anliegen bearbeitet werden kann. Was kann ich für Sie tun?';
alter table crm.settings drop constraint if exists settings_assistant_greeting_check;
alter table crm.settings add constraint settings_assistant_greeting_check check (length(btrim(assistant_greeting)) between 1 and 1000);

-- What the assistant may say about the business; Daniel fills it in the CRM.
alter table crm.settings add column if not exists assistant_facts text not null default '';
alter table crm.settings drop constraint if exists settings_assistant_facts_check;
alter table crm.settings add constraint settings_assistant_facts_check check (length(assistant_facts) <= 20000);

-- Phone numbers

-- One key per number however it is written: digits only, 0049 and a national 0 become 49, and a
-- "(0)" after the country code is dropped. A SIP address keeps only its user part.
create or replace function crm.phone_key(p_number text) returns text
language sql immutable as $$
  select case when length(k) < 6 then null else k end
    from (select regexp_replace(case when d like '00%' then substr(d, 3) when d like '0%' then '49' || substr(d, 2) else d end,
                                '^490', '49') as k
            from (select regexp_replace(split_part(coalesce(p_number, ''), '@', 1), '\D', '', 'g') as d) digits) keyed
$$;

create index if not exists customers_phone_key on crm.customers (crm.phone_key(phone)) where phone <> '';

-- Two customers may share a number; the oldest one is the deterministic choice.
create or replace function crm.customer_by_phone(p_number text) returns uuid
language sql stable as $$
  select id from crm.customers
   where phone <> '' and crm.phone_key(phone) = crm.phone_key(p_number)
   order by created_at, id limit 1
$$;

-- Calls

create table if not exists crm.calls (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references crm.customers (id) on delete cascade,
  caller_number text check (length(caller_number) <= 60),
  direction text not null default 'in' check (direction = 'in'),
  started_at timestamptz not null,
  ended_at timestamptz,
  transcript jsonb not null default '[]' check (jsonb_typeof(transcript) = 'array'),
  summary text not null default '' check (length(summary) <= 2000),
  outcome text not null check (outcome in ('inquiry', 'quote_accepted', 'quote_declined', 'callback', 'info', 'dropped')),
  created_at timestamptz not null default now(),
  check (ended_at >= started_at)
);
create index if not exists calls_customer on crm.calls (customer_id, started_at desc) where customer_id is not null;
-- A number cannot start two calls in the same instant, so a retried record is recognised.
create unique index if not exists calls_once on crm.calls ((coalesce(caller_number, '')), started_at);

-- Inquiries by phone

create or replace function crm.add_phone_customer(p_caller text, p_name text, p_company text, p_email text) returns uuid
language plpgsql as $$
declare v_customer uuid; v_company text := left(btrim(coalesce(p_company, '')), 200); v_person text := left(btrim(coalesce(p_name, '')), 200);
begin
  insert into crm.customers (kind, name, contact_person, email, phone, source)
  values (case when v_company = '' then 'person' else 'company' end,
          coalesce(nullif(v_company, ''), nullif(v_person, ''), left('Anrufer ' || p_caller, 200), 'Anrufer ohne Rufnummer'),
          case when v_company = '' then '' else v_person end, p_email, coalesce(left(p_caller, 60), ''), 'phone')
  returning id into v_customer;
  perform crm.log(v_customer, 'Kunde automatisch angelegt (Telefon).', 'system', 'Telefonassistentin');
  return v_customer;
end $$;

-- The customer is found by the number of the line first, then by a spoken e-mail address. A spoken
-- address that is no valid address is kept in the message instead of being stored.
create or replace function crm.intake_call(p_caller_number text, p_name text, p_company text, p_email text,
  p_subject text, p_message text) returns uuid
language plpgsql as $$
declare
  v_caller text := nullif(btrim(coalesce(p_caller_number, '')), '');
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_valid boolean;
  v_message text := coalesce(p_message, '');
  v_subject text := left(coalesce(nullif(btrim(p_subject), ''), 'Anruf'), 200);
  v_customer uuid;
begin
  v_valid := v_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(v_email) <= 200;
  if v_email <> '' and not v_valid then
    v_message := v_message || E'\n\nE-Mail-Adresse laut Anruf, nicht erkannt: ' || left(btrim(p_email), 200);
  end if;
  v_customer := crm.customer_by_phone(v_caller);
  if v_customer is null and v_valid then select id into v_customer from crm.customers where lower(email) = v_email; end if;
  if v_customer is null then
    v_customer := crm.add_phone_customer(v_caller, p_name, p_company, case when v_valid then v_email end);
  end if;
  insert into crm.inquiries (customer_id, channel, subject, message) values (v_customer, 'phone', v_subject, left(v_message, 5000));
  insert into crm.tasks (title, customer_id, origin)
  values (left('Rückruf ' || coalesce(nullif(btrim(p_name), ''), nullif(btrim(p_company), ''), (select name from crm.customers where id = v_customer))
               || ', ' || coalesce(v_caller, 'Rufnummer unbekannt'), 300), v_customer, 'agent');
  perform crm.log(v_customer, 'Anfrage am Telefon: ' || v_subject, 'call', 'Telefonassistentin');
  return v_customer;
end $$;

-- Quote decisions on the phone

-- Spoken quote numbers differ in separators and leading zeros: "an 2026 4" is AN-2026-0004.
create or replace function crm.quote_key(p_number text) returns text
language sql immutable as $$
  select regexp_replace(upper(regexp_replace(coalesce(p_number, ''), '[^[:alnum:]]', '', 'g')), '^([A-Z]*)([0-9]{4})0*([0-9]+)$', '\1\2-\3')
$$;

-- By number among all quotes; without a number the only sent quote of the customers on this line.
create or replace function crm.phone_quote(p_caller text, p_number text) returns crm.quotes
language sql stable as $$
  select q.* from crm.quotes q
   where case when nullif(btrim(p_number), '') is not null
              then crm.quote_key(q.number) = crm.quote_key(p_number)
              else q.id = (select (array_agg(s.id))[1] from crm.quotes s join crm.customers c on c.id = s.customer_id
                            where s.status = 'sent' and c.phone <> '' and crm.phone_key(c.phone) = crm.phone_key(p_caller)
                           having count(*) = 1) end
   limit 1
$$;

-- What Daniel needs to decide: which quote, whether it is still open and valid, whether the line fits.
create or replace function crm.phone_decision_note(p_caller text, p_number text, p_quote crm.quotes, p_matches boolean) returns text
language sql stable as $$
  select case
           when p_quote.id is null and nullif(btrim(p_number), '') is null then 'Angebot nicht eindeutig'
           when p_quote.id is null then 'Angebot „' || left(btrim(p_number), 40) || '“ nicht gefunden'
           when p_quote.status <> 'sent' then 'Angebot ' || p_quote.number || ' ist nicht mehr offen'
           when p_quote.valid_until < current_date then 'Angebot ' || p_quote.number || ' ist am ' || crm.date_de(p_quote.valid_until) || ' abgelaufen'
           else 'Angebot ' || p_quote.number end
      || ' · ' || case
           when crm.phone_key(p_caller) is null then 'Anruf ohne Rufnummer'
           when p_quote.id is null then 'Anruf von ' || btrim(p_caller)
           when p_matches then 'Rufnummer passt zum Kunden'
           else 'Rufnummer ' || btrim(p_caller) || ' passt nicht zum Kunden' end
$$;

create or replace function crm.notify_phone_decision(p_caller text, p_number text, p_intent text, p_note text,
  p_quote crm.quotes, p_matches boolean) returns void
language plpgsql as $$
begin
  perform crm.notify_cockpit(case p_intent when 'accept' then 'annahme' else 'kundenmail' end,
    case p_intent when 'accept' then 'Mögliche Annahme am Telefon: ' else 'Mögliche Absage am Telefon: ' end
      || coalesce((select name from crm.customers where id = p_quote.customer_id), nullif(btrim(p_caller), ''), 'unbekannte Rufnummer'),
    p_note || ' · ' || crm.phone_decision_note(p_caller, p_number, p_quote, p_matches),
    'https://crm.speedofthespirit.dev/' || coalesce('angebot/' || p_quote.id, ''), 'wichtig', null,
    case when p_intent = 'accept' and p_quote.status = 'sent' then '[{"action": "accept_quote", "title": "Annahme bestätigen"}]'::jsonb else '[]'::jsonb end,
    case when p_quote.id is not null then jsonb_build_object('quote_id', p_quote.id) else '{}'::jsonb end);
end $$;

-- Decided without Daniel only when the line's number is the phone of the quote's customer, the quote
-- is sent and, for an acceptance, still valid. Every other case gets the same answer, so a caller
-- learns nothing about quotes that are not theirs.
create or replace function crm.phone_quote_decision(p_caller_number text, p_quote_number text, p_intent text, p_summary text)
returns jsonb
language plpgsql as $$
declare
  v_quote crm.quotes;
  v_matches boolean;
  v_note text := left(coalesce(nullif(btrim(p_summary), ''), case p_intent when 'accept' then 'Annahme am Telefon' else 'Absage am Telefon' end), 2000);
begin
  if p_intent is null or p_intent not in ('accept', 'decline') then
    raise exception 'Unbekannte Entscheidung: %', coalesce(p_intent, 'leer') using errcode = '22023';
  end if;
  v_quote := crm.phone_quote(p_caller_number, p_quote_number);
  v_matches := coalesce(crm.phone_key(p_caller_number) = (select crm.phone_key(phone) from crm.customers where id = v_quote.customer_id), false);
  if v_quote.id is not null then
    perform crm.log(v_quote.customer_id, 'Anruf zu Angebot ' || v_quote.number || ': ' || v_note, 'call', 'Telefonassistentin');
  end if;
  if v_matches and v_quote.status = 'sent' and p_intent = 'accept' and v_quote.valid_until >= current_date then
    perform crm.accept_quote_via(v_quote.id, 'phone', v_note);
    return jsonb_build_object('done', true, 'text', 'Vielen Dank. Ich habe Ihre Annahme des Angebots ' || v_quote.number || ' eingetragen.');
  elsif v_matches and v_quote.status = 'sent' and p_intent = 'decline' then
    perform crm.decline_quote_via(v_quote.id, 'phone', v_note);
    perform crm.notify_cockpit('kundenmail', 'Absage am Telefon: ' || (select name from crm.customers where id = v_quote.customer_id)
      || ' – ' || v_quote.number, v_note, 'https://crm.speedofthespirit.dev/angebot/' || v_quote.id, 'info');
    return jsonb_build_object('done', true, 'text', 'Vielen Dank für Ihre Rückmeldung. Ich habe Ihre Absage zum Angebot ' || v_quote.number || ' eingetragen.');
  end if;
  perform crm.notify_phone_decision(p_caller_number, p_quote_number, p_intent, v_note, v_quote, v_matches);
  return jsonb_build_object('done', false, 'text', 'Vielen Dank. Ich habe Ihre Rückmeldung notiert und gebe sie zur persönlichen Prüfung weiter.');
end $$;

-- Call records

create or replace function crm.valid_transcript(p_transcript jsonb) returns boolean
language sql immutable as $$
  select case when jsonb_typeof(p_transcript) = 'array' then
    jsonb_array_length(p_transcript) <= 2000 and not exists (
      select 1 from jsonb_array_elements(p_transcript) e
       where not coalesce(jsonb_typeof(e) = 'object' and e ->> 'speaker' in ('caller', 'assistant')
                          and jsonb_typeof(e -> 'text') = 'string' and length(e ->> 'text') <= 4000
                          and (select count(*) from jsonb_object_keys(e)) = 2, false))
  else false end
$$;

create or replace function crm.check_call(p_call jsonb) returns void
language plpgsql immutable as $$
begin
  if not coalesce(case when jsonb_typeof(p_call) = 'object' then
       p_call ->> 'outcome' in ('inquiry', 'quote_accepted', 'quote_declined', 'callback', 'info', 'dropped')
       and jsonb_typeof(p_call -> 'started_at') = 'string' and crm.is_text_or_absent(p_call, 'ended_at', 40)
       and crm.is_text_or_absent(p_call, 'caller_number', 60) and crm.is_text_or_absent(p_call, 'customer_id', 36)
       and crm.is_text_or_absent(p_call, 'summary', 2000) and (not p_call ? 'transcript' or crm.valid_transcript(p_call -> 'transcript'))
       and not exists (select 1 from jsonb_object_keys(p_call) k
                        where k not in ('caller_number', 'customer_id', 'started_at', 'ended_at', 'transcript', 'summary', 'outcome'))
     else false end, false) then
    raise exception 'Anruf passt nicht zum erwarteten Aufbau.' using errcode = '22023';
  end if;
end $$;

-- The customer is the one the agent names (from crm.intake_call), else the one on this line.
create or replace function crm.call_from_json(p_call jsonb) returns crm.calls
language plpgsql stable as $$
declare v_call crm.calls;
begin
  v_call.caller_number := nullif(btrim(p_call ->> 'caller_number'), '');
  v_call.started_at := (p_call ->> 'started_at')::timestamptz;
  v_call.ended_at := (p_call ->> 'ended_at')::timestamptz;
  v_call.transcript := coalesce(p_call -> 'transcript', '[]');
  v_call.summary := btrim(coalesce(p_call ->> 'summary', ''));
  v_call.outcome := p_call ->> 'outcome';
  v_call.customer_id := coalesce((select id from crm.customers where id = (p_call ->> 'customer_id')::uuid),
                                 crm.customer_by_phone(v_call.caller_number));
  if v_call.ended_at < v_call.started_at then raise exception using errcode = '22007'; end if;
  return v_call;
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
  raise exception 'Anruf passt nicht zum erwarteten Aufbau.' using errcode = '22023';
end $$;

create or replace function crm.announce_call(p_call crm.calls) returns void
language plpgsql as $$
declare v_text text := coalesce(nullif(p_call.summary, ''), case p_call.outcome
  when 'inquiry' then 'Anfrage aufgenommen' when 'quote_accepted' then 'Angebot angenommen' when 'quote_declined' then 'Angebot abgelehnt'
  when 'callback' then 'Bitte um Rückruf' when 'info' then 'Auskunft gegeben' else 'Gespräch abgebrochen' end);
begin
  if p_call.customer_id is not null then
    perform crm.log(p_call.customer_id, 'Anruf: ' || v_text, 'call', 'Telefonassistentin');
  end if;
  perform crm.notify_cockpit('anruf',
    'Anruf von ' || coalesce((select name from crm.customers where id = p_call.customer_id), p_call.caller_number, 'unbekannter Rufnummer'),
    v_text, 'https://crm.speedofthespirit.dev/' || coalesce('kunde/' || p_call.customer_id, ''),
    case when p_call.outcome in ('inquiry', 'callback') then 'wichtig' else 'info' end, 'anruf-' || p_call.id);
end $$;

-- A retried record of the same call returns the stored id without a second notice.
create or replace function crm.record_call(p_call jsonb) returns uuid
language plpgsql as $$
declare v_call crm.calls;
begin
  perform crm.check_call(p_call);
  v_call := crm.call_from_json(p_call);
  insert into crm.calls (customer_id, caller_number, started_at, ended_at, transcript, summary, outcome)
  values (v_call.customer_id, v_call.caller_number, v_call.started_at, v_call.ended_at, v_call.transcript, v_call.summary, v_call.outcome)
  on conflict ((coalesce(caller_number, '')), started_at) do nothing
  returning * into v_call;
  if v_call.id is null then
    return (select id from crm.calls where coalesce(caller_number, '') = coalesce(nullif(btrim(p_call ->> 'caller_number'), ''), '')
                                       and started_at = (p_call ->> 'started_at')::timestamptz);
  end if;
  perform crm.announce_call(v_call);
  return v_call.id;
end $$;

-- Rights: the agent writes with the service key; the signed-in administrator only reads calls.

alter table crm.calls enable row level security;
drop policy if exists admin_read on crm.calls;
create policy admin_read on crm.calls for select to authenticated using (public.is_admin());
revoke all on crm.calls from public, anon, authenticated;
grant select on crm.calls to authenticated;
grant select, insert, update, delete on crm.calls to service_role;

revoke all on function crm.intake_call(text, text, text, text, text, text), crm.phone_quote_decision(text, text, text, text),
  crm.record_call(jsonb) from public, anon, authenticated;
grant execute on function crm.intake_call(text, text, text, text, text, text), crm.phone_quote_decision(text, text, text, text),
  crm.record_call(jsonb) to service_role;
-- Helpers that only read stay open to signed-in users, as everywhere in crm; those that write do not.
revoke all on function crm.phone_key(text), crm.customer_by_phone(text), crm.quote_key(text), crm.phone_quote(text, text),
  crm.phone_decision_note(text, text, crm.quotes, boolean), crm.valid_transcript(jsonb), crm.check_call(jsonb),
  crm.call_from_json(jsonb) from public, anon;
grant execute on function crm.phone_key(text), crm.customer_by_phone(text), crm.quote_key(text), crm.phone_quote(text, text),
  crm.phone_decision_note(text, text, crm.quotes, boolean), crm.valid_transcript(jsonb), crm.check_call(jsonb),
  crm.call_from_json(jsonb) to authenticated, service_role;
revoke all on function crm.add_phone_customer(text, text, text, text), crm.notify_phone_decision(text, text, text, text, crm.quotes, boolean),
  crm.announce_call(crm.calls) from public, anon, authenticated;
grant execute on function crm.add_phone_customer(text, text, text, text), crm.notify_phone_decision(text, text, text, text, crm.quotes, boolean),
  crm.announce_call(crm.calls) to service_role;

notify pgrst, 'reload schema';
