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
      [_ in never]: never;
    };
    Functions: {
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
      purge_privacy: { Args: never; Returns: Json };
      reap_stale_sends: { Args: { p_target_date?: string }; Returns: number };
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
