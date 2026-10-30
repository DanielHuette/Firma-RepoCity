-- RepoCity Cockpit, one-tap actions and the notices of the CRM flow.
-- Context: builds on 001_cockpit.sql and CRM 004 (outbox kinds, audit_runs, mail_triage,
-- review_requests); the contract is Dokumentation/INTEGRATION.md. Live order: RadarAuditor 013,
-- CRM 004, this file. | Input: none. | Output: actions, tag and action token on every message,
-- cockpit.notify_action, cockpit.run_action for the lock screen (open to anon, guarded by the token),
-- notices for mails, orders, monthly audits, mail triage and the missing review link, and the health
-- check of the mail triage backlog. Every trigger goes through notify_action_safe, so a failing notice
-- never undoes the business event. Re-runnable: every statement checks first. The button rule,
-- cockpit.valid_actions, cockpit.perform_action and cockpit.on_crm_customer are the versions of
-- 007_audit_anfragen.sql, so running this file again keeps the newer state.

alter table cockpit.messages add column if not exists actions jsonb not null default '[]';
alter table cockpit.messages add column if not exists action_payload jsonb not null default '{}';
alter table cockpit.messages add column if not exists action_token uuid not null default gen_random_uuid();
alter table cockpit.messages add column if not exists acted_at timestamptz;
alter table cockpit.messages add column if not exists acted_action text;
alter table cockpit.messages add column if not exists action_result text not null default '';
alter table cockpit.messages add column if not exists tag text;
alter table cockpit.messages drop constraint if exists messages_actions_check;
alter table cockpit.messages add constraint messages_actions_check
  check (jsonb_typeof(actions) = 'array' and jsonb_array_length(actions) <= 3);
alter table cockpit.messages drop constraint if exists messages_action_payload_check;
alter table cockpit.messages add constraint messages_action_payload_check check (jsonb_typeof(action_payload) = 'object');

-- At most three buttons, each an action run_action knows with a short title.
create or replace function cockpit.valid_actions(p_actions jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_actions) = 'array' and jsonb_array_length(p_actions) <= 3
     and not exists (
       select 1 from jsonb_array_elements(p_actions) a
        where jsonb_typeof(a) <> 'object'
           or (select count(*) from jsonb_object_keys(a)) <> 2
           or a ->> 'action' is null
           or a ->> 'action' not in ('start_audit', 'approve', 'reject', 'accept_quote',
                                     'audit_confirm', 'audit_propose', 'audit_send', 'audit_check')
           or jsonb_typeof(a -> 'title') is distinct from 'string' or length(btrim(a ->> 'title')) not between 1 and 40)
$$;

