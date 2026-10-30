-- RepoCity Cockpit, fixes found by walking every business scenario end to end.
-- Context: builds on 002_actions.sql; the scenarios are listed in integration/README.md. | Input: none. |
-- Output: on_crm_outbox announces every failure of a mail, also after Daniel queued it again.
-- Re-runnable: every statement replaces or checks first.

-- The trigger fires only on the change to failed, so each notice is one failure. The former dedupe key
-- (mail id and tries) came back after "Erneut senden" reset the tries, which swallowed the next failure.
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
      'https://crm.speedofthespirit.dev/einstellungen?bereich=anbindungen', 'dringend', null);
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
