alter table app.reminder_messages
  drop constraint if exists reminder_messages_skip_reason_check;

alter table app.reminder_messages
  add constraint reminder_messages_skip_reason_check
  check (
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
  );
