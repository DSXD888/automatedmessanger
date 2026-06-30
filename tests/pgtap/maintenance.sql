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

select plan(31);

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

insert into app.inbound_events(provider, raw_redacted, purge_after)
values
  ('turbosms', '{"fixture":"purge-inbound-old","phone_last4":"1234"}', app.now() - interval '1 second'),
  ('turbosms', '{"fixture":"purge-inbound-keep"}', app.now() + interval '1 day');

insert into app.crm_fetch_log(
  purpose,
  method,
  path,
  request_params,
  response_status,
  raw_redacted,
  purge_after
)
values
  (
    'visits_initial',
    'GET',
    '/visits',
    '{}'::jsonb,
    200,
    '{"fixture":"purge-fetch-old","phone_last4":"5678"}',
    app.now() - interval '1 second'
  ),
  (
    'patients_batch',
    'GET',
    '/patients',
    '{}'::jsonb,
    200,
    '{"fixture":"purge-fetch-keep"}',
    app.now() + interval '1 day'
  );

insert into app.patients(
  cliniccards_id,
  first_name,
  last_name,
  phone_hmac,
  phone_last4,
  sms_reminders_enabled,
  sms_reminders_status,
  sms_reminders_set_at
)
values
  (
    'patient-purge-message',
    'Display',
    'Snapshot',
    'phone-hmac-message',
    '1111',
    true,
    'enabled',
    app.now() - interval '120 days'
  ),
  (
    'patient-purge-inactive',
    'Inactive',
    'Patient',
    'phone-hmac-inactive',
    '2222',
    true,
    'enabled',
    app.now() - interval '220 days'
  );

insert into app.reminder_messages (
  cliniccards_visit_id,
  patient_id,
  target_date,
  target_at,
  message_kind,
  appointment_fingerprint,
  source_status,
  status,
  provider_message_id,
  tracking_token_digest,
  token_expires_at,
  action_nonce_digest,
  action_nonce_expires_at,
  patient_display_snapshot,
  error
) values (
  'visit-purge-message',
  (select id from app.patients where cliniccards_id = 'patient-purge-message'),
  '2026-02-01',
  '2026-02-01T09:00:00+02:00',
  'initial_reminder',
  'fingerprint-purge-message',
  'PLANNED',
  'sent',
  'provider-purge-message',
  decode(repeat('b', 64), 'hex'),
  app.now() - interval '1 day',
  decode(repeat('c', 64), 'hex'),
  app.now() - interval '1 hour',
  'Display S. 01.02 09:00',
  'synthetic purge error'
);

insert into app.consent_events(
  patient_id,
  status,
  source,
  legal_basis,
  captured_at,
  captured_by,
  request_meta
)
values
  (
    (select id from app.patients where cliniccards_id = 'patient-purge-inactive'),
    'enabled',
    'legacy_import',
    'contract',
    app.now() - interval '15 days',
    'staff-purge-old',
    '{"fixture":"purge-consent-old","ip_hash":"abc"}'
  ),
  (
    (select id from app.patients where cliniccards_id = 'patient-purge-inactive'),
    'enabled',
    'legacy_import',
    'contract',
    app.now() - interval '1 day',
    'staff-purge-new',
    '{"fixture":"purge-consent-keep"}'
  );

select lives_ok(
  $$
    set local role dentino_maintenance_runner;
    select maintenance.purge_privacy();
    reset role;
  $$,
  'maintenance runner can execute privacy purge'
);

select is(
  (
    select count(*)::int
    from app.inbound_events
    where raw_redacted->>'fixture' = 'purge-inbound-old'
  ),
  0,
  'privacy purge deletes inbound events past purge_after'
);

select is(
  (
    select count(*)::int
    from app.inbound_events
    where raw_redacted->>'fixture' = 'purge-inbound-keep'
  ),
  1,
  'privacy purge preserves inbound events inside retention'
);

select is(
  (
    select count(*)::int
    from app.crm_fetch_log
    where raw_redacted->>'fixture' = 'purge-fetch-old'
  ),
  0,
  'privacy purge deletes CRM fetch logs past purge_after'
);

select is(
  (
    select count(*)::int
    from app.crm_fetch_log
    where raw_redacted->>'fixture' = 'purge-fetch-keep'
  ),
  1,
  'privacy purge preserves CRM fetch logs inside retention'
);

