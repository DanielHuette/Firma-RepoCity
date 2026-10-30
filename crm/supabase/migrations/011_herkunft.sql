-- RepoCity CRM, where customers come from: channel and campaign.
-- Context: builds on 001-010; decided with Daniel on 30.10.2026 (Nova point 5): next to the coarse
-- source (website, phone, mail, ...) every customer and inquiry gets a channel (Google search, Google
-- Maps, LinkedIn, Instagram, Facebook, Xing, YouTube, TikTok, X, Threads, Reddit, forum, newsletter,
-- referral, other; the last social channels are those the marketing app posts to) and the campaign of
-- the link. Links of the marketing app carry utm_source, utm_medium and utm_campaign; the website form
-- hands them on; the contact mail names the channel in its subject ("Anfrage – über LinkedIn
-- (kampagne)"); the phone assistant asks. A customer keeps the channel of the first contact. |
-- Input: the parameters of the form, mail subjects, the phone assistant's answer. | Output: columns
-- channel and campaign of crm.customers, source_channel and campaign of crm.inquiries,
-- crm.channel_from, crm.channel_from_subject, crm.source_channel_label, crm.channel_report, new
-- versions of crm.submit_inquiry, crm.intake_contact and crm.intake_call. Re-runnable.

-- Columns

alter table crm.customers add column if not exists channel text;
alter table crm.customers add column if not exists campaign text not null default '';
alter table crm.inquiries add column if not exists source_channel text;
alter table crm.inquiries add column if not exists campaign text not null default '';

create or replace function crm.is_channel(p_channel text) returns boolean
language sql immutable as $$
  select p_channel in ('google_search', 'google_maps', 'linkedin', 'instagram', 'facebook', 'xing', 'youtube', 'tiktok',
                       'x', 'threads', 'reddit', 'forum', 'newsletter', 'referral', 'other')
$$;

alter table crm.customers drop constraint if exists customers_channel_check;
alter table crm.customers add constraint customers_channel_check check (channel is null or crm.is_channel(channel));
alter table crm.customers drop constraint if exists customers_campaign_check;
alter table crm.customers add constraint customers_campaign_check check (length(campaign) <= 100);
alter table crm.inquiries drop constraint if exists inquiries_source_channel_check;
alter table crm.inquiries add constraint inquiries_source_channel_check check (source_channel is null or crm.is_channel(source_channel));
alter table crm.inquiries drop constraint if exists inquiries_campaign_check;
alter table crm.inquiries add constraint inquiries_campaign_check check (length(campaign) <= 100);
create index if not exists customers_channel on crm.customers (channel);

-- Words

create or replace function crm.source_channel_label(p_channel text) returns text
language sql immutable as $$
  select case p_channel
    when 'google_search' then 'Google-Suche' when 'google_maps' then 'Google Maps' when 'linkedin' then 'LinkedIn'
    when 'instagram' then 'Instagram' when 'facebook' then 'Facebook' when 'xing' then 'Xing' when 'youtube' then 'YouTube'
    when 'tiktok' then 'TikTok' when 'x' then 'X' when 'threads' then 'Threads' when 'reddit' then 'Reddit'
    when 'forum' then 'Forum' when 'newsletter' then 'Newsletter' when 'referral' then 'Empfehlung'
    when 'other' then 'Sonstiges' else 'Unbekannt' end
$$;

-- utm_source and utm_medium of a link; null when the link carried none.
create or replace function crm.channel_from(p_source text, p_medium text) returns text
language sql immutable as $$
  select case
    when v_source = '' then null
    when v_source = 'google' and v_medium in ('maps', 'map', 'gbp', 'local', 'google_maps', 'business_profile') then 'google_maps'
    when v_source = 'google' then 'google_search'
    when v_source in ('linkedin', 'li') then 'linkedin'
    when v_source in ('instagram', 'ig') then 'instagram'
    when v_source in ('facebook', 'fb') then 'facebook'
    when v_source = 'xing' then 'xing'
    when v_source in ('youtube', 'yt') then 'youtube'
    when v_source = 'tiktok' then 'tiktok'
    when v_source in ('x', 'twitter') then 'x'
    when v_source = 'threads' then 'threads'
    when v_source = 'reddit' then 'reddit'
    when v_source = 'forum' then 'forum'
    when v_source = 'newsletter' or v_medium = 'email' then 'newsletter'
    when v_source in ('empfehlung', 'referral') then 'referral'
    else 'other' end
  from (select lower(btrim(coalesce(p_source, ''))) as v_source, lower(btrim(coalesce(p_medium, ''))) as v_medium) v
$$;

-- "Anfrage – über LinkedIn (sichtbarkeit-muenster)" as the websites write it: channel and campaign; the
-- last "Anfrage – über" counts, so a subject the visitor wrote before it, or a Re:, does not hide the
-- channel, and an ordinary subject with "über" names none.
create or replace function crm.channel_from_subject(p_subject text, out channel text, out campaign text)
language sql immutable as $$
  select (select c from unnest(array['google_search', 'google_maps', 'linkedin', 'instagram', 'facebook', 'xing', 'youtube',
                                      'tiktok', 'x', 'threads', 'reddit', 'forum', 'newsletter', 'referral', 'other']) c
           where lower(crm.source_channel_label(c)) = lower(btrim(m[1]))),
         coalesce(m[2], '')
    from (select regexp_match(coalesce(p_subject, ''), '^.*Anfrage\s+[–-]\s+über\s+([^()]+?)\s*(?:\(([a-z0-9-]{1,100})\))?\s*$', 'i') as m) s
$$;

-- The first channel of a customer stays; every inquiry keeps its own.
create or replace function crm.note_channel(p_customer uuid, p_inquiry uuid, p_channel text, p_campaign text) returns void
language plpgsql as $$
declare v_campaign text := left(btrim(coalesce(p_campaign, '')), 100);
begin
  if p_channel is null then return; end if;
  update crm.customers set channel = p_channel, campaign = v_campaign where id = p_customer and channel is null;
  update crm.inquiries set source_channel = p_channel, campaign = v_campaign where id = p_inquiry;
end $$;

-- Entry points

drop function if exists crm.submit_inquiry(text, text, text, text, text, text);
create or replace function crm.submit_inquiry(
  p_name text, p_email text, p_phone text default '', p_company text default '',
  p_message text default '', p_source text default '',
  p_utm_source text default '', p_utm_medium text default '', p_utm_campaign text default ''
) returns uuid
language plpgsql security definer set search_path = crm, public as $$
declare
  v_customer uuid;
  v_inquiry uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(nullif(btrim(p_company), ''), p_name, ''));
