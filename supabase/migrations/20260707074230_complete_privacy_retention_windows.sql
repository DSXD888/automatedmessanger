-- Complete privacy retention windows for delivery summaries and audit/action events.
-- Source of truth: spec AC-FR-L4-HARD-02-f; research section 4.5 / ADR-016.

grant delete, select on app.reminder_days to dentino_maintenance_definer;
grant delete, update, select on app.reminder_runs to dentino_maintenance_definer;
grant update, select on app.audit_log to dentino_maintenance_definer;

drop policy if exists reminder_days_maintenance_definer_all on app.reminder_days;
create policy reminder_days_maintenance_definer_all on app.reminder_days
  for all to dentino_maintenance_definer using (true) with check (true);

drop policy if exists reminder_runs_maintenance_definer_all on app.reminder_runs;
create policy reminder_runs_maintenance_definer_all on app.reminder_runs
  for all to dentino_maintenance_definer using (true) with check (true);

drop policy if exists audit_log_maintenance_definer_all on app.audit_log;
create policy audit_log_maintenance_definer_all on app.audit_log
  for all to dentino_maintenance_definer using (true) with check (true);

create or replace function maintenance.purge_privacy()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inbound_deleted integer := 0;
  fetch_deleted integer := 0;
  reminder_days_deleted integer := 0;
  reminder_runs_deleted integer := 0;
  reminder_runs_anonymized integer := 0;
  messages_anonymized integer := 0;
  message_actions_pseudonymized integer := 0;
  patients_pseudonymized integer := 0;
  consent_meta_cleared integer := 0;
  audit_events_pseudonymized integer := 0;
  delivery_cutoff_date date := app.now()::date - 90;
  event_cutoff_at timestamptz := app.now() - interval '2 years';
  result jsonb;
begin
  delete from app.inbound_events
   where purge_after < app.now();
  get diagnostics inbound_deleted = row_count;

  delete from app.crm_fetch_log
   where purge_after < app.now();
  get diagnostics fetch_deleted = row_count;

  delete from app.reminder_days
   where target_date < delivery_cutoff_date;
  get diagnostics reminder_days_deleted = row_count;

  update app.reminder_messages
     set run_id = null,
         tracking_token_digest = case
           when tracking_token_digest is null then null
           else extensions.gen_random_bytes(32)
         end,
         action_nonce_digest = null,
         action_nonce_expires_at = null,
         patient_display_snapshot = null,
         error = null
   where target_date < delivery_cutoff_date
     and (
       run_id is not null
       or tracking_token_digest is not null
       or action_nonce_digest is not null
       or action_nonce_expires_at is not null
       or patient_display_snapshot is not null
       or error is not null
     );
  get diagnostics messages_anonymized = row_count;

  update app.reminder_messages
     set patient_id = null,
         cliniccards_visit_id = 'purged-' || id::text,
         appointment_fingerprint = null,
         source_status = null,
         provider_message_id = null,
         patient_display_snapshot = null,
         error = null
   where coalesce(responded_at, action_locked_at, target_at) < event_cutoff_at
     and (
       response is not null
       or action_locked_at is not null
       or action_taken <> 'none'
       or crm_writeback_ok is not null
     )
     and (
       patient_id is not null
       or cliniccards_visit_id <> 'purged-' || id::text
       or appointment_fingerprint is not null
       or source_status is not null
       or provider_message_id is not null
       or patient_display_snapshot is not null
       or error is not null
     );
  get diagnostics message_actions_pseudonymized = row_count;

  delete from app.reminder_runs run
   where run.target_date < delivery_cutoff_date
     and not exists (
       select 1
         from app.reminder_days day
        where day.locked_by_run_id = run.id
     )
     and not exists (
       select 1
         from app.reminder_messages message
        where message.run_id = run.id
     )
     and not exists (
       select 1
         from app.crm_fetch_log fetch_log
        where fetch_log.run_id = run.id
     )
     and not exists (
       select 1
         from app.crm_visit_facts fact
        where fact.run_id = run.id
     );
  get diagnostics reminder_runs_deleted = row_count;

  update app.reminder_runs
     set status = 'completed',
         total = 0,
         sent = 0,
         failed = 0,
         skipped = 0,
         finished_at = null
   where target_date < delivery_cutoff_date
     and (
       status <> 'completed'
       or total <> 0
       or sent <> 0
       or failed <> 0
       or skipped <> 0
       or finished_at is not null
     );
  get diagnostics reminder_runs_anonymized = row_count;

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

  update app.audit_log
     set actor = null,
         detail = jsonb_build_object(
           'pseudonymized_at', app.now(),
           'retention_window', '2 years'
         )
   where at < event_cutoff_at
     and (
       actor is not null
       or detail is null
       or not (
         detail ? 'pseudonymized_at'
         and detail->>'retention_window' = '2 years'
       )
     );
  get diagnostics audit_events_pseudonymized = row_count;

  result := jsonb_build_object(
    'inbound_events_deleted', inbound_deleted,
    'crm_fetch_log_deleted', fetch_deleted,
    'reminder_days_deleted', reminder_days_deleted,
    'reminder_runs_deleted', reminder_runs_deleted,
    'reminder_runs_anonymized', reminder_runs_anonymized,
    'reminder_messages_anonymized', messages_anonymized,
    'reminder_message_actions_pseudonymized', message_actions_pseudonymized,
    'patients_pseudonymized', patients_pseudonymized,
    'consent_request_meta_cleared', consent_meta_cleared,
    'audit_events_pseudonymized', audit_events_pseudonymized
  );

  insert into app.audit_log(actor, action, detail)
  values ('maintenance.purge_privacy', 'purge_privacy', result);

  return result;
end;
$$;

alter function maintenance.purge_privacy() owner to dentino_maintenance_definer;
revoke execute on function maintenance.purge_privacy() from public, anon, authenticated, dentino_confirm_api, dentino_run_api;
grant execute on function maintenance.purge_privacy() to dentino_maintenance_runner;
