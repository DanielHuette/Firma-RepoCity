-- Planner for every channel. Context: besides the campaigns, RepoCity posts daily on many
-- channels; the planner shows all posts on a calendar and new posts get a date of their own.
-- Only blog posts are published by the machine; every other channel is posted by hand when
-- due, so the scheduled publishing time stays reserved for blog and LinkedIn as before.
-- Input: none. | Output: more channels, marketing.posts.planned_for, the standing campaign
-- "laufend", the view marketing.plan and the reports to the Cockpit.

alter type marketing.channel add value if not exists 'x';
alter type marketing.channel add value if not exists 'xing';
alter type marketing.channel add value if not exists 'instagram';
alter type marketing.channel add value if not exists 'facebook';
alter type marketing.channel add value if not exists 'threads';
alter type marketing.channel add value if not exists 'youtube';
alter type marketing.channel add value if not exists 'tiktok';
alter type marketing.channel add value if not exists 'reddit';
alter type marketing.channel add value if not exists 'forum';
alter type marketing.channel add value if not exists 'presse';
alter type marketing.channel add value if not exists 'newsletter';

-- The moment chosen in the planner; it wins over the day offset of the campaign.
alter table marketing.posts add column if not exists planned_for timestamptz;

create or replace function marketing.schedule_on_approval() returns trigger
language plpgsql as $$
declare c marketing.campaigns;
begin
  if new.status = 'approved' and (old.status is distinct from 'approved') then
    if cardinality(new.unbacked_figures) > 0 then
      raise exception 'post % has figures without a checked source: %', new.slug, new.unbacked_figures;
    end if;
    select * into c from marketing.campaigns where id = new.campaign_id;
    if new.channel::text in ('blog', 'linkedin') and c.status = 'running' and new.scheduled_for is null then
      new.scheduled_for := greatest(now(), coalesce(new.planned_for, marketing.publish_moment(c.started_at, new.day_offset, c.publish_time)));
    end if;
  end if;
  if new.status in ('draft', 'review', 'rejected') then
    new.scheduled_for := null;
  end if;
  -- A new date for an approved blog or LinkedIn post moves its publishing time with it.
  if new.status = 'approved' and new.planned_for is distinct from old.planned_for and new.channel::text in ('blog', 'linkedin') and new.planned_for is not null then
    new.scheduled_for := greatest(now(), new.planned_for);
  end if;
  if new.body_md is distinct from old.body_md or new.title is distinct from old.title then
    new.version := old.version + 1;
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function marketing.start_campaign(p_campaign uuid) returns marketing.campaigns
language plpgsql as $$
declare c marketing.campaigns;
begin
  update marketing.campaigns
     set status = 'running', started_at = coalesce(started_at, now())
   where id = p_campaign and status in ('ready', 'paused')
  returning * into c;
  if c.id is null then
    raise exception 'campaign % is not ready to start', p_campaign;
  end if;
  update marketing.posts
     set scheduled_for = greatest(now(), coalesce(planned_for, marketing.publish_moment(c.started_at, day_offset, c.publish_time)))
   where campaign_id = c.id and status = 'approved' and scheduled_for is null and channel::text in ('blog', 'linkedin');
  insert into marketing.events (campaign_id, kind, actor) values (c.id, 'started', coalesce(auth.uid()::text, 'system'));
  return c;
end $$;

-- Posts that belong to no campaign live in one standing campaign that always runs.
insert into marketing.campaigns (slug, title, product, goal, audience, target, status, duration_days, started_at)
values ('laufend', 'Laufender Auftritt', 'RepoCity', 'Bekannt werden: täglich auf den passenden Kanälen präsent sein',
        'Betriebe, Selbstständige und Privatkunden', 'radarauditor', 'running', 365, now())
on conflict (slug) do nothing;

-- One row per post with the moment it appears on the calendar: when it went out, when it is
-- scheduled, the date chosen in the planner, or the day derived from a started campaign.
create or replace view marketing.plan with (security_invoker = true) as
select p.id, p.campaign_id, c.slug as campaign_slug, c.title as campaign_title, p.channel, p.title, p.summary,
       p.status, p.unbacked_figures, p.url, p.planned_for, p.scheduled_for, p.published_at,
       coalesce(p.published_at, p.scheduled_for, p.planned_for,
         case when c.started_at is not null then marketing.publish_moment(c.started_at, p.day_offset, c.publish_time) end) as moment
  from marketing.posts p
  join marketing.campaigns c on c.id = p.campaign_id
 where not c.is_example;

create or replace function marketing.channel_label(p marketing.channel) returns text
language sql immutable set search_path = '' as $$
  select case p::text when 'blog' then 'Blog' when 'linkedin' then 'LinkedIn' when 'x' then 'X' when 'xing' then 'XING'
    when 'instagram' then 'Instagram' when 'facebook' then 'Facebook' when 'threads' then 'Threads' when 'youtube' then 'YouTube'
    when 'tiktok' then 'TikTok' when 'reddit' then 'Reddit' when 'forum' then 'Forum' when 'presse' then 'Presse'
    when 'newsletter' then 'Newsletter' else p::text end
$$;

-- Reports to the Cockpit: a post waiting for approval, and a post that is due to be posted by
-- hand. Example campaigns stay quiet. A failing report never blocks the change of the post.
create or replace function marketing.report_to_cockpit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_example boolean;
begin
  select is_example into v_example from marketing.campaigns where id = new.campaign_id;
  if coalesce(v_example, true) then
    return new;
  end if;
  if new.status = 'review' and (tg_op = 'INSERT' or old.status is distinct from 'review' or old.version is distinct from new.version) then
    perform cockpit.notify_safe('marketing', 'freigabe', 'Beitrag zur Freigabe: ' || new.title,
      marketing.channel_label(new.channel) || coalesce(' · geplant ' || to_char(new.planned_for at time zone 'Europe/Berlin', 'DD.MM. HH24:MI') || ' Uhr', ''),
      'https://app.agenticmarketing.speedofthespirit.dev/beitrag/' || new.id, 'wichtig', 'beitrag-' || new.id || '-v' || new.version);
  end if;
  if new.status = 'published' and old.status is distinct from 'published' then
    perform cockpit.notify_safe('marketing', 'veroeffentlicht', 'Veröffentlicht: ' || new.title,
      marketing.channel_label(new.channel) || coalesce(' · ' || new.url, ''),
      'https://app.agenticmarketing.speedofthespirit.dev/beitrag/' || new.id, 'info', 'veroeffentlicht-' || new.id);
  end if;
  return new;
end $$;

drop trigger if exists posts_report_to_cockpit on marketing.posts;
create trigger posts_report_to_cockpit after insert or update on marketing.posts
for each row execute function marketing.report_to_cockpit();

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

grant select on marketing.plan to authenticated, service_role;
revoke all on function marketing.report_to_cockpit() from public, anon;
revoke all on function marketing.remind_due() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'marketing-remind';
select cron.schedule('marketing-remind', '23 * * * *', $job$ select marketing.remind_due(); $job$);

notify pgrst, 'reload schema';
