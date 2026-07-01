begin;

create extension if not exists pgtap with schema extensions;
set search_path = extensions, public;

select plan(11);

select throws_like(
  $$
    select api.record_go_live_mode_flip(
      'owner',
      'seed',
      'off',
      'canary',
      'allowlist',
      '2026-07-01'::date,
      null,
      '{"reviewed_count": 3, "owner_present": true}'::jsonb
    );
  $$,
  '%Typed confirmation token is required%',
  'REL-GOLIVE-AUDIT-01 requires typed confirmation before first live CRM write'
);

select lives_ok(
  $$
    select api.record_go_live_mode_flip(
      'owner',
      'seed',
      'off',
      'canary',
      'allowlist',
      '2026-07-01'::date,
      'ENABLE-LIVE-WRITES-2026-07-01',
      '{"reviewed_count": 3, "owner_present": true}'::jsonb
    );
  $$,
  'REL-GOLIVE-AUDIT-01 accepted mode flip writes an audit row'
);

select is(
  (
    select detail #>> '{new,crm_write_mode}'
      from app.audit_log
     where action = 'go_live_mode_flip'
     order by id desc
     limit 1
  ),
  'allowlist',
  'mode-flip audit records the new CRM write mode'
);

select throws_like(
  $$
    select api.record_go_live_mode_flip(
      'owner',
      'off',
      'off',
      'seed',
      'off',
      null,
      null,
      '{"patient_name": 1}'::jsonb
    );
  $$,
  '%counts-only%',
  'mode-flip audit context rejects patient-shaped keys'
);

select lives_ok(
  $$
    select maintenance.record_guard_liveness(
      'seed',
      'off',
      3,
      0,
      'SEED',
      'guard_liveness_schedule',
      '{"checked_rungs": 1}'::jsonb
    );
  $$,
  'REL-GUARD-LIVENESS-01 records an ok guard-liveness audit row'
);

select is(
  (
    select action
      from app.audit_log
     where action like 'guard_liveness_%'
     order by id desc
     limit 1
  ),
  'guard_liveness_ok',
  'guard-liveness ok path uses the ok audit action'
);

select lives_ok(
  $$
    select maintenance.record_guard_liveness(
      'canary',
      'allowlist',
      0,
      0,
      'SHADOW',
      'guard_liveness_schedule',
      '{"checked_rungs": 1}'::jsonb
    );
  $$,
  'REL-GUARD-LIVENESS-01 records drift as an alert row'
);

select ok(
  (
    select (detail -> 'problems') ? 'send_allowlist_empty'
       and (detail -> 'problems') ? 'crm_write_allowlist_empty'
       and (detail -> 'problems') ? 'dashboard_mode_mismatch'
      from app.audit_log
     where action = 'guard_liveness_alert'
     order by id desc
     limit 1
  ),
  'guard-liveness alert captures allowlist and dashboard drift'
);

select ok(
  exists (
    select 1
      from cron.job
     where jobname = 'dentino-guard-liveness-hourly'
       and command like '%maintenance.record_guard_liveness%'
       and command like '%''off'', ''off''%'
       and command like '%''SHADOW''%'
  ),
  'REL-GUARD-LIVENESS-01 schedules the guard-liveness check'
);

select ok(
  exists (
    select 1
      from cron.job
     where jobname = 'dentino-guard-liveness-hourly'
       and (
         username = 'dentino_maintenance_runner'
         or to_regprocedure('cron.schedule_in_database(text,text,text,text,text)') is null
       )
  ),
  'guard-liveness cron job uses maintenance runner when username-scoped cron is available'
);

select is(
  (
    select count(*)::int
      from app.audit_log
     where action = 'go_live_mode_flip'
       and detail #>> '{new,send_mode}' = 'full'
  ),
  0,
  'REL-GOLIVE-AUDIT-01 tests do not record a full-mode flip'
);

select * from finish();

rollback;
