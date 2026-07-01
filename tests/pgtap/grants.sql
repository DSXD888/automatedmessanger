begin;

create extension if not exists pgtap with schema extensions;
set search_path = extensions, public;

do $$
begin
  execute format('grant dentino_confirm_api to %I', current_user);
  execute format('grant anon to %I', current_user);
  execute format('grant authenticated to %I', current_user);
end;
$$;

create or replace function pg_temp.role_denies_with_insufficient_privilege(p_role text, p_sql text)
returns boolean
language plpgsql
as $$
begin
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
    reset role;
    return false;
  exception when insufficient_privilege then
    reset role;
    return true;
  end;
exception when others then
  reset role;
  raise;
end;
$$;

create or replace function pg_temp.role_cannot_read(p_role text, p_sql text)
returns boolean
language plpgsql
as $$
begin
  return pg_temp.role_denies_with_insufficient_privilege(p_role, p_sql);
exception when insufficient_privilege then
  return true;
end;
$$;

select plan(43);

select ok(exists (select 1 from pg_roles where rolname = 'dentino_confirm_api'), 'dentino_confirm_api role exists');
select ok(exists (select 1 from pg_roles where rolname = 'dentino_confirm_definer'), 'dentino_confirm_definer role exists');
select ok(exists (select 1 from pg_roles where rolname = 'dentino_run_api'), 'dentino_run_api role exists');
select ok(exists (select 1 from pg_roles where rolname = 'dentino_maintenance_runner'), 'dentino_maintenance_runner role exists');
select ok(exists (select 1 from pg_roles where rolname = 'dentino_maintenance_definer'), 'dentino_maintenance_definer role exists');
select ok(exists (select 1 from pg_roles where rolname = 'dentino_dashboard_definer'), 'dentino_dashboard_definer role exists');

select ok(exists (select 1 from information_schema.schemata where schema_name = 'api'), 'api schema exists');
select ok(exists (select 1 from information_schema.schemata where schema_name = 'private'), 'private schema exists');

select is(
  (
    select count(*)::int
    from pg_tables t
    where t.schemaname = 'app'
      and (
        has_table_privilege('anon', format('%I.%I', t.schemaname, t.tablename), 'select')
        or has_table_privilege('anon', format('%I.%I', t.schemaname, t.tablename), 'insert')
        or has_table_privilege('anon', format('%I.%I', t.schemaname, t.tablename), 'update')
        or has_table_privilege('anon', format('%I.%I', t.schemaname, t.tablename), 'delete')
      )
  ),
  0,
  'anon has no app base-table privileges'
);

select is(
  (
    select count(*)::int
    from pg_tables t
    where t.schemaname = 'app'
      and (
        has_table_privilege('authenticated', format('%I.%I', t.schemaname, t.tablename), 'select')
        or has_table_privilege('authenticated', format('%I.%I', t.schemaname, t.tablename), 'insert')
        or has_table_privilege('authenticated', format('%I.%I', t.schemaname, t.tablename), 'update')
        or has_table_privilege('authenticated', format('%I.%I', t.schemaname, t.tablename), 'delete')
      )
  ),
  0,
  'authenticated has no app base-table privileges in L1 core'
);

select is(
  (
    select count(*)::int
    from pg_tables t
    where t.schemaname = 'app'
      and (
        has_table_privilege('dentino_confirm_api', format('%I.%I', t.schemaname, t.tablename), 'select')
        or has_table_privilege('dentino_confirm_api', format('%I.%I', t.schemaname, t.tablename), 'insert')
        or has_table_privilege('dentino_confirm_api', format('%I.%I', t.schemaname, t.tablename), 'update')
        or has_table_privilege('dentino_confirm_api', format('%I.%I', t.schemaname, t.tablename), 'delete')
      )
  ),
  0,
  'dentino_confirm_api has no app base-table privileges'
);

select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api'
  ),
  27,
  'api exposes confirm, run-store, and L3/L4 dashboard functions'
);

select ok(has_function_privilege('dentino_confirm_api', 'api.lookup_reminder_by_token(text)'::regprocedure, 'execute'), 'confirm role executes lookup RPC');
select ok(has_function_privilege('dentino_confirm_api', 'api.prepare_reminder_action(text,text)'::regprocedure, 'execute'), 'confirm role executes prepare RPC');
select ok(has_function_privilege('dentino_confirm_api', 'api.record_reminder_action(text,text,text)'::regprocedure, 'execute'), 'confirm role executes record RPC');
select ok(has_function_privilege('dentino_confirm_api', 'api.finish_reminder_action(bigint,boolean,text,jsonb)'::regprocedure, 'execute'), 'confirm role executes finish RPC');

select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api'
      and has_function_privilege('dentino_confirm_api', p.oid, 'execute')
  ),
  4,
  'dentino_confirm_api executes only the four api RPCs'
);

select ok(not has_function_privilege('dentino_confirm_api', 'private.token_digest(text)'::regprocedure, 'execute'), 'dentino_confirm_api cannot execute private token digest');
select ok(not has_function_privilege('anon', 'api.lookup_reminder_by_token(text)'::regprocedure, 'execute'), 'anon cannot execute lookup RPC');
select ok(not has_function_privilege('authenticated', 'api.lookup_reminder_by_token(text)'::regprocedure, 'execute'), 'authenticated cannot execute lookup RPC');

