-- RepoCity CRM, the assistant of the Cockpit: requests by text or voice, four fixed tasks.
-- Context: builds on 001-011; decided with Daniel on 30.10.2026 (Nova point 4): Daniel types or
-- speaks a request in the Cockpit; the server worker turns speech into text with faster-whisper on the
-- server, deletes the recording, lets Claude Code read the request as one of four tasks (create a
-- contact, book an appointment, draft a mail to a customer, tell the revenue) and hands back that
-- intent; the database carries it out with its own checks, reads back what it stored (the cross-check)
-- and reports it in the Cockpit; a mail goes out only after "Senden". | Input: requests from the
-- Cockpit, intents and transcripts from the worker. | Output: crm.assistant_requests, storage bucket
-- crm-assistant, crm.ask_assistant, crm.claim_assistant_request, crm.save_assistant_transcript,
-- crm.apply_assistant_intent, crm.fail_assistant_request, crm.send_assistant_mail,
-- crm.money_between (crm.profit_by_month now builds on it). Re-runnable.

create table if not exists crm.assistant_requests (
  id uuid primary key default gen_random_uuid(),
  -- What Daniel typed, or the transcript of what he said.
  text text check (text is null or length(text) between 1 and 2000),
  audio_path text check (audio_path is null or audio_path ~ '^anfragen/[0-9a-f-]{36}\.wav$'),
  status text not null default 'queued' check (status in ('queued', 'claimed', 'done', 'failed')),
  attempts int not null default 0,
  claimed_at timestamptz,
  intent jsonb,
  result_text text not null default '',
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check (text is not null or audio_path is not null)
);
create index if not exists assistant_requests_open on crm.assistant_requests (created_at) where status in ('queued', 'claimed');

-- Money of a period by payment date, as crm.profit_by_month counts it.
create or replace function crm.money_between(p_from date, p_to date, out income numeric, out expenses numeric, out unassigned numeric)
language sql stable as $$
  select coalesce((select sum(amount) from crm.payments where paid_on between p_from and p_to), 0)
           + coalesce((select sum(amount) from crm.bank_transactions
                        where direction = 'in' and status = 'other_income' and booking_date between p_from and p_to), 0),
         coalesce((select sum(e.amount) from crm.expenses e left join crm.expense_accounts a on a.number = e.account
                    where e.spent_on between p_from and p_to and e.reversed_by is null
                      and (a.kind is null or a.kind in ('expense', 'tax'))), 0),
         coalesce((select sum(e.amount) from crm.expenses e
                    where e.spent_on between p_from and p_to and e.reversed_by is null and e.account is null), 0)
$$;

create or replace function crm.profit_by_month(p_from date, p_to date) returns table (
  month date, income numeric, expenses numeric, unassigned numeric, profit numeric)
language sql stable as $$
  select m.month::date, b.income, b.expenses, b.unassigned, b.income - b.expenses
    from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') as m(month)
   cross join lateral crm.money_between(greatest(m.month::date, p_from),
                                        least((m.month + interval '1 month - 1 day')::date, p_to)) b
   order by m.month
$$;

-- Requests

create or replace function crm.ask_assistant(p_text text, p_audio_path text) returns crm.assistant_requests
language plpgsql as $$
declare v_row crm.assistant_requests; v_text text := nullif(btrim(coalesce(p_text, '')), '');
begin
  perform crm.require_writer();
  if auth.uid() is null then raise exception 'Nur der Administrator darf das.'; end if;
  if (v_text is null) = (p_audio_path is null) then raise exception 'Bitte einen Text oder eine Aufnahme schicken.'; end if;
  if length(v_text) > 2000 then raise exception 'Der Text ist zu lang (höchstens 2.000 Zeichen).'; end if;
  insert into crm.assistant_requests (text, audio_path) values (v_text, p_audio_path) returning * into v_row;
  return v_row;
end $$;

-- The worker takes the oldest request; one claimed for more than 10 minutes is taken again, three times at most,
-- and after that ends as not done, so it never stays "In Arbeit".
create or replace function crm.claim_assistant_request() returns setof crm.assistant_requests
language plpgsql as $$
declare v_stuck uuid;
begin
  perform crm.require_writer();
  for v_stuck in
    select id from crm.assistant_requests
     where status = 'claimed' and claimed_at < now() - interval '10 minutes' and attempts >= 3
     for update skip locked
  loop
    perform crm.finish_assistant_request(v_stuck, false, 'Der Server hat die Anfrage dreimal nicht zu Ende gebracht.', null);
  end loop;
  return query
  update crm.assistant_requests set status = 'claimed', claimed_at = now(), attempts = attempts + 1
   where id = (select id from crm.assistant_requests
                where status = 'queued' or (status = 'claimed' and claimed_at < now() - interval '10 minutes' and attempts < 3)
                order by created_at limit 1 for update skip locked)
  returning *;
