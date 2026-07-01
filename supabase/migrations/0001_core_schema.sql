-- Data Layer 0001: base schema, invariants, deterministic clock seam.
-- Source of truth: research section 5.3 and section 5.7.

create schema if not exists app;
create schema if not exists maintenance;
create schema if not exists extensions;

create extension if not exists pgcrypto with schema extensions;

create or replace function app.now()
returns timestamptz
language plpgsql
volatile
set search_path = ''
as $$
declare
  app_env text := nullif(current_setting('app.env', true), '');
  test_now text := nullif(current_setting('app.test_now', true), '');
begin
  if app_env in ('test', 'ci') and test_now is not null then
    return test_now::timestamptz;
  end if;

  return clock_timestamp();
end;
$$;

create or replace function app.appointment_fingerprint(
  visit_start timestamptz,
  visit_end timestamptz,
  source_status text,
  doctor_id text default null,
  cabinet_id text default null,
  cliniccards_patient_id text default null
)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(
      concat_ws(
        '|',
        coalesce(to_char(visit_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), ''),
        coalesce(to_char(visit_end at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), ''),
        coalesce(source_status, ''),
        coalesce(doctor_id, ''),
        coalesce(cabinet_id, ''),
        coalesce(cliniccards_patient_id, '')
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create table app.patients (
  id bigint generated always as identity primary key,
  cliniccards_id text unique not null,
  first_name text,
  last_name text,
  phone_hmac text,
  phone_last4 text,
  phone_country text default 'UA',
  language text default 'uk',
  sms_reminders_enabled boolean not null default false,
  sms_reminders_status text not null default 'unknown'
    check (sms_reminders_status in ('unknown', 'enabled', 'opted_out', 'staff_disabled', 'blocked')),
  last_consent_event_id bigint,
  sms_reminders_set_at timestamptz,
  created_at timestamptz not null default app.now(),
  updated_at timestamptz not null default app.now()
);

create table app.reminder_runs (
  id bigint generated always as identity primary key,
  run_date date not null,
  target_date date not null,
  trigger text not null check (trigger in ('cron', 'manual')),
  pass_kind text not null default 'initial'
    check (pass_kind in ('initial', 'catchup', 'manual')),
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed')),
  total int not null default 0,
  sent int not null default 0,
  failed int not null default 0,
  skipped int not null default 0,
  started_at timestamptz not null default app.now(),
  finished_at timestamptz
);

create table app.reminder_days (
  target_date date primary key,
  status text not null default 'idle'
    check (status in ('idle', 'running', 'completed', 'partial', 'failed')),
  locked_by_run_id bigint references app.reminder_runs(id),
  lock_token uuid,
  lock_started_at timestamptz,
  lock_heartbeat_at timestamptz,
  lock_expires_at timestamptz,
  cliniccards_total int,
  remindable_total int,
  sendable_total int,
  sent_total int,
  skipped_total int,
  failed_total int,
  send_unknown_total int,
  pending_total int,
  unaccounted_total int,
  health text check (health in ('green', 'amber', 'red')),
  reconciled_at timestamptz,
  updated_at timestamptz not null default app.now()
);

create table app.reminder_messages (
  id bigint generated always as identity primary key,
  run_id bigint references app.reminder_runs(id),
  cliniccards_visit_id text not null,
  patient_id bigint references app.patients(id),
  target_date date not null,
  target_at timestamptz not null,
  channel text not null default 'sms',
  message_kind text not null default 'initial_reminder'
    check (message_kind in ('initial_reminder', 'catchup_reminder', 'reschedule_notice', 'time_change_notice')),
  appointment_fingerprint text,
  source_status text,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'delivered', 'failed', 'skipped', 'send_unknown', 'superseded')),
  skip_reason text check (
    skip_reason is null or skip_reason in (
      'not_enabled',
      'no_phone',
      'invalid_phone',
      'missing_patient',
      'patient_merged_or_unresolved',
      'patient_changed',
      'non_remindable_status',
      'unknown_status',
      'moved_before_send',
      'cancelled_before_send',
      'reopened_same_id',
      'send_ambiguous',
      'blocked_by_allowlist',
      'provider_pre_submit_failure'
    )
  ),
  send_claim_token uuid,
  send_claim_expires_at timestamptz,
  send_attempt_count int not null default 0,
  last_attempt_at timestamptz,
  provider_message_id text,
  tracking_token_digest bytea unique,
  token_expires_at timestamptz,
  action_nonce_digest bytea,
  action_nonce_expires_at timestamptz,
  patient_display_snapshot text,
  response text check (response in ('confirm', 'cancel')),
  responded_at timestamptz,
  action_locked_at timestamptz,
  action_taken text not null default 'none'
    check (action_taken in ('confirmed', 'cancelled', 'none', 'pending_staff_review', 'staff_closed_no_write', 'error')),
  crm_writeback_ok boolean,
  superseded_at timestamptz,
  superseded_by_message_id bigint references app.reminder_messages(id),
  error text,
  created_at timestamptz not null default app.now(),
  constraint one_action_requires_lock check (
    (response is null and action_locked_at is null)
    or (response is not null and action_locked_at is not null)
  ),
  constraint tracking_token_digest_32_bytes check (
    tracking_token_digest is null or octet_length(tracking_token_digest) = 32
  ),
  constraint action_nonce_digest_32_bytes check (
    action_nonce_digest is null or octet_length(action_nonce_digest) = 32
  )
);