begin
  if length(v_name) < 2 or length(v_name) > 200 then raise exception 'Bitte einen Namen angeben.'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 200 then raise exception 'Bitte eine gültige E-Mail-Adresse angeben.'; end if;
  if length(coalesce(p_message, '')) > 5000 or length(coalesce(p_phone, '')) > 60 then raise exception 'Eingabe zu lang.'; end if;
  if length(coalesce(p_utm_source, '')) > 100 or length(coalesce(p_utm_medium, '')) > 100 or length(coalesce(p_utm_campaign, '')) > 100 then
    raise exception 'Eingabe zu lang.';
  end if;
  if (select count(*) from crm.inquiries i join crm.customers c on c.id = i.customer_id
       where lower(c.email) = v_email and i.created_at > now() - interval '1 day') >= 5 then
    raise exception 'Zu viele Anfragen von dieser Adresse. Bitte morgen erneut versuchen.';
  end if;

  select id into v_customer from crm.customers where lower(email) = v_email;
  if v_customer is null then
    insert into crm.customers (kind, name, contact_person, email, phone, source)
    values (case when btrim(coalesce(p_company, '')) = '' then 'person' else 'company' end,
            v_name, case when btrim(coalesce(p_company, '')) = '' then '' else btrim(coalesce(p_name, '')) end,
            v_email, btrim(coalesce(p_phone, '')), 'website')
    returning id into v_customer;
  end if;

  insert into crm.inquiries (customer_id, channel, subject, message)
  values (v_customer, 'website', left(coalesce(nullif(btrim(p_source), ''), 'Kontaktformular'), 200), coalesce(p_message, ''))
  returning id into v_inquiry;
  perform crm.note_channel(v_customer, v_inquiry, crm.channel_from(p_utm_source, p_utm_medium), p_utm_campaign);
  perform crm.log(v_customer, 'Anfrage über das Kontaktformular eingegangen.');
  insert into crm.tasks (title, customer_id, origin) values ('Anfrage von ' || v_name || ' beantworten', v_customer, 'system');
  return v_inquiry;
