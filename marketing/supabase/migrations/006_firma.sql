-- RepoCity runs its own marketing: nothing is published automatically any more, every channel
-- including the blog is posted by hand from the planner, and the portfolio campaign about
-- RadarAuditor waits as drafts for the new company accounts. No row is deleted.
-- Input: none. | Output: reminders for every channel, the RadarAuditor campaign back in draft.

-- Every hour: approved posts whose moment has come; every channel is posted by hand.
create or replace function marketing.remind_due() returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  for r in
    select p.id, p.title, p.channel from marketing.posts p join marketing.campaigns c on c.id = p.campaign_id
     where not c.is_example and p.status = 'approved'
       and coalesce(p.scheduled_for, p.planned_for) <= now()
  loop
    perform cockpit.notify_safe('marketing', 'jetzt-posten', 'Jetzt posten: ' || r.title,
      marketing.channel_label(r.channel) || ' · Text kopieren, posten, dann als gepostet markieren',
      'https://app.agenticmarketing.speedofthespirit.dev/beitrag/' || r.id, 'wichtig', 'posten-' || r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

update marketing.campaigns set status = 'draft'
 where slug = 'radarauditor-sichtbarkeit-muenster' and status in ('ready', 'paused');

update marketing.posts set status = 'draft'
 where campaign_id = (select id from marketing.campaigns where slug = 'radarauditor-sichtbarkeit-muenster')
   and status in ('review', 'approved');