create unique index reminder_messages_one_ordinary_per_day
  on app.reminder_messages (cliniccards_visit_id, target_date)
  where message_kind in ('initial_reminder', 'catchup_reminder');

create unique index reminder_messages_one_notice_per_fingerprint
  on app.reminder_messages (cliniccards_visit_id, target_date, message_kind, appointment_fingerprint)
  where message_kind in ('reschedule_notice', 'time_change_notice');

create index reminder_messages_by_target_date
  on app.reminder_messages (target_date, status);

create index reminder_messages_needs_attention
  on app.reminder_messages (target_date)
  where status in ('failed', 'send_unknown')
     or action_taken in ('pending_staff_review', 'error')
     or skip_reason is not null;

create index reminder_messages_by_run
  on app.reminder_messages (run_id);

create unique index reminder_messages_provider_message_id_uq
  on app.reminder_messages (provider_message_id)
  where provider_message_id is not null;

alter table app.reminder_messages
  add constraint claimed_or_live_token_required check (
    status not in ('sending', 'sent', 'delivered', 'send_unknown')
    or (tracking_token_digest is not null and token_expires_at is not null)
  );

create or replace function app.reminder_messages_action_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.action_locked_at is not null
     and (
       new.action_locked_at is distinct from old.action_locked_at
       or new.response is distinct from old.response
     ) then
    raise exception 'reminder_messages: a recorded action is single-use and immutable from this path (id=%)', old.id;
  end if;

  return new;
end;
$$;

create trigger reminder_messages_action_lock_guard
  before update on app.reminder_messages
  for each row execute function app.reminder_messages_action_immutable();

create table app.message_templates (
  id bigint generated always as identity primary key,
  key text not null,
  channel text not null,
  language text not null default 'uk',
  body text not null,
  buttons jsonb,
  version int not null default 1,
  active boolean not null default true,
  updated_at timestamptz not null default app.now()
);

create unique index message_templates_one_active
  on app.message_templates (key, channel, language)
  where active;

insert into app.message_templates(key, channel, language, body, buttons, version, active)
values (
  'appointment_reminder',
  'sms',
  'uk',
  $body${{name}}, ваш візит: завтра {{date}} о {{time}}.
Підтвердити/змінити: {{confirm_url}}. Тел: {{clinic_phone}}$body$,
  null,
  1,
  true
)
on conflict (key, channel, language) where active do update
   set body = excluded.body,
       buttons = excluded.buttons,
       version = excluded.version,
       active = excluded.active,
       updated_at = app.now();