end $$;

create or replace function crm.intake_contact(p_channel text, p_email text, p_name text, p_company text default '',
  p_phone text default '', p_subject text default null, p_message text default null) returns uuid
language plpgsql as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_customer uuid;
  v_inquiry uuid;
  v_name text;
  v_source text := case when p_channel in ('website', 'phone', 'email', 'agent', 'referral') then p_channel else 'other' end;
  v_from record;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Ungültige E-Mail-Adresse.'; end if;
  select id into v_customer from crm.customers where lower(email) = v_email;
  if v_customer is null then
    v_name := left(coalesce(nullif(btrim(p_company), ''), nullif(btrim(p_name), ''), split_part(v_email, '@', 1)), 200);
    insert into crm.customers (kind, name, contact_person, email, phone, source, mail_backfilled)
    values (case when btrim(coalesce(p_company, '')) = '' then 'person' else 'company' end, v_name,
            case when btrim(coalesce(p_company, '')) = '' then '' else left(btrim(coalesce(p_name, '')), 200) end,
            v_email, left(btrim(coalesce(p_phone, '')), 60), v_source, false)
    returning id into v_customer;
    perform crm.log(v_customer, 'Kunde automatisch angelegt (' || case v_source when 'email' then 'E-Mail' when 'phone' then 'Telefon'
                                when 'website' then 'Webseite' else 'Agent' end || ').', 'system', 'Aufnahme');
  end if;
  if p_subject is not null then
    insert into crm.inquiries (customer_id, channel, subject, message)
    values (v_customer, case when v_source in ('website', 'phone', 'email', 'agent', 'referral') then v_source else 'other' end,
            left(coalesce(nullif(btrim(p_subject), ''), 'Anfrage'), 200), left(coalesce(p_message, ''), 5000))
    returning id into v_inquiry;
    v_from := crm.channel_from_subject(p_subject);
    perform crm.note_channel(v_customer, v_inquiry, v_from.channel, v_from.campaign);
    insert into crm.tasks (title, customer_id, origin)
    values ('Anfrage von ' || (select name from crm.customers where id = v_customer) || ' beantworten', v_customer, 'agent');
  end if;
  return v_customer;
end $$;

-- p_channel: what the caller answered to "Wie sind Sie auf uns aufmerksam geworden?", one of
-- crm.is_channel or empty.
drop function if exists crm.intake_call(text, text, text, text, text, text);
create or replace function crm.intake_call(p_caller_number text, p_name text, p_company text, p_email text,
  p_subject text, p_message text, p_channel text default '') returns uuid
language plpgsql as $$
declare
  v_caller text := nullif(btrim(coalesce(p_caller_number, '')), '');
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_valid boolean;
  v_message text := coalesce(p_message, '');
  v_subject text := left(coalesce(nullif(btrim(p_subject), ''), 'Anruf'), 200);
  v_customer uuid;
  v_inquiry uuid;