end $$;

create or replace function crm.save_assistant_transcript(p_request uuid, p_text text) returns void
language plpgsql as $$
begin
  perform crm.require_writer();
  if length(btrim(coalesce(p_text, ''))) = 0 then raise exception 'Die Aufnahme enthält keinen verständlichen Text.'; end if;
  update crm.assistant_requests set text = left(btrim(p_text), 2000) where id = p_request and status = 'claimed';
  if not found then raise exception 'Diese Anfrage ist nicht in Arbeit.'; end if;
end $$;

create or replace function crm.finish_assistant_request(p_request uuid, p_ok boolean, p_text text, p_intent jsonb) returns jsonb
language plpgsql as $$
begin
  update crm.assistant_requests set status = case when p_ok then 'done' else 'failed' end, result_text = left(p_text, 2000),
    intent = p_intent, finished_at = now()
   where id = p_request;
  perform crm.notify_cockpit('assistent', case when p_ok then 'Assistent: erledigt' else 'Assistent: nicht erledigt' end, p_text,
    'https://cockpit.speedofthespirit.dev/', 'info', 'assistent-' || p_request);
  return jsonb_build_object('ok', p_ok, 'text', p_text);
end $$;

create or replace function crm.fail_assistant_request(p_request uuid, p_error text) returns void
language plpgsql as $$
begin
  perform crm.require_writer();
  perform crm.finish_assistant_request(p_request, false, coalesce(nullif(btrim(p_error), ''), 'Das hat nicht geklappt.'), null);
end $$;

-- Tasks

-- The one customer a spoken name means: exact name, contact person or address first, then a part of the name.
create or replace function crm.assistant_customer(p_name text) returns crm.customers
language plpgsql stable as $$
declare v_key text := lower(btrim(coalesce(p_name, ''))); v_found crm.customers[];
begin
  if v_key = '' then raise exception 'Bitte den Kunden nennen.'; end if;
  select coalesce(array_agg(c order by c.name), '{}') into v_found from crm.customers c
   where lower(c.name) = v_key or lower(c.contact_person) = v_key or lower(coalesce(c.email, '')) = v_key;
  if cardinality(v_found) = 0 then
    select coalesce(array_agg(c order by c.name), '{}') into v_found from crm.customers c
     where strpos(lower(c.name), v_key) > 0 or strpos(lower(c.contact_person), v_key) > 0;
  end if;
  if cardinality(v_found) = 0 then raise exception 'Keinen Kunden „%“ gefunden.', btrim(p_name); end if;
  if cardinality(v_found) > 1 then
    raise exception 'Mehrere Kunden passen zu „%“: %. Bitte genauer sagen.', btrim(p_name),
      (select string_agg(c.name, ', ') from unnest(v_found[1:5]) c);
  end if;
  return v_found[1];
end $$;

create or replace function crm.assistant_contact(p_intent jsonb) returns text
language plpgsql as $$
declare
  v_person text := left(btrim(coalesce(p_intent ->> 'name', '')), 200);
  v_company text := left(btrim(coalesce(p_intent ->> 'company', '')), 200);
  v_email text := nullif(lower(btrim(coalesce(p_intent ->> 'email', ''))), '');
  v_phone text := left(btrim(coalesce(p_intent ->> 'phone', '')), 60);
  v_known text;
  v_row crm.customers;
begin
  if v_person = '' and v_company = '' then raise exception 'Bitte einen Namen nennen.'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Die E-Mail-Adresse % ist ungültig.', v_email; end if;
  select name into v_known from crm.customers where lower(email) = v_email;
  if v_known is not null then raise exception 'Die Adresse % gehört schon zu %; nichts angelegt.', v_email, v_known; end if;
  insert into crm.customers (kind, name, contact_person, email, phone, source, notes)
  values (case when v_company = '' then 'person' else 'company' end, coalesce(nullif(v_company, ''), v_person),
          case when v_company = '' then '' else v_person end, v_email, v_phone, 'agent',
          left(btrim(coalesce(p_intent ->> 'note', '')), 2000))
  returning * into v_row;
  perform crm.log(v_row.id, 'Kunde vom Assistenten angelegt.', 'system', 'Assistent');
  return 'Kontakt angelegt: ' || v_row.name || coalesce(' (' || nullif(v_row.contact_person, '') || ')', '')
    || coalesce(', ' || v_row.email, '') || coalesce(', ' || nullif(v_row.phone, ''), '') || '.';
end $$;

