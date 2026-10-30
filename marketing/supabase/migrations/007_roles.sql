-- Roles in the marketing app: the administrator decides, everyone else who signs in only reads.
-- Context: builds on public.is_admin() from the RadarAuditor migration 005_roles.sql in the same
-- project; the scheduled jobs use the service key and are not affected. Migration 005_planer
-- replaced start_campaign without the administrator check; this puts it back on top of the
-- planner version. | Input: migrations 001-006. | Output: read and write policies per table,
-- start and pause refused for readers. Running the file twice changes nothing.

do $$
declare t text;
begin
  foreach t in array array['campaigns', 'findings', 'posts', 'post_findings', 'events', 'metrics'] loop
    if exists (select 1 from pg_policies where schemaname = 'marketing' and tablename = t and policyname = 'operator_all') then
      execute format('drop policy operator_all on marketing.%I', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'marketing' and tablename = t and policyname = 'reader_select') then
      execute format('create policy reader_select on marketing.%I for select to authenticated using (true)', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'marketing' and tablename = t and policyname = 'admin_write') then
      execute format('create policy admin_write on marketing.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
    end if;
  end loop;
end $$;

create or replace function marketing.start_campaign(p_campaign uuid) returns marketing.campaigns
language plpgsql as $$
declare c marketing.campaigns;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'read only: only the administrator may %', 'start a campaign';
  end if;
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

create or replace function marketing.pause_campaign(p_campaign uuid) returns marketing.campaigns
language plpgsql as $$
declare c marketing.campaigns;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'read only: only the administrator may %', 'pause a campaign';
  end if;
  update marketing.campaigns set status = 'paused' where id = p_campaign and status = 'running' returning * into c;
  if c.id is null then
    raise exception 'campaign % is not running', p_campaign;
  end if;
  update marketing.posts set scheduled_for = null
   where campaign_id = c.id and status = 'approved';
  insert into marketing.events (campaign_id, kind, actor) values (c.id, 'paused', coalesce(auth.uid()::text, 'system'));
  return c;
end $$;
