begin;

create extension if not exists pgtap with schema extensions;
set search_path = extensions, public;

select plan(11);

select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('api', 'private', 'maintenance')
      and p.proname in (
        'token_digest',
        'lookup_reminder_by_token',
        'prepare_reminder_action',
        'record_reminder_action',
        'finish_reminder_action',
        'reap_stale_sends',
        'purge_privacy'
      )
      and not p.prosecdef
  ),
  0,
  'all boundary functions are security definer'
);

select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('api', 'private', 'maintenance')
      and p.proname in (
        'token_digest',
        'lookup_reminder_by_token',
        'prepare_reminder_action',
        'record_reminder_action',
        'finish_reminder_action',
        'reap_stale_sends',
        'purge_privacy'
      )
      and not ('search_path=""' = any(coalesce(p.proconfig, array[]::text[])))
  ),
  0,
  'all boundary functions pin search_path to empty string'
);

select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_roles r on r.oid = p.proowner
    where n.nspname in ('api', 'private', 'maintenance')
      and p.proname in (
        'token_digest',
        'lookup_reminder_by_token',
        'prepare_reminder_action',
        'record_reminder_action',
        'finish_reminder_action',
        'reap_stale_sends',
        'purge_privacy'
      )
      and (r.rolsuper or r.rolcanlogin)
  ),
  0,
  'security definer owners are non-login non-superuser roles'
);

select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('api', 'private', 'maintenance')
      and p.proname in (
        'token_digest',
        'lookup_reminder_by_token',
        'prepare_reminder_action',
        'record_reminder_action',
        'finish_reminder_action',
        'reap_stale_sends',
        'purge_privacy'
      )
      and has_function_privilege('public', p.oid, 'execute')
  ),
  0,
  'PUBLIC execute is revoked from boundary functions'
);

select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('api', 'private', 'maintenance')
      and p.proname in (
        'token_digest',
        'lookup_reminder_by_token',
        'prepare_reminder_action',
        'record_reminder_action',
        'finish_reminder_action',
        'reap_stale_sends',
        'purge_privacy'
      )
      and p.prosrc ~* '\mexecute\M'
  ),
  0,
  'boundary function bodies contain no dynamic SQL'
);

select is(
  (select rolconfig::text[] from pg_roles where rolname = 'dentino_confirm_api'),
  array[
    'statement_timeout=2000ms',
    'lock_timeout=250ms',
    'idle_in_transaction_session_timeout=2000ms'
  ]::text[],
  'confirm role has fail-closed timeout settings'
);

select is(
  (select r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner where p.oid = 'api.lookup_reminder_by_token(text)'::regprocedure),
  'dentino_confirm_definer',
  'lookup_reminder_by_token is owned by confirm definer'
);

select is(
  (select r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner where p.oid = 'private.token_digest(text)'::regprocedure),
  'dentino_confirm_definer',
  'private token_digest is owned by confirm definer'
);

select is(
  (select r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner where p.oid = 'api.record_reminder_action(text,text,text)'::regprocedure),
  'dentino_confirm_definer',
  'record_reminder_action is owned by confirm definer'
);

select is(
  (select r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner where p.oid = 'maintenance.purge_privacy()'::regprocedure),
  'dentino_maintenance_definer',
  'purge_privacy is owned by maintenance definer'
);

select ok(not exists (
  select 1
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api'
    and p.prorettype = 'app.reminder_messages'::regtype
), 'api RPCs do not return app.reminder_messages row type');

select * from finish();

rollback;
