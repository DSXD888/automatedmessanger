export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  api: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      v_board: {
        Row: {
          action_taken: string | null;
          cliniccards_total: number | null;
          cliniccards_visit_id: string | null;
          crm_writeback_ok: boolean | null;
          day_health: string | null;
          failed_total: number | null;
          latest_pass_kind: string | null;
          latest_run_finished_at: string | null;
          latest_run_id: number | null;
          message_id: number | null;
          needs_attention: boolean | null;
          patient_display: string | null;
          patient_phone_last4: string | null;
          pending_total: number | null;
          remindable_total: number | null;
          response_state: string | null;
          send_state: string | null;
          send_unknown_total: number | null;
          sendable_total: number | null;
          sent_total: number | null;
          skip_reason: string | null;
          skipped_total: number | null;
          source_status: string | null;
          staff_reason_tag: string | null;
          staff_reason_tagged_at: string | null;
          staff_state: string | null;
          success_heartbeat_sent: boolean | null;
          target_at: string | null;
          target_date: string | null;
          target_time_kyiv: string | null;
          unaccounted_total: number | null;
        };
        Relationships: [];
      };
      v_needs_attention: {
        Row: {
          action_taken: string | null;
          cliniccards_total: number | null;
          cliniccards_visit_id: string | null;
          crm_writeback_ok: boolean | null;
          day_health: string | null;
          failed_total: number | null;
          latest_pass_kind: string | null;
          latest_run_finished_at: string | null;
          latest_run_id: number | null;
          message_id: number | null;
          needs_attention: boolean | null;
          patient_display: string | null;
          patient_phone_last4: string | null;
          pending_total: number | null;
          remindable_total: number | null;
          response_state: string | null;
          send_state: string | null;
          send_unknown_total: number | null;
          sendable_total: number | null;
          sent_total: number | null;
          skip_reason: string | null;
          skipped_total: number | null;
          source_status: string | null;
          staff_reason_tag: string | null;
          staff_reason_tagged_at: string | null;
          staff_state: string | null;
          success_heartbeat_sent: boolean | null;
          target_at: string | null;
          target_date: string | null;
          target_time_kyiv: string | null;
          unaccounted_total: number | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      crm_write_lock_still_owns: {
        Args: {
          p_cliniccards_visit_id: string;
          p_lock_token: string;
          p_message_id: number;
        };
        Returns: boolean;
      };
      dashboard_board_rows: {
        Args: never;
        Returns: {
          action_taken: string;
          cliniccards_total: number;
          cliniccards_visit_id: string;
          crm_writeback_ok: boolean;
          day_health: string;
          failed_total: number;
          latest_pass_kind: string;
          latest_run_finished_at: string;
          latest_run_id: number;
          message_id: number;
          needs_attention: boolean;
          patient_display: string;
          patient_phone_last4: string;
          pending_total: number;
          remindable_total: number;
          response_state: string;
          send_state: string;
          send_unknown_total: number;
          sendable_total: number;
          sent_total: number;
          skip_reason: string;
          skipped_total: number;
          source_status: string;
          staff_reason_tag: string;
          staff_reason_tagged_at: string;
          staff_state: string;
          success_heartbeat_sent: boolean;
          target_at: string;
          target_date: string;
          target_time_kyiv: string;
          unaccounted_total: number;
        }[];
      };
      dashboard_needs_attention_rows: {
        Args: never;
        Returns: {
          action_taken: string;
          cliniccards_total: number;
          cliniccards_visit_id: string;
          crm_writeback_ok: boolean;
          day_health: string;
          failed_total: number;
          latest_pass_kind: string;
          latest_run_finished_at: string;
          latest_run_id: number;
          message_id: number;
          needs_attention: boolean;
          patient_display: string;
          patient_phone_last4: string;
          pending_total: number;
          remindable_total: number;
          response_state: string;
          send_state: string;
          send_unknown_total: number;
          sendable_total: number;
          sent_total: number;
          skip_reason: string;
          skipped_total: number;
          source_status: string;
          staff_reason_tag: string;
          staff_reason_tagged_at: string;
          staff_state: string;
          success_heartbeat_sent: boolean;
          target_at: string;
          target_date: string;
          target_time_kyiv: string;
          unaccounted_total: number;
        }[];
      };
      finish_reminder_action: {
        Args: {
          p_error?: string;
          p_message_id: number;
          p_meta?: Json;
          p_ok: boolean;
        };
        Returns: {
          neutral_reason: string;
          ok: boolean;
        }[];
      };
      lookup_reminder_by_token: {
        Args: { p_raw_token: string };
        Returns: {
          already_responded: boolean;
          clinic_phone: string;
          display_snapshot: string;
          neutral_reason: string;
          ok: boolean;
          response: string;
          target_at: string;
        }[];
      };
      prepare_reminder_action: {
        Args: { p_action: string; p_raw_token: string };
        Returns: {
          action_nonce: string;
          clinic_phone: string;
          display_snapshot: string;
          neutral_reason: string;
          nonce_expires_at: string;
          ok: boolean;
          target_at: string;
        }[];
      };
      record_go_live_mode_flip: {
        Args: {
          p_actor: string;
          p_context?: Json;
          p_new_crm_write_mode: string;
          p_new_send_mode: string;
          p_prior_crm_write_mode: string;
          p_prior_send_mode: string;
          p_target_date?: string;
          p_typed_confirmation?: string;
        };
        Returns: Json;
      };
      record_no_reply_reason_tag: {
        Args: { p_actor?: string; p_message_id: number; p_reason: string };
        Returns: {
          message_id: number;
          staff_reason_tag: string;
          staff_reason_tagged_at: string;
        }[];
      };
      record_reminder_action: {
        Args: { p_action: string; p_nonce: string; p_raw_token: string };
        Returns: {
          action_taken: string;
          cliniccards_visit_id: string;
          crm_target_status: string;
          display_snapshot: string;
          lock_token: string;
          message_id: number;
          neutral_reason: string;
          ok: boolean;
          target_at: string;
        }[];
      };
      reenable_sms_reminders: {
        Args: { p_actor?: string; p_patient_id: number; p_proof_ref?: string };
        Returns: {
          consent_event_id: number;
          patient_id: number;
          sms_reminders_enabled: boolean;
          sms_reminders_status: string;
        }[];
      };
      resolve_held_cancels: {
        Args: {
          p_actor?: string;
          p_message_ids?: number[];
          p_resolution?: string;
          p_revalidation?: Json;
          p_target_date: string;
        };
        Returns: {
          action_taken: string;
          crm_writeback_ok: boolean;
          message_id: number;
        }[];
      };
      run_claim_day: {
        Args: {
          p_lock_token: string;
          p_now: string;
          p_pass_kind: string;
          p_run_id: number;
          p_target_date: string;
        };
        Returns: {
          claimed: boolean;
          reason: string;
          stole_existing_lease: boolean;
        }[];
      };
      run_claim_message_for_send: {
        Args: {
          p_claim_expires_at: string;
          p_claim_token: string;
          p_message_id: number;
          p_now: string;
          p_token_digest_hex: string;
          p_token_expires_at: string;
        };
        Returns: {
          action_taken: string;
          appointment_fingerprint: string;
          channel: string;
          cliniccards_patient_id: string;
          cliniccards_visit_id: string;
          crm_writeback_ok: boolean;
          error: string;
          id: number;
          last_attempt_at: string;
          message_kind: string;
          patient_display_snapshot: string;
          patient_id: number;
          provider_message_id: string;
          run_id: number;
          send_attempt_count: number;
          send_claim_expires_at: string;
          send_claim_token: string;
          skip_reason: string;
          source_status: string;
          status: string;
          superseded_at: string;
          superseded_by_message_id: number;
          target_at: string;
          target_date: string;
          token_expires_at: string;
          tracking_token_digest_hex: string;
        }[];
      };
      run_cliniccards_status_policy: {
        Args: never;
        Returns: {
          allow_cancel_action: boolean;
          allow_confirm_action: boolean;
          remindable: boolean;
          send_change_notice: boolean;
          status: string;
          terminal: boolean;
        }[];
      };
      run_commit_send_outcome: {
        Args: {
          p_claim_token: string;
          p_error: string;
          p_message_id: number;
          p_now: string;
          p_provider_message_id: string;
          p_skip_reason: string;
          p_status: string;
        };
        Returns: boolean;
      };
      run_finish_run: {
        Args: {
          p_now: string;
          p_reconciliation: Json;
          p_run_id: number;
          p_status: string;
        };
        Returns: {
          finished_at: string;
          id: number;
          pass_kind: string;
          run_date: string;
          started_at: string;
          status: string;
          target_date: string;
          trigger: string;
        }[];
      };
      run_finish_writeback: {
        Args: { p_error?: string; p_message_id: number; p_ok: boolean };
        Returns: boolean;
      };
      run_mark_message_skipped: {
        Args: { p_error?: string; p_message_id: number; p_reason: string };
        Returns: undefined;
      };
      run_materialize_message: {
        Args: {
          p_appointment_fingerprint: string;
          p_cliniccards_patient_id: string;
          p_cliniccards_visit_id: string;
          p_message_kind: string;
          p_now: string;
          p_patient_display_snapshot: string;
          p_run_id: number;
          p_skip_reason: string;
          p_source_status: string;
          p_status: string;
          p_target_at: string;
          p_target_date: string;
        };
        Returns: {
          action_taken: string;
          appointment_fingerprint: string;
          channel: string;
          cliniccards_patient_id: string;
          cliniccards_visit_id: string;
          crm_writeback_ok: boolean;
          error: string;
          id: number;
          last_attempt_at: string;
          message_kind: string;
          patient_display_snapshot: string;
          patient_id: number;
          provider_message_id: string;
          run_id: number;
          send_attempt_count: number;
          send_claim_expires_at: string;
          send_claim_token: string;
          skip_reason: string;
          source_status: string;
          status: string;
          superseded_at: string;
          superseded_by_message_id: number;
          target_at: string;
          target_date: string;
          token_expires_at: string;
          tracking_token_digest_hex: string;
        }[];
      };
      run_messages_for_target_date: {
        Args: { p_target_date: string };
        Returns: {
          action_taken: string;
          appointment_fingerprint: string;
          channel: string;
          cliniccards_patient_id: string;
          cliniccards_visit_id: string;
          crm_writeback_ok: boolean;
          error: string;
          id: number;
          last_attempt_at: string;
          message_kind: string;
          patient_display_snapshot: string;
          patient_id: number;
          provider_message_id: string;
          run_id: number;
          send_attempt_count: number;
          send_claim_expires_at: string;
          send_claim_token: string;
          skip_reason: string;
          source_status: string;
          status: string;
          superseded_at: string;
          superseded_by_message_id: number;
          target_at: string;
          target_date: string;
          token_expires_at: string;
          tracking_token_digest_hex: string;
        }[];
      };
      run_pending_writebacks: {
        Args: never;
        Returns: {
          action: string;
          cliniccards_visit_id: string;
          crm_writeback_ok: boolean;
          expected_appointment_fingerprint: string;
          message_id: number;
          superseded_at: string;
        }[];
      };
      run_reap_expired_send_claims: {
        Args: { p_now: string; p_target_date: string };
        Returns: number;
      };
      run_reap_orphaned_send_claims: {
        Args: { p_now: string; p_target_date: string };
        Returns: number;
      };
      run_reconcile_day: {
        Args: { p_now: string; p_target_date: string };
        Returns: {
          cliniccards_total: number;
          failed_total: number;
          health: string;
          pending_total: number;
          remindable_total: number;
          send_unknown_total: number;
          sendable_total: number;
          sent_total: number;
          skipped_total: number;
          target_date: string;
          unaccounted_total: number;
          writeback_pending_total: number;
        }[];
      };
      run_record_fetch_logs: {
        Args: { p_logs: Json; p_run_id: number };
        Returns: number;
      };
      run_record_visit_facts: {
        Args: { p_facts: Json; p_run_id: number };
        Returns: number;
      };
      run_renew_day_heartbeat: {
        Args: {
          p_lock_token: string;
          p_now: string;
          p_run_id: number;
          p_target_date: string;
        };
        Returns: boolean;
      };
      run_start_run: {
        Args: {
          p_now: string;
          p_pass_kind: string;
          p_run_date: string;
          p_target_date: string;
          p_trigger: string;
        };
        Returns: {
          finished_at: string;
          id: number;
          pass_kind: string;
          run_date: string;
          started_at: string;
          status: string;
          target_date: string;
          trigger: string;
        }[];
      };
      update_message_template: {
        Args: { p_actor?: string; p_body: string; p_template_id: number };
        Returns: {
          active: boolean;
          body: string;
          channel: string;
          id: number;
          key: string;
          language: string;
          updated_at: string;
          version: number;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  app: {
    Tables: {
      audit_log: {
        Row: {
          action: string | null;
          actor: string | null;
          at: string;
          detail: Json | null;
          id: number;
        };
        Insert: {
          action?: string | null;
          actor?: string | null;
          at?: string;
          detail?: Json | null;
          id?: never;
        };
        Update: {
          action?: string | null;
          actor?: string | null;
          at?: string;
          detail?: Json | null;
          id?: never;
        };
        Relationships: [];
      };
      cancellation_circuits: {
        Row: {
          created_at: string;
          opened_at: string | null;
          opened_reason: string | null;
          status: string;
          target_date: string;
          threshold: number;
        };
        Insert: {
          created_at?: string;
          opened_at?: string | null;
          opened_reason?: string | null;
          status?: string;
          target_date: string;
          threshold: number;
        };
        Update: {
          created_at?: string;
          opened_at?: string | null;
          opened_reason?: string | null;
          status?: string;
          target_date?: string;
          threshold?: number;
        };
        Relationships: [];
      };
      cliniccards_status_policy: {
        Row: {
          allow_cancel_action: boolean;
          allow_confirm_action: boolean;
          description: string | null;
          remindable: boolean;
          send_change_notice: boolean;
          status: string;
          terminal: boolean;
          updated_at: string;
        };
        Insert: {
          allow_cancel_action?: boolean;
          allow_confirm_action?: boolean;
          description?: string | null;
          remindable?: boolean;
          send_change_notice?: boolean;
          status: string;
          terminal?: boolean;
          updated_at?: string;
        };
        Update: {
          allow_cancel_action?: boolean;
          allow_confirm_action?: boolean;
          description?: string | null;
          remindable?: boolean;
          send_change_notice?: boolean;
          status?: string;
          terminal?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      consent_events: {
        Row: {
          captured_at: string;
          captured_by: string | null;
          created_at: string;
          id: number;
          legal_basis: string | null;
          notice_version: string | null;
          patient_id: number | null;
          proof_ref: string | null;
          request_meta: Json | null;
          scope: string;
          source: string;
          status: string;
        };
        Insert: {
          captured_at?: string;
          captured_by?: string | null;
          created_at?: string;
          id?: never;
          legal_basis?: string | null;
          notice_version?: string | null;
          patient_id?: number | null;
          proof_ref?: string | null;
          request_meta?: Json | null;
          scope?: string;
          source: string;
          status: string;
        };
        Update: {
          captured_at?: string;
          captured_by?: string | null;
          created_at?: string;
          id?: never;
          legal_basis?: string | null;
          notice_version?: string | null;
          patient_id?: number | null;
          proof_ref?: string | null;
          request_meta?: Json | null;
          scope?: string;
          source?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "consent_events_patient_id_fkey";
            columns: ["patient_id"];
            isOneToOne: false;
            referencedRelation: "patients";
            referencedColumns: ["id"];
          },
        ];
      };
      crm_fetch_log: {
        Row: {
          fetched_at: string;
          id: number;
          method: string;
          path: string;
          purge_after: string;
          purpose: string;
          raw_redacted: Json | null;
          raw_sha256: string | null;
          request_params: Json | null;
          response_status: number | null;
          run_id: number | null;
        };
        Insert: {
          fetched_at?: string;
          id?: never;
          method: string;
          path: string;
          purge_after?: string;
          purpose: string;
          raw_redacted?: Json | null;
          raw_sha256?: string | null;
          request_params?: Json | null;
          response_status?: number | null;
          run_id?: number | null;
        };
        Update: {
          fetched_at?: string;
          id?: never;
          method?: string;
          path?: string;
          purge_after?: string;
          purpose?: string;
          raw_redacted?: Json | null;
          raw_sha256?: string | null;
          request_params?: Json | null;
          response_status?: number | null;
          run_id?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "crm_fetch_log_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "reminder_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      crm_visit_facts: {
        Row: {
          appointment_fingerprint: string | null;
          cliniccards_patient_id: string | null;
          cliniccards_visit_id: string;
          fetched_at: string;
          purpose: string;
          remindable: boolean;
          run_id: number;
          source_status: string;
          target_at: string | null;
          target_date: string;
        };
        Insert: {
          appointment_fingerprint?: string | null;
          cliniccards_patient_id?: string | null;
          cliniccards_visit_id: string;
          fetched_at?: string;
          purpose: string;
          remindable: boolean;
          run_id: number;
          source_status: string;
          target_at?: string | null;
          target_date: string;
        };
        Update: {
          appointment_fingerprint?: string | null;
          cliniccards_patient_id?: string | null;
          cliniccards_visit_id?: string;
          fetched_at?: string;
          purpose?: string;
          remindable?: boolean;
          run_id?: number;
          source_status?: string;
          target_at?: string | null;
          target_date?: string;
        };
        Relationships: [
          {
            foreignKeyName: "crm_visit_facts_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "reminder_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      crm_visit_write_locks: {
        Row: {
          cliniccards_visit_id: string;
          lock_expires_at: string;
          lock_token: string;
          locked_at: string;
          locked_by_message_id: number | null;
        };
        Insert: {
          cliniccards_visit_id: string;
          lock_expires_at: string;
          lock_token: string;
          locked_at?: string;
          locked_by_message_id?: number | null;
        };
        Update: {
          cliniccards_visit_id?: string;
          lock_expires_at?: string;
          lock_token?: string;
          locked_at?: string;
          locked_by_message_id?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "crm_visit_write_locks_locked_by_message_id_fkey";
            columns: ["locked_by_message_id"];
            isOneToOne: false;
            referencedRelation: "reminder_messages";
            referencedColumns: ["id"];
          },
        ];
      };
      inbound_events: {
        Row: {
          id: number;
          matched_message_id: number | null;
          provider: string;
          purge_after: string;
          raw_redacted: Json | null;
          received_at: string;
        };
        Insert: {
          id?: never;
          matched_message_id?: number | null;
          provider: string;
          purge_after?: string;
          raw_redacted?: Json | null;
          received_at?: string;
        };
        Update: {
          id?: never;
          matched_message_id?: number | null;
          provider?: string;
          purge_after?: string;
          raw_redacted?: Json | null;
          received_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inbound_events_matched_message_id_fkey";
            columns: ["matched_message_id"];
            isOneToOne: false;
            referencedRelation: "reminder_messages";
            referencedColumns: ["id"];
          },
        ];
      };
      message_templates: {
        Row: {
          active: boolean;
          body: string;
          buttons: Json | null;
          channel: string;
          id: number;
          key: string;
          language: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          active?: boolean;
          body: string;
          buttons?: Json | null;
          channel: string;
          id?: never;
          key: string;
          language?: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          active?: boolean;
          body?: string;
          buttons?: Json | null;
          channel?: string;
          id?: never;
          key?: string;
          language?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [];
      };
      patients: {
        Row: {
          cliniccards_id: string;
          created_at: string;
          first_name: string | null;
          id: number;
          language: string | null;
          last_consent_event_id: number | null;
          last_name: string | null;
          phone_country: string | null;
          phone_hmac: string | null;
          phone_last4: string | null;
          sms_reminders_enabled: boolean;
          sms_reminders_set_at: string | null;
          sms_reminders_status: string;
          updated_at: string;
        };
        Insert: {
          cliniccards_id: string;
          created_at?: string;
          first_name?: string | null;
          id?: never;
          language?: string | null;
          last_consent_event_id?: number | null;
          last_name?: string | null;
          phone_country?: string | null;
          phone_hmac?: string | null;
          phone_last4?: string | null;
          sms_reminders_enabled?: boolean;
          sms_reminders_set_at?: string | null;
          sms_reminders_status?: string;
          updated_at?: string;
        };
        Update: {
          cliniccards_id?: string;
          created_at?: string;
          first_name?: string | null;
          id?: never;
          language?: string | null;
          last_consent_event_id?: number | null;
          last_name?: string | null;
          phone_country?: string | null;
          phone_hmac?: string | null;
          phone_last4?: string | null;
          sms_reminders_enabled?: boolean;
          sms_reminders_set_at?: string | null;
          sms_reminders_status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "patients_last_consent_event_id_fkey";
            columns: ["last_consent_event_id"];
            isOneToOne: false;
            referencedRelation: "consent_events";
            referencedColumns: ["id"];
          },
        ];
      };
      reminder_days: {
        Row: {
          cliniccards_total: number | null;
          failed_total: number | null;
          health: string | null;
          lock_expires_at: string | null;
          lock_heartbeat_at: string | null;
          lock_started_at: string | null;
          lock_token: string | null;
          locked_by_run_id: number | null;
          pending_total: number | null;
          reconciled_at: string | null;
          remindable_total: number | null;
          send_unknown_total: number | null;
          sendable_total: number | null;
          sent_total: number | null;
          skipped_total: number | null;
          status: string;
          target_date: string;
          unaccounted_total: number | null;
          updated_at: string;
        };
        Insert: {
          cliniccards_total?: number | null;
          failed_total?: number | null;
          health?: string | null;
          lock_expires_at?: string | null;
          lock_heartbeat_at?: string | null;
          lock_started_at?: string | null;
          lock_token?: string | null;
          locked_by_run_id?: number | null;
          pending_total?: number | null;
          reconciled_at?: string | null;
          remindable_total?: number | null;
          send_unknown_total?: number | null;
          sendable_total?: number | null;
          sent_total?: number | null;
          skipped_total?: number | null;
          status?: string;
          target_date: string;
          unaccounted_total?: number | null;
          updated_at?: string;
        };
        Update: {
          cliniccards_total?: number | null;
          failed_total?: number | null;
          health?: string | null;
          lock_expires_at?: string | null;
          lock_heartbeat_at?: string | null;
          lock_started_at?: string | null;
          lock_token?: string | null;
          locked_by_run_id?: number | null;
          pending_total?: number | null;
          reconciled_at?: string | null;
          remindable_total?: number | null;
          send_unknown_total?: number | null;
          sendable_total?: number | null;
          sent_total?: number | null;
          skipped_total?: number | null;
          status?: string;
          target_date?: string;
          unaccounted_total?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reminder_days_locked_by_run_id_fkey";
            columns: ["locked_by_run_id"];
            isOneToOne: false;
            referencedRelation: "reminder_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      reminder_messages: {
        Row: {
          action_locked_at: string | null;
          action_nonce_digest: string | null;
          action_nonce_expires_at: string | null;
          action_taken: string;
          appointment_fingerprint: string | null;
          channel: string;
          cliniccards_visit_id: string;
          created_at: string;
          crm_writeback_ok: boolean | null;
          error: string | null;
          id: number;
          last_attempt_at: string | null;
          message_kind: string;
          patient_display_snapshot: string | null;
          patient_id: number | null;
          provider_message_id: string | null;
          responded_at: string | null;
          response: string | null;
          run_id: number | null;
          send_attempt_count: number;
          send_claim_expires_at: string | null;
          send_claim_token: string | null;
          skip_reason: string | null;
          source_status: string | null;
          staff_reason_tag: string | null;
          staff_reason_tagged_at: string | null;
          staff_reason_tagged_by: string | null;
          status: string;
          superseded_at: string | null;
          superseded_by_message_id: number | null;
          target_at: string;
          target_date: string;
          token_expires_at: string | null;
          tracking_token_digest: string | null;
        };
        Insert: {
          action_locked_at?: string | null;
          action_nonce_digest?: string | null;
          action_nonce_expires_at?: string | null;
          action_taken?: string;
          appointment_fingerprint?: string | null;
          channel?: string;
          cliniccards_visit_id: string;
          created_at?: string;
          crm_writeback_ok?: boolean | null;
          error?: string | null;
          id?: never;
          last_attempt_at?: string | null;
          message_kind?: string;
          patient_display_snapshot?: string | null;
          patient_id?: number | null;
          provider_message_id?: string | null;
          responded_at?: string | null;
          response?: string | null;
          run_id?: number | null;
          send_attempt_count?: number;
          send_claim_expires_at?: string | null;
          send_claim_token?: string | null;
          skip_reason?: string | null;
          source_status?: string | null;
          staff_reason_tag?: string | null;
          staff_reason_tagged_at?: string | null;
          staff_reason_tagged_by?: string | null;
          status?: string;
          superseded_at?: string | null;
          superseded_by_message_id?: number | null;
          target_at: string;
          target_date: string;
          token_expires_at?: string | null;
          tracking_token_digest?: string | null;
        };
        Update: {
          action_locked_at?: string | null;
          action_nonce_digest?: string | null;
          action_nonce_expires_at?: string | null;
          action_taken?: string;
          appointment_fingerprint?: string | null;
          channel?: string;
          cliniccards_visit_id?: string;
          created_at?: string;
          crm_writeback_ok?: boolean | null;
          error?: string | null;
          id?: never;
          last_attempt_at?: string | null;
          message_kind?: string;
          patient_display_snapshot?: string | null;
          patient_id?: number | null;
          provider_message_id?: string | null;
          responded_at?: string | null;
          response?: string | null;
          run_id?: number | null;
          send_attempt_count?: number;
          send_claim_expires_at?: string | null;
          send_claim_token?: string | null;
          skip_reason?: string | null;
          source_status?: string | null;
          staff_reason_tag?: string | null;
          staff_reason_tagged_at?: string | null;
          staff_reason_tagged_by?: string | null;
          status?: string;
          superseded_at?: string | null;
          superseded_by_message_id?: number | null;
          target_at?: string;
          target_date?: string;
          token_expires_at?: string | null;
          tracking_token_digest?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "reminder_messages_patient_id_fkey";
            columns: ["patient_id"];
            isOneToOne: false;
            referencedRelation: "patients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reminder_messages_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "reminder_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reminder_messages_superseded_by_message_id_fkey";
            columns: ["superseded_by_message_id"];
            isOneToOne: false;
            referencedRelation: "reminder_messages";
            referencedColumns: ["id"];
          },
        ];
      };
      reminder_runs: {
        Row: {
          failed: number;
          finished_at: string | null;
          id: number;
          pass_kind: string;
          run_date: string;
          sent: number;
          skipped: number;
          started_at: string;
          status: string;
          target_date: string;
          total: number;
          trigger: string;
        };
        Insert: {
          failed?: number;
          finished_at?: string | null;
          id?: never;
          pass_kind?: string;
          run_date: string;
          sent?: number;
          skipped?: number;
          started_at?: string;
          status?: string;
          target_date: string;
          total?: number;
          trigger: string;
        };
        Update: {
          failed?: number;
          finished_at?: string | null;
          id?: never;
          pass_kind?: string;
          run_date?: string;
          sent?: number;
          skipped?: number;
          started_at?: string;
          status?: string;
          target_date?: string;
          total?: number;
          trigger?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      appointment_fingerprint: {
        Args: {
          cabinet_id?: string;
          cliniccards_patient_id?: string;
          doctor_id?: string;
          source_status: string;
          visit_end: string;
          visit_start: string;
        };
        Returns: string;
      };
      now: { Args: never; Returns: string };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  maintenance: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      invoke_run_reminders: {
        Args: { p_pass_kind: string; p_target_date?: string };
        Returns: number;
      };
      purge_privacy: { Args: never; Returns: Json };
      reap_stale_sends: { Args: { p_target_date?: string }; Returns: number };
      record_guard_liveness: {
        Args: {
          p_actor?: string;
          p_context?: Json;
          p_crm_write_allowlist_count: number;
          p_dashboard_mode: string;
          p_effective_crm_write_mode: string;
          p_effective_send_mode: string;
          p_send_allowlist_count: number;
        };
        Returns: {
          alert: boolean;
          audit_id: number;
          status: string;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  private: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      assert_sms_template_body: {
        Args: { p_body: string };
        Returns: undefined;
      };
      token_digest: { Args: { p_raw_token: string }; Returns: string };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema =
  DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof (
      & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
        "Tables"
      ]
      & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
        "Views"
      ]
    )
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? (
    & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
      "Tables"
    ]
    & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
      "Views"
    ]
  )[TableName] extends {
    Row: infer R;
  } ? R
  : never
  : DefaultSchemaTableNameOrOptions extends keyof (
    & DefaultSchema["Tables"]
    & DefaultSchema["Views"]
  ) ? (
      & DefaultSchema["Tables"]
      & DefaultSchema["Views"]
    )[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R;
    } ? R
    : never
  : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
      "Tables"
    ]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
    "Tables"
  ][TableName] extends {
    Insert: infer I;
  } ? I
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I;
    } ? I
    : never
  : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
      "Tables"
    ]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
    "Tables"
  ][TableName] extends {
    Update: infer U;
  } ? U
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U;
    } ? U
    : never
  : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]][
      "Enums"
    ]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][
    EnumName
  ]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[
      PublicCompositeTypeNameOrOptions["schema"]
    ]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]][
    "CompositeTypes"
  ][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never;

export const Constants = {
  api: {
    Enums: {},
  },
  app: {
    Enums: {},
  },
  maintenance: {
    Enums: {},
  },
  private: {
    Enums: {},
  },
} as const;
