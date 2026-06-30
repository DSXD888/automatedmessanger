begin;

create extension if not exists pgtap with schema extensions;
set search_path = extensions, public;

select plan(8);

select is(
  (
    select count(*)::int
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app'
      and c.relkind = 'r'
      and not c.relrowsecurity
  ),
  0,
  'RLS is enabled on every app table'
);

select is(
  (
    select count(*)::int
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app'
      and c.relkind = 'r'
      and not c.relforcerowsecurity
  ),
  0,
  'RLS is forced on every app table'
);

select is(
  (
    select count(*)::int
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app'
      and (
        p.polroles = array[0]::oid[]
        or exists (
          select 1
          from unnest(p.polroles) as policy_role(role_oid)
          join pg_roles r on r.oid = policy_role.role_oid
          where r.rolname in ('anon', 'authenticated', 'dentino_confirm_api')
        )
      )
  ),
  0,
  'no app RLS policy names anon, authenticated, or dentino_confirm_api'
);

select ok(exists (
  select 1
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_roles r on r.oid = any(p.polroles)
  where n.nspname = 'app'
    and c.relname = 'reminder_messages'
    and r.rolname = 'dentino_run_api'
), 'run role has reminder_messages RLS policy');

select ok(exists (
  select 1
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_roles r on r.oid = any(p.polroles)
  where n.nspname = 'app'
    and c.relname = 'reminder_messages'
    and r.rolname = 'dentino_confirm_definer'
), 'confirm definer has reminder_messages RLS policy');

select ok(exists (
  select 1
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_roles r on r.oid = any(p.polroles)
  where n.nspname = 'app'
    and c.relname = 'reminder_messages'
    and r.rolname = 'dentino_maintenance_definer'
), 'maintenance definer has reminder_messages RLS policy');

select is(
  (
    select count(*)::int
    from information_schema.tables
    where table_schema = 'api'
      and table_type = 'BASE TABLE'
  ),
  0,
  'api schema exposes no base tables'
);

select ok(
  not has_schema_privilege('anon', 'app', 'usage')
  and not has_schema_privilege('authenticated', 'app', 'usage')
  and not has_schema_privilege('dentino_confirm_api', 'app', 'usage'),
  'public and confirm roles have no app schema usage'
);

select * from finish();

rollback;