create or replace function crm.assistant_appointment(p_intent jsonb) returns text
language plpgsql as $$
declare v_customer crm.customers; v_starts timestamptz; v_row crm.appointments;
begin
  if nullif(btrim(coalesce(p_intent ->> 'customer', '')), '') is not null then
    v_customer := crm.assistant_customer(p_intent ->> 'customer');
  end if;
  begin
    v_starts := (p_intent ->> 'starts_at')::timestamptz;
  exception when others then
    raise exception 'Die Uhrzeit des Termins ist ungültig.';
  end;
  if v_starts is null then raise exception 'Bitte Tag und Uhrzeit des Termins nennen.'; end if;
  if v_starts < now() - interval '1 hour' then raise exception 'Der Termin liegt in der Vergangenheit.'; end if;
  v_row := crm.book_appointment(coalesce(p_intent ->> 'kind', 'other'), p_intent ->> 'title', v_starts, null,
    coalesce((p_intent ->> 'duration_minutes')::int, 60), v_customer.id, p_intent ->> 'location', p_intent ->> 'note', 'assistant');
  select * into v_row from crm.appointments where id = v_row.id;
  return 'Termin eingetragen: ' || v_row.title || ', ' || crm.appointment_when(v_row) || ', '
    || extract(epoch from v_row.ends_at - v_row.starts_at)::int / 60 || ' Minuten' || coalesce(', ' || nullif(v_row.location, ''), '') || '.';
end $$;

create or replace function crm.assistant_mail(p_intent jsonb) returns text
language plpgsql as $$
declare
  v_customer crm.customers;
  v_subject text := left(btrim(coalesce(p_intent ->> 'subject', '')), 300);
  v_body text := left(coalesce(p_intent ->> 'body', ''), 20000);
  v_approval crm.approvals;
begin
  v_customer := crm.assistant_customer(p_intent ->> 'customer');
  if nullif(btrim(coalesce(v_customer.email, '')), '') is null then
    raise exception 'Bei % fehlt die E-Mail-Adresse.', v_customer.name;
  end if;
  if v_subject = '' or btrim(v_body) = '' then raise exception 'Der Mail fehlen Betreff oder Text.'; end if;
  insert into crm.approvals (kind, title, body, customer_id, payload)
  values ('assistant_mail', 'Mail an ' || v_customer.name || ': ' || v_subject, v_body, v_customer.id,
          jsonb_build_object('customer_id', v_customer.id, 'subject', v_subject, 'body', v_body))
  returning * into v_approval;
  return 'Mail an ' || v_customer.name || ' (' || v_customer.email || ') „' || (v_approval.payload ->> 'subject') || '“ wartet auf dein Senden.';
end $$;

create or replace function crm.assistant_revenue(p_intent jsonb) returns text
language plpgsql as $$
declare v_from date; v_to date; v_money record;
begin
  begin
    v_from := (p_intent ->> 'from')::date;
    v_to := (p_intent ->> 'to')::date;
  exception when others then
    raise exception 'Der Zeitraum ist ungültig.';
  end;
  if v_from is null or v_to is null or v_from > v_to then raise exception 'Der Zeitraum ist ungültig.'; end if;
  v_money := crm.money_between(v_from, v_to);
  return crm.date_de(v_from) || ' bis ' || crm.date_de(v_to) || ': Einnahmen ' || crm.euro(v_money.income)
    || ', Ausgaben ' || crm.euro(v_money.expenses) || ', Gewinn ' || crm.euro(v_money.income - v_money.expenses) || '.';
end $$;

-- What the worker hands back. Every answer is {"ok": boolean, "text": German sentence}; the text
-- describes what the database stored, not what was asked.
create or replace function crm.apply_assistant_intent(p_request uuid, p_intent jsonb) returns jsonb
language plpgsql as $$
declare v_action text := p_intent ->> 'action'; v_text text;
begin
  perform crm.require_writer();
  if not exists (select 1 from crm.assistant_requests where id = p_request and status = 'claimed') then
    raise exception 'Diese Anfrage ist nicht in Arbeit.';
  end if;
  begin
    v_text := case v_action
      when 'create_contact' then crm.assistant_contact(p_intent)
      when 'create_appointment' then crm.assistant_appointment(p_intent)
      when 'draft_mail' then crm.assistant_mail(p_intent)
      when 'revenue' then crm.assistant_revenue(p_intent)
    end;
  exception when sqlstate 'P0001' then
    return crm.finish_assistant_request(p_request, false, sqlerrm, p_intent);
  end;
  if v_text is null then
    return crm.finish_assistant_request(p_request, false,
      case when v_action = 'unclear' then 'Rückfrage: ' || coalesce(nullif(btrim(p_intent ->> 'question'), ''), 'Was genau soll ich tun?')
           else 'Das kann der Assistent nicht: ' || coalesce(v_action, 'keine Aufgabe') || '.' end, p_intent);
  end if;
  return crm.finish_assistant_request(p_request, true, v_text, p_intent);
