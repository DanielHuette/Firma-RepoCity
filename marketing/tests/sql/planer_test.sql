-- Planner rules: hand-posted channels never get a publishing time, blog posts follow the chosen
-- date, the Cockpit hears about approvals and due posts.
\set ON_ERROR_STOP on
truncate net.calls; delete from cockpit.messages;
select id as standing from marketing.campaigns where slug = 'laufend' \gset
insert into marketing.posts (campaign_id, channel, slug, title, body_md, status, planned_for)
values (:'standing', 'x', 'erster-x', 'Erster Beitrag auf X', 'Kurz und knapp.', 'review', now() - interval '1 hour') returning id as xpost \gset
insert into marketing.posts (campaign_id, channel, slug, title, body_md, status, planned_for)
values (:'standing', 'linkedin', 'erster-li', 'Erster LinkedIn-Beitrag', 'Text.', 'review', now() + interval '2 days') returning id as lipost \gset
update marketing.posts set status = 'approved' where id in (:'xpost', :'lipost');
select channel, status, scheduled_for is null as no_schedule, (scheduled_for = planned_for) as follows_plan from marketing.posts where id in (:'xpost', :'lipost') order by channel;
select title, moment is not null as on_calendar from marketing.plan order by title;
select marketing.remind_due() as reminded;
select marketing.remind_due() as reminded_again;
select app, kind, title, body from cockpit.messages order by created_at, kind;
-- an approval with an unbacked figure is refused
insert into marketing.posts (campaign_id, channel, slug, title, body_md, status, unbacked_figures)
values (:'standing', 'x', 'zahl-x', 'Mit Zahl', '80 Prozent', 'review', '{80 Prozent}') returning id as numpost \gset
\set ON_ERROR_STOP off
update marketing.posts set status = 'approved' where id = :'numpost';
