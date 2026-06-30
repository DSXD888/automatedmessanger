begin;

create extension if not exists pgtap with schema extensions;
set search_path = extensions, public;
set app.env = 'test';
set app.test_now = '2026-06-30T10:00:00Z';

do $$
begin
  execute format('grant dentino_maintenance_runner to %I', current_user);
end;
$$;

select plan(9);

insert into app.reminder_messages (
  cliniccards_visit_id,
  target_date,
  target_at,
  message_kind,
  appointment_fingerprint,
  source_status,
  status,
  send_claim_token,
  send_claim_expires_at,
  tracking_token_digest,
  token_expires_at
) values (
  'visit-maint-reap',
  '2026-07-01',
  '2026-07-01T09:00:00+03:00',
  'initial_reminder',
  'fingerprint-maint-reap',
  'PLANNED',
  'sending',
  '00000000-0000-0000-0000-000000000001',
  app.now() - interval '1 minute',
  decode(repeat('a', 64), 'hex'),
  app.now() + interval '1 day'
);

select lives_ok(
  $$
    set local role dentino_maintenance_runner;
    select maintenance.reap_stale_sends('2026-07-01'::date);
    reset role;
  $$,
  'maintenance runner can execute stale-send reaper'
);

select is(
  (
    select status
    from app.reminder_messages
    where cliniccards_visit_id = 'visit-maint-reap'
  ),
  'send_unknown',
  'stale sending row is reaped to send_unknown'
);

select is(
  (
    select skip_reason
    from app.reminder_messages
    where cliniccards_visit_id = 'visit-maint-reap'
  ),
  'send_ambiguous',
  'reaped stale sending row is flagged ambiguous'
);

select is(
  (
    select (detail->>'reaped_count')::int
    from app.audit_log
    where actor = 'maintenance.reap_stale_sends'
      and action = 'reap_stale_sends'
    order by id desc
    limit 1
  ),
  1,
  'reaper audit row records counts'
);

select ok(
  not exists (
    select 1
    from app.audit_log
    where actor = 'maintenance.reap_stale_sends'
      and action = 'reap_stale_sends'
      and detail::text ~ 'visit-maint-reap'
  ),
  'reaper audit row does not include visit identifiers'
);

select ok(
  exists (
    select 1
    from cron.job
    where jobname = 'dentino-reap-stale-sends-every-5m'
      and command like '%maintenance.reap_stale_sends%'
  ),
  'pg_cron schedules the stale-send backstop'
);

select ok(
  exists (
    select 1
    from cron.job
    where jobname = 'dentino-writeback-reaper-sweep-every-15m'
      and command like '%maintenance.invoke_run_reminders(''catchup'')%'
  ),
  'pg_cron schedules the CRM-writeback reaper sweep'
);

select ok(
  not has_table_privilege(
    'dentino_maintenance_runner',
    'app.reminder_messages',
    'update'
  ),
  'maintenance runner has no direct reminder_messages update grant'
);

select ok(
  has_function_privilege(
    'dentino_maintenance_runner',
    'maintenance.reap_stale_sends(date)'::regprocedure,
    'execute'
  ),
  'maintenance runner reaches reaper only through execute grant'
);

select * from finish();

rollback;
