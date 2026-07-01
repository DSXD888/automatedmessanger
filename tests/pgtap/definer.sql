begin;

create extension if not exists pgtap with schema extensions;
set search_path = extensions, public;

select plan(14);

select is(
  (
    with expected_boundary_functions(function_oid) as (
      values
        ('private.token_digest(text)'::regprocedure),
        ('api.lookup_reminder_by_token(text)'::regprocedure),
        ('api.prepare_reminder_action(text,text)'::regprocedure),
        ('api.record_reminder_action(text,text,text)'::regprocedure),
        ('api.finish_reminder_action(bigint,boolean,text,jsonb)'::regprocedure),
        ('api.dashboard_board_rows()'::regprocedure),
        ('api.dashboard_needs_attention_rows()'::regprocedure),
        ('api.update_message_template(bigint,text,text)'::regprocedure),
        ('api.resolve_held_cancels(date,bigint[],text,text,jsonb)'::regprocedure),
        ('api.reenable_sms_reminders(bigint,text,text)'::regprocedure),
        ('api.record_go_live_mode_flip(text,text,text,text,text,date,text,jsonb)'::regprocedure),
        ('maintenance.record_guard_liveness(text,text,integer,integer,text,text,jsonb)'::regprocedure),
        ('maintenance.reap_stale_sends(date)'::regprocedure),
        ('maintenance.purge_privacy()'::regprocedure),
        ('maintenance.invoke_run_reminders(text,date)'::regprocedure)
    )
    select count(*)::int
    from expected_boundary_functions expected
    join pg_proc p on p.oid = expected.function_oid
    where not p.prosecdef
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
      and p.prosecdef
      and not ('search_path=""' = any(coalesce(p.proconfig, array[]::text[])))
  ),
  0,
  'all security definer functions pin search_path to empty string'
);

select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_roles r on r.oid = p.proowner
    where n.nspname in ('api', 'private', 'maintenance')
      and p.prosecdef
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
      and p.prosecdef
      and has_function_privilege('public', p.oid, 'execute')
  ),
  0,
  'PUBLIC execute is revoked from security definer functions'
);

select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('api', 'private', 'maintenance')
      and p.prosecdef
      and p.prosrc ~* '\mexecute\M'
  ),
  0,
  'security definer function bodies contain no dynamic SQL'
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

select is(
  (select r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner where p.oid = 'api.update_message_template(bigint,text,text)'::regprocedure),
  'dentino_dashboard_definer',
  'update_message_template is owned by dashboard definer'
);

select is(
  (select r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner where p.oid = 'api.record_go_live_mode_flip(text,text,text,text,text,date,text,jsonb)'::regprocedure),
  'dentino_dashboard_definer',
  'record_go_live_mode_flip is owned by dashboard definer'
);

select is(
  (select r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner where p.oid = 'maintenance.record_guard_liveness(text,text,integer,integer,text,text,jsonb)'::regprocedure),
  'dentino_maintenance_definer',
  'record_guard_liveness is owned by maintenance definer'
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
