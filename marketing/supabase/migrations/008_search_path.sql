-- A fixed search path for the marketing functions that had none (Supabase lint 0011).
-- Context: decided with Daniel on 30.10.2026 together with crm/008; publish_moment, schedule_on_approval,
-- start_campaign and pause_campaign name every table and function with its schema, so the path the
-- project's roles use ("$user", public, extensions) keeps their behaviour exactly. | Input:
-- migrations 001-007. | Output: every function of the schema marketing carries its search path.
-- Running the file twice changes nothing.

do $$
declare v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure from pg_proc p
     where p.pronamespace = 'marketing'::regnamespace and p.prokind = 'f'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public, extensions', v_function);
  end loop;
end $$;