begin
  v_valid := v_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(v_email) <= 200;
  if v_email <> '' and not v_valid then
    v_message := v_message || E'\n\nE-Mail-Adresse laut Anruf, nicht erkannt: ' || left(btrim(p_email), 200);
  end if;
  v_customer := crm.customer_by_phone(v_caller);
  if v_customer is null and v_valid then select id into v_customer from crm.customers where lower(email) = v_email; end if;
  if v_customer is null then
    v_customer := crm.add_phone_customer(v_caller, p_name, p_company, case when v_valid then v_email end);
  end if;
  insert into crm.inquiries (customer_id, channel, subject, message) values (v_customer, 'phone', v_subject, left(v_message, 5000))
  returning id into v_inquiry;
  if coalesce(crm.is_channel(nullif(btrim(p_channel), '')), false) then
    perform crm.note_channel(v_customer, v_inquiry, btrim(p_channel), '');
  end if;
  -- A callback this call already booked (crm.callback_from_call) gets the customer and replaces the task.
  update crm.appointments set customer_id = v_customer
   where kind = 'callback' and origin = 'phone' and customer_id is null and created_at > now() - interval '30 minutes'
     and crm.phone_key(caller_number) = crm.phone_key(v_caller);
  if not exists (select 1 from crm.appointments where kind = 'callback' and origin = 'phone' and customer_id = v_customer
                  and status = 'planned' and created_at > now() - interval '30 minutes') then
    insert into crm.tasks (title, customer_id, origin)
    values (left('Rückruf ' || coalesce(nullif(btrim(p_name), ''), nullif(btrim(p_company), ''), (select name from crm.customers where id = v_customer))
                 || ', ' || coalesce(v_caller, 'Rufnummer unbekannt'), 300), v_customer, 'agent');
  end if;
  perform crm.log(v_customer, 'Anfrage am Telefon: ' || v_subject, 'call', 'Telefonassistentin');
  return v_customer;
end $$;

-- Report: per channel the inquiries and new customers of the period and the payments received in it.
create or replace function crm.channel_report(p_from date, p_to date) returns table (
  channel text, label text, inquiries bigint, customers bigint, revenue numeric)
language sql stable as $$
  with keys as (
    select coalesce(i.source_channel, 'unknown') as channel, count(*) as inquiries, 0::bigint as customers, 0::numeric as revenue
      from crm.inquiries i where (i.created_at at time zone 'Europe/Berlin')::date between p_from and p_to group by 1
    union all
    select coalesce(c.channel, 'unknown'), 0, count(*), 0
      from crm.customers c where (c.created_at at time zone 'Europe/Berlin')::date between p_from and p_to group by 1
    union all
    select coalesce(c.channel, 'unknown'), 0, 0, sum(p.amount)
      from crm.payments p join crm.invoices v on v.id = p.invoice_id join crm.customers c on c.id = v.customer_id
     where p.paid_on between p_from and p_to group by 1
  )
  select channel, crm.source_channel_label(channel), sum(inquiries)::bigint, sum(customers)::bigint, coalesce(sum(revenue), 0)
    from keys group by channel order by sum(revenue) desc, sum(inquiries) desc, channel
$$;

-- Rights

revoke all on function crm.is_channel(text), crm.source_channel_label(text), crm.channel_from(text, text),
  crm.channel_from_subject(text), crm.note_channel(uuid, uuid, text, text), crm.channel_report(date, date),
  crm.intake_contact(text, text, text, text, text, text, text), crm.intake_call(text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function crm.is_channel(text), crm.source_channel_label(text), crm.channel_from(text, text),
  crm.channel_from_subject(text), crm.note_channel(uuid, uuid, text, text), crm.channel_report(date, date)
  to authenticated, service_role;
grant execute on function crm.intake_contact(text, text, text, text, text, text, text),
  crm.intake_call(text, text, text, text, text, text, text) to service_role;
-- The website form is the only entry point open without sign-in.
revoke all on function crm.submit_inquiry(text, text, text, text, text, text, text, text, text) from public;
grant execute on function crm.submit_inquiry(text, text, text, text, text, text, text, text, text) to anon, authenticated, service_role;

do $$
declare v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure from pg_proc p
     where p.pronamespace = 'crm'::regnamespace and p.prokind = 'f'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public, extensions', v_function);
  end loop;
end $$;

notify pgrst, 'reload schema';
