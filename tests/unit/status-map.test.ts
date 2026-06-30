import { assertEquals } from "@std/assert";
import type {
  ClinicCardsPatient,
  ClinicCardsStatusPolicyEntry,
  ClinicCardsVisit,
} from "../../supabase/functions/_shared/clinicCardsClient.ts";
import {
  classifyClinicCardsStatus,
  createClinicCardsStatusPolicy,
} from "../../supabase/functions/_shared/clinicCardsClient.ts";
import {
  classifyReminderEligibility,
  type ReminderSkipReason,
} from "../../supabase/functions/run-reminders/index.ts";

const statusPolicy: readonly ClinicCardsStatusPolicyEntry[] = [
  {
    status: "PLANNED",
    remindable: true,
    terminal: false,
    allowConfirmAction: true,
    allowCancelAction: true,
    sendChangeNotice: true,
  },
  {
    status: "NOT_CONFIRMED",
    remindable: true,
    terminal: false,
    allowConfirmAction: true,
    allowCancelAction: true,
    sendChangeNotice: true,
  },
  {
    status: "MOVED",
    remindable: false,
    terminal: false,
  },
  {
    status: "CONFIRMED",
    remindable: false,
    terminal: false,
  },
  {
    status: "CANCELLED",
    remindable: false,
    terminal: true,
  },
];

const policy = createClinicCardsStatusPolicy(statusPolicy);

Deno.test("UT-STATUS-01 classifies eligible ClinicCards statuses and fails closed on unknowns", () => {
  assertEquals(
    classifyReminderEligibility({
      visit: visit("visit-planned", "PLANNED"),
      patient: patient(),
    }),
    { sendable: true },
  );
  assertEquals(
    classifyReminderEligibility({
      visit: visit("visit-not-confirmed", "NOT_CONFIRMED"),
      patient: patient(),
    }),
    { sendable: true },
  );
  assertEquals(
    classifyReminderEligibility({
      visit: visit("visit-unknown", "RESERVED"),
      patient: patient(),
    }),
    { sendable: false, reason: "unknown_status" },
  );
});

Deno.test("UT-STATUS-01 emits explicit skip reasons for non-sendable visits", () => {
  const cases: Array<{
    name: string;
    visit: ClinicCardsVisit;
    patient: ClinicCardsPatient | null;
    reason: ReminderSkipReason;
  }> = [
    {
      name: "disabled patient",
      visit: visit("visit-disabled", "PLANNED"),
      patient: patient({ smsRemindersEnabled: false }),
      reason: "not_enabled",
    },
    {
      name: "missing phone",
      visit: visit("visit-no-phone", "PLANNED"),
      patient: patient({
        mobileE164: null,
        phoneLast4: null,
        phoneInvalidReason: "missing_phone",
      }),
      reason: "no_phone",
    },
    {
      name: "invalid phone",
      visit: visit("visit-invalid-phone", "PLANNED"),
      patient: patient({
        mobileE164: null,
        phoneLast4: null,
        phoneInvalidReason: "invalid_ukrainian_mobile",
      }),
      reason: "invalid_phone",
    },
    {
      name: "missing patient",
      visit: visit("visit-missing-patient", "PLANNED", { patientId: null }),
      patient: null,
      reason: "missing_patient",
    },
    {
      name: "moved",
      visit: visit("visit-moved", "MOVED"),
      patient: patient(),
      reason: "moved_before_send",
    },
    {
      name: "cancelled",
      visit: visit("visit-cancelled", "CANCELLED"),
      patient: patient(),
      reason: "cancelled_before_send",
    },
    {
      name: "confirmed",
      visit: visit("visit-confirmed", "CONFIRMED"),
      patient: patient(),
      reason: "non_remindable_status",
    },
  ];

  for (const testCase of cases) {
    assertEquals(
      classifyReminderEligibility({
        visit: testCase.visit,
        patient: testCase.patient,
      }),
      { sendable: false, reason: testCase.reason },
      testCase.name,
    );
  }
});

function patient(
  overrides: Partial<ClinicCardsPatient> = {},
): ClinicCardsPatient {
  return Object.freeze({
    id: "patient-1",
    firstName: "Олена",
    lastName: "Іваненко",
    mobileE164: "+380670000000",
    phoneLast4: "0000",
    phoneCountry: "UA",
    phoneInvalidReason: null,
    smsRemindersEnabled: true,
    ...overrides,
  });
}

function visit(
  id: string,
  status: string,
  overrides: {
    patientId?: string | null;
    targetAt?: string;
  } = {},
): ClinicCardsVisit {
  const targetAt = overrides.targetAt ?? "2026-07-01T09:00:00+03:00";
  const patientId = overrides.patientId === undefined
    ? "patient-1"
    : overrides.patientId;

  return Object.freeze({
    id,
    patientId,
    sourceStatus: status,
    targetAt,
    targetAtEpochMs: Date.parse(targetAt),
    endAt: "2026-07-01T09:30:00+03:00",
    doctorName: "Synthetic Doctor",
    cabinetName: "Room 1",
    raw: { id, patient_id: patientId, status, start_at: targetAt },
    status: classifyClinicCardsStatus(status, policy),
  });
}
