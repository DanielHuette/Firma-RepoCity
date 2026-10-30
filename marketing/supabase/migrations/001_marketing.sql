-- Marketing cockpit schema. Context: campaigns, their checked findings, posts, approvals and
-- measured results; the app reads and decides, the scheduled jobs publish and measure.
-- Input: none. Output: schema `marketing`, enums, tables, functions, row level security.

create schema if not exists marketing;

create type marketing.campaign_status as enum ('draft', 'ready', 'running', 'paused', 'done');
create type marketing.post_status as enum ('draft', 'review', 'approved', 'published', 'rejected');
create type marketing.channel as enum ('blog', 'linkedin');
create type marketing.verdict as enum ('supported', 'partial', 'unsupported', 'unreachable', 'not-checked');
create type marketing.metric_source as enum ('cloudflare', 'manual', 'simulated');

create table marketing.campaigns (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,}$'),
  title text not null,
  product text not null,
  goal text not null,
  audience text not null,
  target text not null,
  status marketing.campaign_status not null default 'draft',
  is_example boolean not null default false,
  duration_days integer not null default 28 check (duration_days between 1 and 365),
  publish_time time not null default '09:00',
  kpi jsonb not null default '{}',
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create table marketing.findings (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  key text not null,
  statement text not null,
  detail text not null,
  figures text[] not null default '{}',
  source_url text,
  source_publisher text not null,
  source_title text not null,
  source_published date,
  verdict marketing.verdict not null default 'not-checked',
  evidence text,
  checked_on date,
  unique (campaign_id, key)
);

create table marketing.posts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  channel marketing.channel not null,
  slug text not null check (slug ~ '^[a-z0-9-]{3,}$'),
  title text not null,
  summary text not null default '',
  body_md text not null,
  day_offset integer not null default 0 check (day_offset >= 0),
  status marketing.post_status not null default 'draft',
  unbacked_figures text[] not null default '{}',
  scheduled_for timestamptz,
  published_at timestamptz,
  url text,
  review_note text,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  unique (campaign_id, channel, slug)
);

create table marketing.post_findings (
  post_id uuid not null references marketing.posts(id) on delete cascade,
  finding_id uuid not null references marketing.findings(id) on delete cascade,
  primary key (post_id, finding_id)
);

create table marketing.events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  post_id uuid references marketing.posts(id) on delete cascade,
  kind text not null,
  actor text not null,
  note text,
  created_at timestamptz not null default now()
);
create index events_campaign on marketing.events (campaign_id, created_at desc);

create table marketing.metrics (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references marketing.posts(id) on delete cascade,
  day date not null,
  views integer not null default 0 check (views >= 0),
  clicks integer not null default 0 check (clicks >= 0),
  leads integer not null default 0 check (leads >= 0),
  source marketing.metric_source not null,
  unique (post_id, day, source)
);

create table marketing.reports (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  period_end date not null,
  body_md text not null,
  created_at timestamptz not null default now(),
  unique (campaign_id, period_end)
);

-- The moment a post goes out is derived from the campaign start, so a campaign prepared weeks
-- ahead needs no dates edited when it finally starts.
create or replace function marketing.publish_moment(p_started timestamptz, p_offset integer, p_time time)
returns timestamptz
language sql stable as $$
  select ((p_started at time zone 'Europe/Berlin')::date + p_offset + p_time) at time zone 'Europe/Berlin'
$$;

create or replace function marketing.schedule_on_approval() returns trigger
language plpgsql as $$
declare c marketing.campaigns;
begin
  if new.status = 'approved' and (old.status is distinct from 'approved') then
    if cardinality(new.unbacked_figures) > 0 then
      raise exception 'post % has figures without a checked source: %', new.slug, new.unbacked_figures;
    end if;
    select * into c from marketing.campaigns where id = new.campaign_id;
    if c.status = 'running' and new.scheduled_for is null then
      new.scheduled_for := greatest(now(), marketing.publish_moment(c.started_at, new.day_offset, c.publish_time));
    end if;
  end if;
  if new.status in ('draft', 'review', 'rejected') then
    new.scheduled_for := null;
  end if;
  if new.body_md is distinct from old.body_md or new.title is distinct from old.title then
    new.version := old.version + 1;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger posts_schedule before update on marketing.posts
for each row execute function marketing.schedule_on_approval();

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
     set scheduled_for = greatest(now(), marketing.publish_moment(c.started_at, day_offset, c.publish_time))
   where campaign_id = c.id and status = 'approved' and scheduled_for is null;
  insert into marketing.events (campaign_id, kind, actor) values (c.id, 'started', coalesce(auth.uid()::text, 'system'));
  return c;
end $$;

create or replace function marketing.pause_campaign(p_campaign uuid) returns marketing.campaigns
language plpgsql as $$
declare c marketing.campaigns;
begin
  update marketing.campaigns set status = 'paused' where id = p_campaign and status = 'running' returning * into c;
  if c.id is null then
    raise exception 'campaign % is not running', p_campaign;
  end if;
  update marketing.posts set scheduled_for = null
   where campaign_id = c.id and status = 'approved';
  insert into marketing.events (campaign_id, kind, actor) values (c.id, 'paused', coalesce(auth.uid()::text, 'system'));
  return c;
end $$;

create view marketing.campaign_overview with (security_invoker = true) as
select c.id, c.slug, c.title, c.status, c.is_example, c.started_at,
       count(p.id) filter (where p.status = 'review') as in_review,
       count(p.id) filter (where p.status = 'approved') as approved,
       count(p.id) filter (where p.status = 'published') as published,
       count(p.id) as posts,
       coalesce((select sum(m.views) from marketing.metrics m join marketing.posts mp on mp.id = m.post_id where mp.campaign_id = c.id), 0) as views,
       coalesce((select sum(m.clicks) from marketing.metrics m join marketing.posts mp on mp.id = m.post_id where mp.campaign_id = c.id), 0) as clicks,
       coalesce((select sum(m.leads) from marketing.metrics m join marketing.posts mp on mp.id = m.post_id where mp.campaign_id = c.id), 0) as leads
  from marketing.campaigns c
  left join marketing.posts p on p.campaign_id = c.id
 group by c.id;

-- One operator account signs in; sign-ups are switched off in the dashboard, so every
-- authenticated user is that operator. The scheduled jobs use the service key.
alter table marketing.campaigns enable row level security;
alter table marketing.findings enable row level security;
alter table marketing.posts enable row level security;
alter table marketing.post_findings enable row level security;
alter table marketing.events enable row level security;
alter table marketing.metrics enable row level security;
alter table marketing.reports enable row level security;

create policy operator_all on marketing.campaigns for all to authenticated using (true) with check (true);
create policy operator_all on marketing.findings for all to authenticated using (true) with check (true);
create policy operator_all on marketing.posts for all to authenticated using (true) with check (true);
create policy operator_all on marketing.post_findings for all to authenticated using (true) with check (true);
create policy operator_all on marketing.events for all to authenticated using (true) with check (true);
create policy operator_all on marketing.metrics for all to authenticated using (true) with check (true);
create policy operator_read on marketing.reports for select to authenticated using (true);

grant usage on schema marketing to authenticated, service_role;
grant all on all tables in schema marketing to authenticated, service_role;
grant execute on all functions in schema marketing to authenticated, service_role;
