-- RepoCity Cockpit, buttons for payment suggestions of the CRM.
-- Context: builds on 002_actions.sql and crm/supabase/migrations/007_finanzen.sql, which raises an
-- approval of kind payment when an incoming bank transaction fits an invoice only in part. | Input: none.
-- | Output: cockpit.on_crm_approval with "Zuordnen" and "Nicht zuordnen" for a payment suggestion,
-- linked to the CRM page Finanzen; a reminder keeps "Senden" and "Nicht senden". Re-runnable.

create or replace function cockpit.on_crm_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'pending' then
    perform cockpit.notify_action_safe('freigabe', 'Freigabe nötig: ' || new.title,
      left(regexp_replace(new.body, '\s+', ' ', 'g'), 240),
      case when new.kind = 'payment' then 'https://crm.speedofthespirit.dev/finanzen' else 'https://crm.speedofthespirit.dev/freigaben' end,
      'wichtig', 'freigabe-' || new.id,
      case new.kind
        when 'dunning' then '[{"action": "approve", "title": "Senden"}, {"action": "reject", "title": "Nicht senden"}]'::jsonb
        when 'payment' then '[{"action": "approve", "title": "Zuordnen"}, {"action": "reject", "title": "Nicht zuordnen"}]'::jsonb
        else '[]'::jsonb end,
      case when new.kind in ('dunning', 'payment') then jsonb_build_object('approval_id', new.id) else '{}'::jsonb end);
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
