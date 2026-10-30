-- Counting reads and clicks without cookies. Context: the blog pages and the page a call to
-- action leads to report one hit per page load: host, path and the campaign parameters, nothing
-- about the reader. The metrics job folds the hits into marketing.metrics once a day.
-- Input: none. Output: table marketing.hits, function marketing.record_hit, schema exposure.

create table if not exists marketing.hits (
  id bigint generated always as identity primary key,
  day date not null default (now() at time zone 'Europe/Berlin')::date,
  host text not null,
  path text not null,
  campaign text,
  content text,
  created_at timestamptz not null default now()
);
create index if not exists hits_day on marketing.hits (day, host);

alter table marketing.hits enable row level security;
create policy operator_read on marketing.hits for select to authenticated using (true);

-- The only way an anonymous visitor writes: one row, checked fields, known hosts only.
create or replace function marketing.record_hit(p_host text, p_path text, p_campaign text default null, p_content text default null)
returns void
language plpgsql security definer set search_path = marketing, pg_temp as $$
begin
  if p_host not in ('radarauditor.speedofthespirit.dev', 'agenticmarketing.speedofthespirit.dev') then
    return;
  end if;
  if length(p_path) > 200 or length(coalesce(p_campaign, '')) > 80 or length(coalesce(p_content, '')) > 80 then
    return;
  end if;
  insert into marketing.hits (host, path, campaign, content) values (p_host, p_path, p_campaign, p_content);
end $$;

revoke all on function marketing.record_hit(text, text, text, text) from public;
grant usage on schema marketing to anon;
grant execute on function marketing.record_hit(text, text, text, text) to anon, authenticated;
grant all on marketing.hits to service_role;
grant select on marketing.hits to authenticated;

-- The REST interface serves only listed schemas; the dashboard switch for this did not reach
-- the server, so the setting is made where the server reads it.
alter role authenticator set pgrst.db_schemas = 'public, graphql_public, marketing';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