select ok(to_regclass('api.v_board') is not null, 'dashboard board view exists');
select ok(to_regclass('api.v_needs_attention') is not null, 'dashboard needs-attention view exists');

select ok(
  (
    select 'security_invoker=true' = any(coalesce(c.reloptions, array[]::text[]))
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'api' and c.relname = 'v_board'
  ),
  'dashboard board view is security_invoker'
);

select ok(
  (
    select 'security_invoker=true' = any(coalesce(c.reloptions, array[]::text[]))
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'api' and c.relname = 'v_needs_attention'
  ),
  'dashboard needs-attention view is security_invoker'
);

select is(
  (
    select count(*)::int
    from information_schema.columns
    where table_schema = 'api'
      and table_name = 'v_board'
      and column_name in (
        'tracking_token_digest',
        'action_nonce_digest',
        'action_nonce_expires_at',
        'send_claim_token',
        'send_claim_expires_at',
        'phone_hmac',
        'phone'
      )
  ),
  0,
  'dashboard board view exposes no token, nonce, claim, or full-phone columns'
);

select is(
  (
    select count(*)::int
    from information_schema.columns
    where table_schema = 'api'
      and table_name = 'v_needs_attention'
      and column_name in (
        'tracking_token_digest',
        'action_nonce_digest',
        'action_nonce_expires_at',
        'send_claim_token',
        'send_claim_expires_at',
        'phone_hmac',
        'phone'
      )
  ),
  0,
  'dashboard needs-attention view exposes no token, nonce, claim, or full-phone columns'
);

select ok(not pg_temp.role_denies_with_insufficient_privilege(
  'authenticated',
  'select count(*) from api.v_board'
), 'authenticated can select dashboard board view');

select ok(not pg_temp.role_denies_with_insufficient_privilege(
  'authenticated',
  'select count(*) from api.v_needs_attention'
), 'authenticated can select dashboard needs-attention view');

select ok(has_function_privilege('authenticated', 'api.dashboard_board_rows()'::regprocedure, 'execute'), 'authenticated executes dashboard board projection');
select ok(has_function_privilege('authenticated', 'api.update_message_template(bigint,text,text)'::regprocedure, 'execute'), 'authenticated executes template admin RPC');
select ok(has_function_privilege('authenticated', 'api.resolve_held_cancels(date,bigint[],text,text,jsonb)'::regprocedure, 'execute'), 'authenticated executes held-cancel admin RPC');
select ok(has_function_privilege('authenticated', 'api.reenable_sms_reminders(bigint,text,text)'::regprocedure, 'execute'), 'authenticated executes SMS re-enable RPC');
select ok(has_function_privilege('authenticated', 'api.record_go_live_mode_flip(text,text,text,text,text,date,text,jsonb)'::regprocedure, 'execute'), 'authenticated executes go-live mode-flip audit RPC');
select ok(not has_function_privilege('anon', 'api.update_message_template(bigint,text,text)'::regprocedure, 'execute'), 'anon cannot execute template admin RPC');
select ok(not has_function_privilege('anon', 'api.record_go_live_mode_flip(text,text,text,text,text,date,text,jsonb)'::regprocedure, 'execute'), 'anon cannot execute go-live mode-flip audit RPC');
select ok(not has_table_privilege('anon', 'api.v_board', 'select'), 'anon cannot select dashboard board view');

select ok(pg_temp.role_cannot_read(
  'dentino_confirm_api',
  'select count(*) from app.patients'
), 'dentino_confirm_api cannot select app.patients');

select ok(pg_temp.role_cannot_read(
  'anon',
  'select count(*) from app.reminder_messages'
), 'anon cannot select app.reminder_messages');

select ok(pg_temp.role_cannot_read(
  'authenticated',
  'select tracking_token_digest from app.reminder_messages'
), 'authenticated cannot read token digests');

select ok(has_table_privilege('dentino_run_api', 'app.reminder_messages', 'insert'), 'run role can insert reminder messages');
select ok(has_table_privilege('dentino_run_api', 'app.message_templates', 'select'), 'run role can read templates');
select ok(has_function_privilege('dentino_maintenance_runner', 'maintenance.reap_stale_sends(date)'::regprocedure, 'execute'), 'maintenance runner executes reaper');
select ok(has_function_privilege('dentino_maintenance_runner', 'maintenance.purge_privacy()'::regprocedure, 'execute'), 'maintenance runner executes purge');
select ok(has_function_privilege('dentino_maintenance_runner', 'maintenance.record_guard_liveness(text,text,integer,integer,text,text,jsonb)'::regprocedure, 'execute'), 'maintenance runner executes guard-liveness RPC');
select ok(not has_function_privilege('authenticated', 'maintenance.record_guard_liveness(text,text,integer,integer,text,text,jsonb)'::regprocedure, 'execute'), 'authenticated cannot execute guard-liveness RPC');

select * from finish();

rollback;