end $$;

-- "Senden" on a mail the assistant drafted.
create or replace function crm.send_assistant_mail(p_approval crm.approvals) returns crm.outbox
language plpgsql as $$
declare v_customer crm.customers; v_mail crm.outbox;
begin
  select * into v_customer from crm.customers where id = (p_approval.payload ->> 'customer_id')::uuid;
  if nullif(btrim(coalesce(v_customer.email, '')), '') is null then
    raise exception 'Beim Kunden fehlt die E-Mail-Adresse. Bitte erst in den Stammdaten eintragen.';
  end if;
  insert into crm.outbox (customer_id, kind, approval_id, to_address, subject, body)
  values (v_customer.id, 'assistant', p_approval.id, btrim(v_customer.email), p_approval.payload ->> 'subject', p_approval.payload ->> 'body')
  returning * into v_mail;
  return v_mail;
end $$;

-- Recordings: private, the administrator adds them, the server worker reads and deletes them.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('crm-assistant', 'crm-assistant', false, 4194304) on conflict (id) do nothing;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                    and policyname = 'crm_assistant_add') then
      create policy crm_assistant_add on storage.objects for insert to authenticated
        with check (bucket_id = 'crm-assistant' and public.is_admin());
    end if;
  end if;
end $$;

-- Requests and what they said are kept 30 days, then deleted (daily cron job crm-assistant-prune).
create or replace function crm.prune_assistant_requests() returns int
language plpgsql as $$
declare v_count int;
begin
  perform crm.require_writer();
  delete from crm.assistant_requests where created_at < now() - interval '30 days' and status in ('queued', 'done', 'failed');
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Recordings the server worker removes with the Storage interface (a direct delete in SQL is not
-- allowed): older than ten minutes and named by no request, for example when the upload worked
-- but the request was never stored.
create or replace function crm.orphan_recordings() returns table (path text)
language sql stable as $$
  select o.name from storage.objects o
   where o.bucket_id = 'crm-assistant' and o.name like 'anfragen/%' and o.created_at < now() - interval '10 minutes'
     and not exists (select 1 from crm.assistant_requests r where r.audio_path = o.name)
   order by o.created_at
   limit 100
$$;

-- Rights

alter table crm.assistant_requests enable row level security;
-- The administrator reads and asks; status and results are written by the server worker only.
-- Created once; a re-run keeps them (the rules never change).
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'crm' and tablename = 'assistant_requests' and policyname = 'admin_read') then
    create policy admin_read on crm.assistant_requests for select to authenticated using (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'crm' and tablename = 'assistant_requests' and policyname = 'admin_ask') then
    create policy admin_ask on crm.assistant_requests for insert to authenticated with check (public.is_admin() and status = 'queued');
  end if;
end $$;
grant select, insert on crm.assistant_requests to authenticated;
grant select, insert, update, delete on crm.assistant_requests to service_role;

revoke all on function crm.money_between(date, date), crm.ask_assistant(text, text), crm.claim_assistant_request(),
  crm.save_assistant_transcript(uuid, text), crm.finish_assistant_request(uuid, boolean, text, jsonb),
  crm.fail_assistant_request(uuid, text), crm.assistant_customer(text), crm.assistant_contact(jsonb),
  crm.assistant_appointment(jsonb), crm.assistant_mail(jsonb), crm.assistant_revenue(jsonb),
  crm.apply_assistant_intent(uuid, jsonb), crm.send_assistant_mail(crm.approvals), crm.orphan_recordings(),
  crm.prune_assistant_requests()
  from public, anon, authenticated;
revoke all on function crm.orphan_recordings(), crm.prune_assistant_requests() from authenticated;
grant execute on function crm.money_between(date, date), crm.ask_assistant(text, text), crm.send_assistant_mail(crm.approvals)
  to authenticated, service_role;
grant execute on function crm.claim_assistant_request(), crm.save_assistant_transcript(uuid, text),
  crm.finish_assistant_request(uuid, boolean, text, jsonb), crm.fail_assistant_request(uuid, text), crm.assistant_customer(text),
  crm.assistant_contact(jsonb), crm.assistant_appointment(jsonb), crm.assistant_mail(jsonb), crm.assistant_revenue(jsonb),
  crm.apply_assistant_intent(uuid, jsonb), crm.orphan_recordings(), crm.prune_assistant_requests()
  to service_role;

select cron.schedule('crm-assistant-prune', '23 3 * * *', $job$ select crm.prune_assistant_requests(); $job$);

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
