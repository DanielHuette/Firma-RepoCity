-- RepoCity Cockpit, the buttons of an audit request from the website.
-- Context: builds on 002_actions.sql and crm/supabase/migrations/013_audit_anfragen.sql; decided with
-- Daniel on 30.10.2026 (Nova point 6): a request offers "Bestätigen", "Anderen Termin vorschlagen" and
-- "Prüfen", the proposal "Senden". | Input: none. | Output: up to three buttons per message (browsers
-- show as many as they can on the lock screen, the message centre shows all), the actions audit_confirm,
-- audit_propose, audit_send and audit_check in cockpit.valid_actions and cockpit.perform_action, and
-- no "Neuer Kunde" for a business that crm.request_audit takes in, because its "Audit-Anfrage" says it
-- all. Re-runnable; 002_actions.sql carries the same versions, so running it again keeps them.

alter table cockpit.messages drop constraint if exists messages_actions_check;
alter table cockpit.messages add constraint messages_actions_check
  check (jsonb_typeof(actions) = 'array' and jsonb_array_length(actions) <= 3);

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

notify pgrst, 'reload schema';