create or replace function cockpit.notify_action(
  p_app text, p_kind text, p_title text, p_body text, p_link text, p_priority text, p_dedupe text,
  p_actions jsonb, p_payload jsonb, p_tag text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;
  if not cockpit.valid_actions(coalesce(p_actions, '[]')) then
    raise exception 'Ungültige Aktionen: höchstens zwei, jede mit bekannter Aktion und kurzem Titel.' using errcode = '22023';
  end if;
  insert into cockpit.messages (app, kind, title, body, link, priority, dedupe_key, actions, action_payload, tag)
  values (p_app, p_kind, left(btrim(p_title), 200), coalesce(p_body, ''), coalesce(p_link, ''), p_priority, p_dedupe,
          coalesce(p_actions, '[]'), coalesce(p_payload, '{}'), p_tag)
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  if v_id is not null then
    perform cockpit.push(v_id);
  end if;
  return v_id;
end $$;

create or replace function cockpit.notify(
  p_app text, p_kind text, p_title text, p_body text default '', p_link text default '',
  p_priority text default 'info', p_dedupe text default null
) returns uuid
language sql security definer set search_path = '' as $$
  select cockpit.notify_action(p_app, p_kind, p_title, p_body, p_link, p_priority, p_dedupe, '[]', '{}', null)
$$;

create or replace function cockpit.notify_action_safe(
  p_kind text, p_title text, p_body text, p_link text, p_priority text, p_dedupe text,
  p_actions jsonb default '[]', p_payload jsonb default '{}', p_tag text default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform cockpit.notify_action('crm', p_kind, p_title, p_body, p_link, p_priority, p_dedupe, p_actions, p_payload, p_tag);
exception when others then
  raise warning 'cockpit.notify_action failed: %', sqlerrm;
end $$;

create or replace function cockpit.berlin_day() returns text
language sql stable set search_path = '' as $$ select to_char(now() at time zone 'Europe/Berlin', 'YYYY-MM-DD') $$;

-- One tap on the lock screen

create or replace function cockpit.perform_action(p_action text, p_payload jsonb) returns text
language plpgsql set search_path = '' as $$
declare v_order crm.orders; v_request uuid := (p_payload ->> 'request_id')::uuid;
begin
  case p_action
    when 'start_audit' then
      perform crm.start_audit_run((p_payload ->> 'run_id')::uuid);
      return 'Prüfung gestartet.';
    when 'approve' then
      perform crm.decide_approval((p_payload ->> 'approval_id')::uuid, true);
      return 'Freigabe erteilt.';
    when 'reject' then
      perform crm.decide_approval((p_payload ->> 'approval_id')::uuid, false);
      return 'Freigabe abgelehnt.';
    when 'accept_quote' then
      v_order := crm.accept_quote_via((p_payload ->> 'quote_id')::uuid, 'crm', 'im Cockpit bestätigt');
      return 'Angebot angenommen, Auftrag ' || v_order.number || ' angelegt.';
    when 'audit_confirm' then
      return crm.confirm_audit_request(v_request);
    when 'audit_propose' then
      return crm.propose_audit_times(v_request);
    when 'audit_send' then
      return crm.send_audit_proposal(v_request, (p_payload ->> 'batch')::uuid);
    when 'audit_check' then
      return crm.check_audit_website(v_request);
    else
      raise exception 'Diese Aktion gibt es hier nicht.';
  end case;
end $$;

-- The token proves the caller received the push, so the lock screen needs no sign-in. Every answer
-- is {"ok": boolean, "text": German sentence}; a failed action stays open to be tried again.
create or replace function cockpit.run_action(p_message uuid, p_token uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_message cockpit.messages; v_text text;
begin
  select * into v_message from cockpit.messages where id = p_message for update;
  if v_message.id is null or v_message.action_token is distinct from p_token then
    return jsonb_build_object('ok', false, 'text', 'Diese Aktion ist nicht gültig.');
  elsif v_message.acted_at is not null then
    return jsonb_build_object('ok', false, 'text', 'Das wurde bereits erledigt.');
  elsif v_message.created_at < now() - interval '14 days' then
    return jsonb_build_object('ok', false, 'text', 'Diese Mitteilung ist älter als 14 Tage. Bitte im CRM erledigen.');
  elsif not exists (select 1 from jsonb_array_elements(v_message.actions) a where a ->> 'action' = p_action) then
    return jsonb_build_object('ok', false, 'text', 'Diese Aktion gibt es hier nicht.');
  end if;
  begin
    v_text := cockpit.perform_action(p_action, v_message.action_payload);
  exception when others then
    update cockpit.messages set action_result = left(sqlerrm, 500) where id = p_message;
    return jsonb_build_object('ok', false, 'text', coalesce(nullif(btrim(sqlerrm), ''), 'Das hat nicht geklappt.'));
  end;
  update cockpit.messages set acted_at = now(), acted_action = p_action, action_result = v_text, read_at = coalesce(read_at, now())
   where id = p_message;
  return jsonb_build_object('ok', true, 'text', v_text);
end $$;

-- CRM events

create or replace function cockpit.on_crm_customer() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('repocity.quiet_customer_notice', true), '') = 'on' then return new; end if;
  perform cockpit.notify_safe('crm', 'kunde', 'Neuer Kunde: ' || new.name,
    'Quelle: ' || case new.source when 'website' then 'Webseite' when 'phone' then 'Telefon' when 'email' then 'E-Mail'
      when 'referral' then 'Empfehlung' when 'agent' then 'KI-Agent' when 'manual' then 'von Hand'
      when 'radarauditor' then 'RadarAuditor' else 'sonstige' end
      || case when coalesce(new.email, '') <> '' then ' · ' || new.email else '' end,
    'https://crm.speedofthespirit.dev/kunde/' || new.id, 'wichtig', 'kunde-' || new.id);
  return new;
end $$;

-- A dunning approval gets the two buttons; Daniel's tap is the only way a reminder goes out.
create or replace function cockpit.on_crm_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'pending' then
    perform cockpit.notify_action_safe('freigabe', 'Freigabe nötig: ' || new.title,
      left(regexp_replace(new.body, '\s+', ' ', 'g'), 240), 'https://crm.speedofthespirit.dev/freigaben', 'wichtig',
      'freigabe-' || new.id,
      case when new.kind = 'dunning' then '[{"action": "approve", "title": "Senden"}, {"action": "reject", "title": "Nicht senden"}]'::jsonb
           else '[]'::jsonb end,
      case when new.kind = 'dunning' then jsonb_build_object('approval_id', new.id) else '{}'::jsonb end);
  end if;
  return new;
end $$;

create or replace function cockpit.outbox_link(p_mail crm.outbox) returns text
language sql stable set search_path = '' as $$
  select 'https://crm.speedofthespirit.dev/' || case
    when p_mail.kind = 'quote' and p_mail.quote_id is not null then 'angebot/' || p_mail.quote_id
    when p_mail.kind in ('invoice', 'dunning') and p_mail.invoice_id is not null then 'rechnung/' || p_mail.invoice_id
    else 'kunde/' || p_mail.customer_id end
$$;

-- "Mail erstellt" and "Mail verschickt" share the tag, so the second replaces the first on the phone.
create or replace function cockpit.on_crm_outbox() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform cockpit.notify_action_safe('mail-erstellt', 'Mail erstellt: ' || new.subject, 'An ' || new.to_address,
      cockpit.outbox_link(new), 'info', 'mail-erstellt-' || new.id, '[]', '{}', 'mail-' || new.id);
  elsif new.status = 'sent' and old.status is distinct from 'sent' then
    perform cockpit.notify_action_safe('mail-verschickt', 'Mail verschickt: ' || new.subject, 'An ' || new.to_address,
      cockpit.outbox_link(new), 'info', 'mail-verschickt-' || new.id, '[]', '{}', 'mail-' || new.id);
  elsif new.status = 'failed' and old.status is distinct from 'failed' then
    perform cockpit.notify_safe('crm', 'mail-fehler', 'Mail nicht verschickt: ' || new.subject,
      'An ' || new.to_address || ' · ' || left(new.error, 200),
      'https://crm.speedofthespirit.dev/einstellungen?bereich=anbindungen', 'dringend', 'outbox-' || new.id || '-' || new.attempts);
  end if;
  return new;
end $$;
drop trigger if exists cockpit_outbox on crm.outbox;
create trigger cockpit_outbox after insert or update on crm.outbox for each row execute function cockpit.on_crm_outbox();

create or replace function cockpit.on_crm_order() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_customer text; v_via text;
begin
  select c.name into v_customer from crm.customers c where c.id = new.customer_id;
  select case q.accepted_via when 'app' then 'in der App' when 'email' then 'per E-Mail' when 'phone' then 'am Telefon'
                             when 'crm' then 'im CRM' end into v_via from crm.quotes q where q.id = new.quote_id;
  perform cockpit.notify_action_safe('auftrag', 'Neuer Auftrag: ' || new.number || ' · ' || coalesce(v_customer, ''),
    new.title || coalesce(' · angenommen ' || v_via, ''), 'https://crm.speedofthespirit.dev/kunde/' || new.customer_id,
    'wichtig', 'auftrag-' || new.id);
  return new;
end $$;
drop trigger if exists cockpit_order on crm.orders;
create trigger cockpit_order after insert on crm.orders for each row execute function cockpit.on_crm_order();

create or replace function cockpit.on_crm_audit_run() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_customer text; v_link text := 'https://crm.speedofthespirit.dev/kunde/' || new.customer_id;
  v_start jsonb := jsonb_build_object('run_id', new.id);
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then return new; end if;
  select c.name into v_customer from crm.customers c where c.id = new.customer_id;
  if new.status = 'due' then
    perform cockpit.notify_action_safe('pruefung-faellig', 'Monatsprüfung fällig: ' || v_customer,
      'Monat ' || to_char(new.month, 'MM/YYYY'), v_link, 'wichtig', 'pruefung-faellig-' || new.id,
      '[{"action": "start_audit", "title": "Prüfung auslösen"}]', v_start);
  elsif new.status = 'started' then
    perform cockpit.notify_action_safe('pruefung-gestartet', 'Prüfung gestartet: ' || v_customer,
      'Monat ' || to_char(new.month, 'MM/YYYY'), v_link, 'info', 'pruefung-gestartet-' || new.id || '-' || extract(epoch from new.started_at));
  elsif new.status = 'reported' then
    perform cockpit.notify_action_safe('pruefung-fertig', 'Monatsprüfung fertig: ' || v_customer,
      'Punkte vorher ' || coalesce(crm.points(new.score_before), 'unbekannt') || ', jetzt ' || coalesce(crm.points(new.score_after), 'unbekannt'),
      v_link, 'info', 'pruefung-fertig-' || new.id || '-' || extract(epoch from new.finished_at));
  elsif new.status = 'failed' then
    perform cockpit.notify_action_safe('pruefung-fehlgeschlagen', 'Monatsprüfung fehlgeschlagen: ' || v_customer,
      'Monat ' || to_char(new.month, 'MM/YYYY'), v_link, 'dringend', 'pruefung-fehlgeschlagen-' || new.id || '-' || extract(epoch from new.finished_at),
      '[{"action": "start_audit", "title": "Erneut auslösen"}]', v_start);
  end if;
  return new;
end $$;
drop trigger if exists cockpit_audit_run on crm.audit_runs;
create trigger cockpit_audit_run after insert or update of status on crm.audit_runs
  for each row execute function cockpit.on_crm_audit_run();

create or replace function cockpit.on_crm_mail_triage() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform cockpit.notify_action_safe('mail-auswertung-fehler',
    'Mail konnte nicht gelesen werden: ' || coalesce(nullif(new.subject, ''), '(ohne Betreff)'),
    new.address || ' · ' || left(new.error, 200), 'https://crm.speedofthespirit.dev/', 'dringend',
    'mail-auswertung-fehler-' || new.id);
  return new;
end $$;
drop trigger if exists cockpit_mail_triage on crm.mail_triage;
create trigger cockpit_mail_triage after update of status on crm.mail_triage
  for each row when (new.status = 'failed' and old.status is distinct from 'failed')
  execute function cockpit.on_crm_mail_triage();

-- One notice per day while review requests wait for the link, from the trigger or the hourly check.
create or replace function cockpit.review_link_notice() returns void
language plpgsql security definer set search_path = '' as $$
declare v_waiting int;
begin
  select count(*) into v_waiting from crm.review_requests where status = 'waiting_link';
  if v_waiting > 0 then
    perform cockpit.notify_action_safe('bewertungslink-fehlt', 'Link zur Google-Bewertung fehlt',
      v_waiting || case when v_waiting = 1 then ' Bewertungsanfrage wartet' else ' Bewertungsanfragen warten' end
      || '. Bitte in den Einstellungen den Link eintragen.', 'https://crm.speedofthespirit.dev/einstellungen', 'wichtig',
      'bewertungslink-fehlt-' || cockpit.berlin_day());
  end if;
end $$;

create or replace function cockpit.on_crm_review_request() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform cockpit.review_link_notice();
  return null;
end $$;
drop trigger if exists cockpit_review_request on crm.review_requests;
create trigger cockpit_review_request after insert or update of status on crm.review_requests
  for each row when (new.status = 'waiting_link') execute function cockpit.on_crm_review_request();

-- Recurring checks: the mailbox, the mail triage of the server worker and the missing review link.
create or replace function cockpit.check_health() returns void
language plpgsql security definer set search_path = '' as $$
declare v_error text;
begin
  select string_agg(nullif(last_error, ''), ' · ') into v_error from crm.mail_sync;
  if exists (select 1 from crm.mail_sync where last_error <> '' or synced_at < now() - interval '1 hour') then
    perform cockpit.notify_safe('system', 'postfach', 'Postfach wird nicht abgerufen',
      coalesce(left(v_error, 240), 'Seit über einer Stunde kein erfolgreicher Abruf.'),
      'https://crm.speedofthespirit.dev/einstellungen?bereich=anbindungen', 'dringend', 'postfach-' || cockpit.berlin_day());
  end if;
  if exists (select 1 from crm.mail_triage where status = 'queued' and created_at < now() - interval '1 hour') then
    perform cockpit.notify_safe('system', 'mail-auswertung-stau', 'Mails werden nicht gelesen – läuft der Server?',
      'Seit über einer Stunde warten Mails auf die Auswertung durch Claude Code.',
      'https://crm.speedofthespirit.dev/', 'dringend', 'mail-auswertung-stau-' || cockpit.berlin_day());
  end if;
  perform cockpit.review_link_notice();
end $$;

-- Rights: the lock screen reaches run_action without sign-in and nothing else of the Cockpit.
grant usage on schema cockpit to anon;
revoke all on all functions in schema cockpit from public, anon;
grant execute on function cockpit.notify(text, text, text, text, text, text, text) to authenticated, service_role;
grant execute on function cockpit.notify_action(text, text, text, text, text, text, text, jsonb, jsonb, text) to authenticated, service_role;
grant execute on function cockpit.daily_brief() to authenticated, service_role;
grant execute on function cockpit.check_health() to service_role;
grant execute on function cockpit.run_action(uuid, uuid, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