create table app.inbound_events (
  id bigint generated always as identity primary key,
  provider text not null,
  raw_redacted jsonb,
  matched_message_id bigint references app.reminder_messages(id),
  received_at timestamptz not null default app.now(),
  purge_after timestamptz not null default (app.now() + interval '14 days')
);

create index inbound_events_purge
  on app.inbound_events (purge_after);

create table app.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default app.now(),
  actor text,
  action text,
  detail jsonb
);

create table app.consent_events (
  id bigint generated always as identity primary key,
  patient_id bigint references app.patients(id),
  scope text not null default 'sms_appointment_reminders',
  status text not null check (status in ('enabled', 'opted_out', 'staff_reenabled', 'revoked', 'staff_disabled')),
  source text not null check (source in ('clinic_contract', 'legacy_import', 'staff_dashboard', 'unsubscribe_link', 'patient_call', 'paper_form')),
  legal_basis text check (legal_basis is null or legal_basis in ('contract', 'legitimate_interest', 'consent')),
  notice_version text,
  proof_ref text,
  captured_at timestamptz not null default app.now(),
  captured_by text,
  request_meta jsonb,
  created_at timestamptz not null default app.now()
);

create index consent_events_patient
  on app.consent_events (patient_id, created_at desc);

alter table app.patients
  add constraint patients_last_consent_event_id_fkey
  foreign key (last_consent_event_id) references app.consent_events(id);

create table app.cancellation_circuits (
  target_date date primary key,
  threshold int not null,
  status text not null default 'closed'
    check (status in ('closed', 'open', 'manually_closed')),
  opened_at timestamptz,
  opened_reason text,
  created_at timestamptz not null default app.now()
);

create table app.crm_visit_write_locks (
  cliniccards_visit_id text primary key,
  lock_token uuid not null,
  locked_by_message_id bigint references app.reminder_messages(id),
  locked_at timestamptz not null default app.now(),
  lock_expires_at timestamptz not null
);

create table app.cliniccards_status_policy (
  status text primary key,
  remindable boolean not null default false,
  terminal boolean not null default false,
  allow_confirm_action boolean not null default false,
  allow_cancel_action boolean not null default true,
  send_change_notice boolean not null default false,
  description text,
  updated_at timestamptz not null default app.now()
);

insert into app.cliniccards_status_policy
  (status, remindable, terminal, allow_confirm_action, allow_cancel_action, send_change_notice, description)
values
  ('PLANNED', true, false, true, true, true, 'Scheduled / remindable'),
  ('NOT_CONFIRMED', true, false, true, true, true, 'Explicitly needs confirmation'),
  ('CONFIRMED', false, false, false, true, true, 'Already settled - do not spam'),
  ('BOOKING', false, false, false, false, false, 'Tentative/online booking - flag until clinic policy confirmed'),
  ('MOVED', false, false, false, false, false, 'Vendor semantics unconfirmed - skip'),
  ('CANCELLED', false, true, false, false, false, 'Terminal'),
  ('VISITED', false, true, false, false, false, 'Terminal'),
  ('DID_NOT_COME', false, true, false, false, false, 'Terminal'),
  ('IN_CLINIC', false, false, false, false, false, 'Day-of / in progress'),
  ('IN_CHAIR', false, false, false, false, false, 'Day-of / in progress');

create table app.crm_fetch_log (
  id bigint generated always as identity primary key,
  run_id bigint references app.reminder_runs(id),
  purpose text not null
    check (purpose in ('visits_initial', 'patients_batch', 'visits_pre_send', 'writeback_pre', 'writeback_post', 'catchup')),
  method text not null,
  path text not null,
  request_params jsonb,
  response_status int,
  raw_redacted jsonb,
  raw_sha256 bytea,
  fetched_at timestamptz not null default app.now(),
  purge_after timestamptz not null default (app.now() + interval '14 days'),
  constraint crm_fetch_log_raw_sha256_32_bytes check (
    raw_sha256 is null or octet_length(raw_sha256) = 32
  )
);

create index crm_fetch_log_run
  on app.crm_fetch_log (run_id, purpose);

