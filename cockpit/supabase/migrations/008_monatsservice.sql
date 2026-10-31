-- RepoCity Cockpit, the notice of the monthly service.
-- Context: builds on 002_actions.sql and radarauditor/supabase/migrations/016_kundensuche_monatsservice.sql.
-- A reported monthly audit queues an optimize job on the order of the subscription; when it has stored
-- its drafts (replies to new reviews, profile care), the RadarAuditor writes the event
-- optimization.drafted with purpose monthly. Daniel gets one notice with a link to the drafts of the
-- order in the RadarAuditor app, where he approves or rejects each one; the notice has no buttons,
-- because a draft is only decided after reading it in full. | Input: none. | Output: function
-- cockpit.on_monthly_drafts and its trigger on public.events. Re-runnable.

create or replace function cockpit.on_monthly_drafts() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_drafts int := coalesce((new.payload ->> 'drafts')::int, 0);
  v_customer text;
  v_quote uuid;
begin
  if new.payload ->> 'purpose' is distinct from 'monthly' or v_drafts < 1 then
    return new;
  end if;
  select c.name, o.quote_id into v_customer, v_quote
    from crm.orders o join crm.customers c on c.id = o.customer_id
   where o.id = (new.payload ->> 'order_id')::uuid;
  perform cockpit.notify_safe('crm', 'monatsservice',
    'Monatsservice: ' || v_drafts || case when v_drafts = 1 then ' Entwurf' else ' Entwürfe' end
      || ' für ' || coalesce(v_customer, 'einen Kunden'),
    'Antworten auf neue Bewertungen und Vorschläge zur Profilpflege. Jeder Entwurf wird erst nach deiner Freigabe umgesetzt.',
    'https://app.radarauditor.speedofthespirit.dev/angebot/' || (new.payload ->> 'audit_id')
      || coalesce('?angebot=' || v_quote::text, ''),
    'wichtig', 'monatsservice-' || (new.payload ->> 'job_id'));
  return new;
exception when others then
  raise warning 'cockpit.on_monthly_drafts failed: %', sqlerrm;
  return new;
end $$;

drop trigger if exists cockpit_monthly_drafts on public.events;
create trigger cockpit_monthly_drafts after insert on public.events
  for each row when (new.kind = 'optimization.drafted') execute function cockpit.on_monthly_drafts();

revoke all on function cockpit.on_monthly_drafts() from public, anon, authenticated;