select ok(
  (
    select encode(tracking_token_digest, 'hex') <> repeat('b', 64)
    from app.reminder_messages
    where cliniccards_visit_id = 'visit-purge-message'
  ),
  'privacy purge rotates old message token digest'
);

select ok(
  (
    select action_nonce_digest is null and action_nonce_expires_at is null
    from app.reminder_messages
    where cliniccards_visit_id = 'visit-purge-message'
  ),
  'privacy purge clears old action nonce material'
);

select ok(
  (
    select patient_display_snapshot is null and error is null
    from app.reminder_messages
    where cliniccards_visit_id = 'visit-purge-message'
  ),
  'privacy purge clears old message display snapshot and error text'
);

select ok(
  (
    select first_name is null
      and last_name is null
      and phone_hmac is null
      and phone_last4 is null
      and sms_reminders_enabled is false
      and sms_reminders_status = 'unknown'
    from app.patients
    where cliniccards_id = 'patient-purge-inactive'
  ),
  'privacy purge pseudonymizes inactive patient rows'
);

select ok(
  (
    select request_meta is null
    from app.consent_events
    where captured_by = 'staff-purge-old'
  ),
  'privacy purge clears aged consent request metadata'
);

select ok(
  (
    select request_meta->>'fixture' = 'purge-consent-keep'
    from app.consent_events
    where captured_by = 'staff-purge-new'
  ),
  'privacy purge keeps recent consent request metadata'
);

select is(
  (
    select (detail->>'inbound_events_deleted')::int
    from app.audit_log
    where actor = 'maintenance.purge_privacy'
      and action = 'purge_privacy'
    order by id desc
    limit 1
  ),
  1,
  'privacy purge audit records inbound delete count'
);

select is(
  (
    select (detail->>'crm_fetch_log_deleted')::int
    from app.audit_log
    where actor = 'maintenance.purge_privacy'
      and action = 'purge_privacy'
    order by id desc
    limit 1
  ),
  1,
  'privacy purge audit records CRM fetch delete count'
);

select is(
  (
    select (detail->>'reminder_messages_anonymized')::int
    from app.audit_log
    where actor = 'maintenance.purge_privacy'
      and action = 'purge_privacy'
    order by id desc
    limit 1
  ),
  1,
  'privacy purge audit records message anonymization count'
);

select is(
  (
    select (detail->>'patients_pseudonymized')::int
    from app.audit_log
    where actor = 'maintenance.purge_privacy'
      and action = 'purge_privacy'
    order by id desc
    limit 1
  ),
  1,
  'privacy purge audit records patient pseudonymization count'
);

select is(
  (
    select (detail->>'consent_request_meta_cleared')::int
    from app.audit_log
    where actor = 'maintenance.purge_privacy'
      and action = 'purge_privacy'
    order by id desc
    limit 1
  ),
  1,
  'privacy purge audit records consent metadata clear count'
);

select ok(
  not exists (
    select 1
    from app.audit_log
    where actor = 'maintenance.purge_privacy'
      and action = 'purge_privacy'
      and (
        detail::text ~ 'purge-inbound-old'
        or detail::text ~ 'purge-fetch-old'
        or detail::text ~ 'visit-purge-message'
        or detail::text ~ 'patient-purge-inactive'
        or detail::text ~ 'purge-consent-old'
      )
  ),
  'privacy purge audit row does not include seeded identifiers'
);

select ok(
  exists (
    select 1
    from cron.job
    where jobname = 'dentino-privacy-purge-daily'
      and command like '%maintenance.purge_privacy%'
  ),
  'pg_cron schedules the privacy purge'
);

select ok(
  exists (
    select 1
    from cron.job
    where jobname = 'dentino-privacy-purge-daily'
      and (
        username = 'dentino_maintenance_runner'
        or to_regprocedure('cron.schedule_in_database(text,text,text,text,text)') is null
      )
  ),
  'privacy purge cron job uses maintenance runner when username-scoped cron is available'
);

select ok(
  not has_table_privilege(
    'dentino_maintenance_runner',
    'app.crm_fetch_log',
    'delete'
  ),
  'maintenance runner has no direct CRM fetch log delete grant'
);

select ok(
  has_function_privilege(
    'dentino_maintenance_runner',
    'maintenance.purge_privacy()'::regprocedure,
    'execute'
  ),
  'maintenance runner reaches privacy purge only through execute grant'
);

select * from finish();

rollback;
