-- RepoCity Cockpit, today's appointments in the morning brief and buttons for follow-ups and mails.
-- Context: builds on 005_reversal_buttons.sql and crm migrations 009 (appointments), 010 (follow-up
-- mails) and 012 (mails drafted by the assistant). | Input: none. | Output: cockpit.daily_brief names
-- the day's appointments; cockpit.on_crm_approval gives follow-ups "Senden" and "Nicht senden"; a mail
-- the assistant drafted links to the CRM page Freigaben, where its whole text stands. Re-runnable.

create or replace function cockpit.daily_brief() returns uuid
language plpgsql security definer set search_path = '' as $$
declare o jsonb; v_lines text[] := '{}'; v_title text; v_today int;
begin
  o := crm.today_overview();
  v_today := coalesce((o ->> 'appointments_today')::int, 0);
  if v_today > 0 then
    v_lines := v_lines || (case v_today when 1 then '1 Termin heute: ' else v_today || ' Termine heute: ' end
      || (select string_agg(t, ', ') from jsonb_array_elements_text(o -> 'appointments_today_list') t));
  end if;
  if (o ->> 'pending_approvals')::int > 0 then v_lines := v_lines || ((o ->> 'pending_approvals') || ' Freigaben offen'); end if;
  if (o ->> 'unknown_senders')::int > 0 then v_lines := v_lines || ((o ->> 'unknown_senders') || ' unbekannte Absender'); end if;
  if (o ->> 'new_inquiries')::int > 0 then v_lines := v_lines || ((o ->> 'new_inquiries') || ' neue Anfragen'); end if;
  if (o ->> 'overdue_invoices')::int > 0 then v_lines := v_lines || ((o ->> 'overdue_invoices') || ' Rechnungen überfällig'); end if;
  if (o ->> 'tasks_due')::int > 0 then v_lines := v_lines || ((o ->> 'tasks_due') || ' Aufgaben fällig'); end if;
  if (o ->> 'open_tickets')::int > 0 then v_lines := v_lines || ((o ->> 'open_tickets') || ' Service-Fälle offen'); end if;
  v_lines := v_lines || ('Offene Forderungen ' || cockpit.euro((o ->> 'receivables')::numeric) || ' €');
  v_lines := v_lines || ('Eingang im Monat ' || cockpit.euro((o ->> 'paid_this_month')::numeric) || ' €');
  v_title := case array_length(v_lines, 1) - 2 when 0 then 'Guten Morgen – alles ruhig' when 1 then 'Guten Morgen – 1 Punkt wartet'
    else 'Guten Morgen – ' || (array_length(v_lines, 1) - 2) || ' Punkte warten' end;
  return cockpit.notify('system', 'tagesueberblick', v_title, array_to_string(v_lines, ' · '),
    '/', 'info', 'tag-' || to_char(now() at time zone 'Europe/Berlin', 'YYYY-MM-DD'));
end $$;

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
        when 'follow_up' then '[{"action": "approve", "title": "Senden"}, {"action": "reject", "title": "Nicht senden"}]'::jsonb
        when 'payment' then '[{"action": "approve", "title": "Zuordnen"}, {"action": "reject", "title": "Nicht zuordnen"}]'::jsonb
        when 'reversal' then '[{"action": "approve", "title": "Verrechnen"}, {"action": "reject", "title": "Nicht verrechnen"}]'::jsonb
        else '[]'::jsonb end,
      -- A mail Claude Code drafted has no buttons here: it is read in full and sent on the CRM page Freigaben.
      case when new.kind in ('dunning', 'follow_up', 'payment', 'reversal') then jsonb_build_object('approval_id', new.id)
           else '{}'::jsonb end);
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
