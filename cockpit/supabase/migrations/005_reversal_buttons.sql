-- RepoCity Cockpit, buttons for reversals of the CRM.
-- Context: builds on 004_payment_buttons.sql and crm/supabase/migrations/008_rueckbuchung_belege.sql,
-- which raises an approval of kind reversal when a reversal on the bank statement clearly takes back
-- one earlier booking; Daniel decided on 30.10.2026 that a reversal is netted only after his tap. |
-- Input: none. | Output: cockpit.on_crm_approval with "Verrechnen" and "Nicht verrechnen" for a
-- reversal, linked to the CRM page Finanzen; reminders and payment suggestions keep their buttons.
-- Re-runnable.

create or replace function cockpit.on_crm_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'pending' then
    perform cockpit.notify_action_safe('freigabe', 'Freigabe nötig: ' || new.title,
      left(regexp_replace(new.body, '\s+', ' ', 'g'), 240),
      case when new.kind in ('payment', 'reversal') then 'https://crm.speedofthespirit.dev/finanzen' else 'https://crm.speedofthespirit.dev/freigaben' end,
      'wichtig', 'freigabe-' || new.id,
      case new.kind
        when 'dunning' then '[{"action": "approve", "title": "Senden"}, {"action": "reject", "title": "Nicht senden"}]'::jsonb
        when 'payment' then '[{"action": "approve", "title": "Zuordnen"}, {"action": "reject", "title": "Nicht zuordnen"}]'::jsonb
        when 'reversal' then '[{"action": "approve", "title": "Verrechnen"}, {"action": "reject", "title": "Nicht verrechnen"}]'::jsonb
        else '[]'::jsonb end,
      case when new.kind in ('dunning', 'payment', 'reversal') then jsonb_build_object('approval_id', new.id) else '{}'::jsonb end);
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