create index crm_fetch_log_purge
  on app.crm_fetch_log (purge_after);

create table app.crm_visit_facts (
  run_id bigint not null references app.reminder_runs(id),
  purpose text not null check (purpose in ('visits_initial', 'visits_pre_send', 'catchup')),
  target_date date not null,
  cliniccards_visit_id text not null,
  cliniccards_patient_id text,
  source_status text not null,
  remindable boolean not null,
  target_at timestamptz,
  appointment_fingerprint text,
  fetched_at timestamptz not null default app.now(),
  primary key (run_id, cliniccards_visit_id, purpose)
);

create index crm_visit_facts_by_target_date
  on app.crm_visit_facts (target_date);

create or replace function maintenance.reap_stale_sends(p_target_date date default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  reaped_count integer;
begin
  update app.reminder_messages
     set status = 'send_unknown',
         skip_reason = 'send_ambiguous',
         error = 'stale send claim reaped',
         send_claim_token = null,
         send_claim_expires_at = null
   where status = 'sending'
     and send_claim_expires_at < app.now()
     and (p_target_date is null or target_date = p_target_date);

  get diagnostics reaped_count = row_count;

  insert into app.audit_log(actor, action, detail)
  values (
    'maintenance.reap_stale_sends',
    'reap_stale_sends',
    jsonb_build_object('target_date', p_target_date, 'reaped_count', reaped_count)
  );

  return reaped_count;
end;
$$;

revoke all on function maintenance.reap_stale_sends(date) from public;

create or replace function maintenance.purge_privacy()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inbound_deleted integer := 0;
  fetch_deleted integer := 0;
  messages_anonymized integer := 0;
  patients_pseudonymized integer := 0;
  consent_meta_cleared integer := 0;
  result jsonb;
begin
  delete from app.inbound_events
   where purge_after < app.now();
  get diagnostics inbound_deleted = row_count;

  delete from app.crm_fetch_log
   where purge_after < app.now();
  get diagnostics fetch_deleted = row_count;

  update app.reminder_messages
     set tracking_token_digest = case
           when tracking_token_digest is null then null
           else extensions.gen_random_bytes(32)
         end,
         action_nonce_digest = null,
         action_nonce_expires_at = null,
         patient_display_snapshot = null,
         error = null
   where target_date < (app.now()::date - interval '90 days')
     and (
       tracking_token_digest is not null
       or action_nonce_digest is not null
       or action_nonce_expires_at is not null
       or patient_display_snapshot is not null
       or error is not null
     );
  get diagnostics messages_anonymized = row_count;

  update app.patients p
     set first_name = null,
         last_name = null,
         phone_hmac = null,
         phone_last4 = null,
         sms_reminders_enabled = false,
         sms_reminders_status = 'unknown',
         sms_reminders_set_at = app.now(),
         updated_at = app.now()
   where not exists (
       select 1
         from app.reminder_messages m
        where m.patient_id = p.id
          and m.target_date >= (app.now()::date - interval '180 days')
     )
     and (
       p.first_name is not null
       or p.last_name is not null
       or p.phone_hmac is not null
       or p.phone_last4 is not null
       or p.sms_reminders_enabled is true
       or p.sms_reminders_status <> 'unknown'
     );
  get diagnostics patients_pseudonymized = row_count;

  update app.consent_events
     set request_meta = null
   where request_meta is not null
     and captured_at < app.now() - interval '14 days';
  get diagnostics consent_meta_cleared = row_count;

  result := jsonb_build_object(
    'inbound_events_deleted', inbound_deleted,
    'crm_fetch_log_deleted', fetch_deleted,
    'reminder_messages_anonymized', messages_anonymized,
    'patients_pseudonymized', patients_pseudonymized,
    'consent_request_meta_cleared', consent_meta_cleared
  );

  insert into app.audit_log(actor, action, detail)
  values ('maintenance.purge_privacy', 'purge_privacy', result);

  return result;
end;
$$;

revoke all on function maintenance.purge_privacy() from public;
