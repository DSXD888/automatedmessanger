import type { RuntimeConfig } from "./config.ts";
import { loadRuntimeConfig } from "./config.ts";
import type { DentinoDbRpcClient } from "./db.ts";
import type {
  ClinicCardsClient,
  ClinicCardsVisit,
  ClinicCardsVisitWriteStatus,
} from "./clinicCardsClient.ts";
import {
  clinicCardsAppointmentFingerprint,
  createClinicCardsClient,
} from "./clinicCardsClient.ts";

export type CrmWriteBackAction = "confirm" | "cancel";
export type CrmWriteBlockedReason =
  | "crm_write_mode_off"
  | "blocked_by_allowlist";

export type GuardedCrmWriteBackStatus =
  | "written"
  | "would_write"
  | "blocked_by_allowlist"
  | "lock_busy"
  | "stale_actor_lost"
  | "fingerprint_mismatch"
  | "status_policy_refused"
  | "crm_error";

export interface CrmWritePermission {
  allowedProviderWrite: boolean;
  dryRun: boolean;
  blockedReason?: CrmWriteBlockedReason;
}

export interface CrmWriteLease {
  visitId: string;
  lockToken: string;
  messageId: number;
  expiresAt: string;
  externallyManaged?: boolean;
}

export interface CrmWriteLeaseStore {
  acquire(input: {
    visitId: string;
    messageId: number;
    ttlMs: number;
    now: Date;
  }): Promise<CrmWriteLease | null>;
  stillOwns(lease: CrmWriteLease): Promise<boolean>;
  release(lease: CrmWriteLease): Promise<void>;
}

export interface GuardedCrmWriteBackRequest {
  messageId: number;
  cliniccardsVisitId: string;
  action: CrmWriteBackAction;
  expectedAppointmentFingerprint: string;
  crmWriteLockToken?: string;
}

export interface GuardedCrmWriteBackResult {
  status: GuardedCrmWriteBackStatus;
  action: CrmWriteBackAction;
  cliniccardsVisitId: string;
  crmTargetStatus: ClinicCardsVisitWriteStatus;
  crmWritebackOk: boolean;
  dryRun: boolean;
  staffAttention: boolean;
  attempts: number;
  errorCode?: string;
  errorMessage?: string;
  preWriteFingerprint?: string;
  postWriteStatus?: string;
  currentVisit?: ClinicCardsVisit;
}

export interface PendingCrmWriteBack {
  messageId: number;
  cliniccardsVisitId: string;
  action: CrmWriteBackAction;
  expectedAppointmentFingerprint: string;
  crmWritebackOk?: boolean | null;
  supersededAt?: string | null;
}

export interface GuardedCrmWriteBack {
  write(
    request: GuardedCrmWriteBackRequest,
  ): Promise<GuardedCrmWriteBackResult>;
  redrivePending(
    pending: readonly PendingCrmWriteBack[],
  ): Promise<GuardedCrmWriteBackResult[]>;
}

export interface GuardedCrmWriteBackOptions {
  config?: RuntimeConfig;
  clinicCardsClient?: ClinicCardsClient;
  leaseStore?: CrmWriteLeaseStore;
  now?: () => Date;
  writeLeaseTtlMs?: number;
  maxAttempts?: number;
}

const defaultWriteLeaseTtlMs = 90_000;
const defaultMaxAttempts = 2;
const encoder = new TextEncoder();

export function evaluateCrmWritePermission(
  config: Pick<RuntimeConfig, "crmWriteMode" | "crmWriteAllowlist">,
  visitId: string,
): CrmWritePermission {
  if (config.crmWriteMode !== "full") {
    const allowlist = normalizedCrmWriteAllowlist(config.crmWriteAllowlist);
    if (!allowlist.has(visitId.trim())) {
      return Object.freeze({
        allowedProviderWrite: false,
        dryRun: true,
        blockedReason: "blocked_by_allowlist",
      });
    }
  }

  if (config.crmWriteMode === "off") {
    return Object.freeze({
      allowedProviderWrite: false,
      dryRun: true,
      blockedReason: "crm_write_mode_off",
    });
  }

  return Object.freeze({
    allowedProviderWrite: true,
    dryRun: false,
  });
}

export function createInMemoryCrmWriteLeaseStore(options: {
  tokenFactory?: () => string;
} = {}): CrmWriteLeaseStore {
  const leases = new Map<string, CrmWriteLease>();
  const tokenFactory = options.tokenFactory ?? (() => crypto.randomUUID());

  return Object.freeze({
    acquire(input: {
      visitId: string;
      messageId: number;
      ttlMs: number;
      now: Date;
    }): Promise<CrmWriteLease | null> {
      const existing = leases.get(input.visitId);
      if (existing && Date.parse(existing.expiresAt) > input.now.getTime()) {
        return Promise.resolve(null);
      }

      const lease = Object.freeze({
        visitId: input.visitId,
        lockToken: tokenFactory(),
        messageId: input.messageId,
        expiresAt: new Date(input.now.getTime() + input.ttlMs).toISOString(),
      });
      leases.set(input.visitId, lease);
      return Promise.resolve(lease);
    },

    stillOwns(lease: CrmWriteLease): Promise<boolean> {
      const current = leases.get(lease.visitId);
      return Promise.resolve(
        current !== undefined &&
          constantTimeStringEqual(current.lockToken, lease.lockToken) &&
          Object.is(current.messageId, lease.messageId),
      );
    },

    release(lease: CrmWriteLease): Promise<void> {
      const current = leases.get(lease.visitId);
      if (
        current &&
        constantTimeStringEqual(current.lockToken, lease.lockToken)
      ) {
        leases.delete(lease.visitId);
      }
      return Promise.resolve();
    },
  });
}

export function createDbCrmWriteLeaseStore(
  rpcClient: DentinoDbRpcClient,
): CrmWriteLeaseStore {
  return Object.freeze({
    acquire(): Promise<CrmWriteLease | null> {
      return Promise.resolve(null);
    },

    async stillOwns(lease: CrmWriteLease): Promise<boolean> {
      const owns = await rpcClient.rpc("crm_write_lock_still_owns", {
        p_cliniccards_visit_id: lease.visitId,
        p_message_id: lease.messageId,
        p_lock_token: lease.lockToken,
      });
      return owns === true;
    },

    release(): Promise<void> {
      return Promise.resolve();
    },
  });
}

export function createGuardedCrmWriteBack(
  options: GuardedCrmWriteBackOptions = {},
): GuardedCrmWriteBack {
  const config = options.config ?? loadRuntimeConfig();
  const clinicCardsClient = options.clinicCardsClient ??
    createClinicCardsClient({ config });
  const leaseStore = options.leaseStore ?? createInMemoryCrmWriteLeaseStore();
  const now = options.now ?? (() => new Date());
  const writeLeaseTtlMs = options.writeLeaseTtlMs ?? defaultWriteLeaseTtlMs;
  const maxAttempts = Math.max(1, options.maxAttempts ?? defaultMaxAttempts);

  return Object.freeze({
    async write(
      request: GuardedCrmWriteBackRequest,
    ): Promise<GuardedCrmWriteBackResult> {
      return await guardedWriteBack({
        request,
        config,
        clinicCardsClient,
        leaseStore,
        now,
        writeLeaseTtlMs,
        maxAttempts,
      });
    },

    async redrivePending(
      pending: readonly PendingCrmWriteBack[],
    ): Promise<GuardedCrmWriteBackResult[]> {
      const results: GuardedCrmWriteBackResult[] = [];
      for (const item of pending) {
        if (item.crmWritebackOk === true || item.supersededAt) {
          continue;
        }
        results.push(
          await guardedWriteBack({
            request: {
              messageId: item.messageId,
              cliniccardsVisitId: item.cliniccardsVisitId,
              action: item.action,
              expectedAppointmentFingerprint:
                item.expectedAppointmentFingerprint,
            },
            config,
            clinicCardsClient,
            leaseStore,
            now,
            writeLeaseTtlMs,
            maxAttempts,
          }),
        );
      }
      return results;
    },
  });
}

async function guardedWriteBack(input: {
  request: GuardedCrmWriteBackRequest;
  config: RuntimeConfig;
  clinicCardsClient: ClinicCardsClient;
  leaseStore: CrmWriteLeaseStore;
  now: () => Date;
  writeLeaseTtlMs: number;
  maxAttempts: number;
}): Promise<GuardedCrmWriteBackResult> {
  const crmTargetStatus = targetStatusForAction(input.request.action);
  const permission = evaluateCrmWritePermission(
    input.config,
    input.request.cliniccardsVisitId,
  );
  if (permission.blockedReason === "blocked_by_allowlist") {
    return result(input.request, crmTargetStatus, {
      status: "blocked_by_allowlist",
      dryRun: true,
      staffAttention: true,
      errorCode: "blocked_by_allowlist",
      errorMessage: "Visit is not allowed under the current CRM_WRITE_MODE",
    });
  }

  const lease = input.request.crmWriteLockToken
    ? externalCrmWriteLease(input.request, input.writeLeaseTtlMs, input.now())
    : await input.leaseStore.acquire({
      visitId: input.request.cliniccardsVisitId,
      messageId: input.request.messageId,
      ttlMs: input.writeLeaseTtlMs,
      now: input.now(),
    });
  if (!lease) {
    return result(input.request, crmTargetStatus, {
      status: "lock_busy",
      dryRun: true,
      staffAttention: false,
      errorCode: "lock_busy",
      errorMessage: "A live CRM write lease already exists for this visit",
    });
  }

  try {
    if (!(await input.leaseStore.stillOwns(lease))) {
      return result(input.request, crmTargetStatus, {
        status: "stale_actor_lost",
        dryRun: true,
        staffAttention: false,
        errorCode: "stale_actor_lost",
        errorMessage: "CRM write lease ownership was lost before re-fetch",
      });
    }

    const preWrite = await input.clinicCardsClient.getVisitById(
      input.request.cliniccardsVisitId,
      "writeback_pre",
    );
    const preWriteFingerprint = await clinicCardsAppointmentFingerprint(
      preWrite.visit,
    );
    if (preWriteFingerprint !== input.request.expectedAppointmentFingerprint) {
      return result(input.request, crmTargetStatus, {
        status: "fingerprint_mismatch",
        dryRun: true,
        staffAttention: true,
        errorCode: "fingerprint_mismatch",
        errorMessage: "ClinicCards visit changed since the patient render",
        preWriteFingerprint,
        currentVisit: preWrite.visit,
      });
    }

    if (!isActionAllowed(preWrite.visit, input.request.action)) {
      return result(input.request, crmTargetStatus, {
        status: "status_policy_refused",
        dryRun: true,
        staffAttention: true,
        errorCode: "status_policy_refused",
        errorMessage: "ClinicCards status policy refused the action",
        preWriteFingerprint,
        currentVisit: preWrite.visit,
      });
    }

    if (permission.blockedReason === "crm_write_mode_off") {
      return result(input.request, crmTargetStatus, {
        status: "would_write",
        dryRun: true,
        staffAttention: false,
        errorCode: "crm_write_mode_off",
        errorMessage: "CRM_WRITE_MODE is off; no ClinicCards write was made",
        preWriteFingerprint,
        currentVisit: preWrite.visit,
      });
    }

    let attempts = 0;
    let lastError: unknown;
    while (attempts < input.maxAttempts) {
      attempts += 1;
      if (!(await input.leaseStore.stillOwns(lease))) {
        return result(input.request, crmTargetStatus, {
          status: "stale_actor_lost",
          dryRun: true,
          staffAttention: false,
          attempts,
          errorCode: "stale_actor_lost",
          errorMessage: "CRM write lease ownership was lost before PUT",
          preWriteFingerprint,
          currentVisit: preWrite.visit,
        });
      }

      const immediatePermission = evaluateCrmWritePermission(
        input.config,
        input.request.cliniccardsVisitId,
      );
      if (immediatePermission.blockedReason === "blocked_by_allowlist") {
        return result(input.request, crmTargetStatus, {
          status: "blocked_by_allowlist",
          dryRun: true,
          staffAttention: true,
          attempts,
          errorCode: "blocked_by_allowlist",
          errorMessage: "Visit is not allowed under the current CRM_WRITE_MODE",
          preWriteFingerprint,
          currentVisit: preWrite.visit,
        });
      }
      if (immediatePermission.blockedReason === "crm_write_mode_off") {
        return result(input.request, crmTargetStatus, {
          status: "would_write",
          dryRun: true,
          staffAttention: false,
          attempts,
          errorCode: "crm_write_mode_off",
          errorMessage: "CRM_WRITE_MODE is off; no ClinicCards write was made",
          preWriteFingerprint,
          currentVisit: preWrite.visit,
        });
      }

      try {
        await input.clinicCardsClient.putVisitStatus(
          input.request.cliniccardsVisitId,
          crmTargetStatus,
        );
        if (!(await input.leaseStore.stillOwns(lease))) {
          return result(input.request, crmTargetStatus, {
            status: "stale_actor_lost",
            dryRun: true,
            staffAttention: false,
            attempts,
            errorCode: "stale_actor_lost",
            errorMessage:
              "CRM write lease ownership was lost before post-write fetch",
            preWriteFingerprint,
            currentVisit: preWrite.visit,
          });
        }

        const postWrite = await input.clinicCardsClient.getVisitById(
          input.request.cliniccardsVisitId,
          "writeback_post",
        );
        if (postWrite.visit.status.status === crmTargetStatus) {
          return result(input.request, crmTargetStatus, {
            status: "written",
            dryRun: false,
            staffAttention: false,
            attempts,
            preWriteFingerprint,
            postWriteStatus: postWrite.visit.status.status,
            currentVisit: postWrite.visit,
          });
        }

        lastError = new Error(
          `ClinicCards status after PUT was ${postWrite.visit.status.status}`,
        );
      } catch (error) {
        lastError = error;
      }
    }

    return result(input.request, crmTargetStatus, {
      status: "crm_error",
      dryRun: false,
      staffAttention: true,
      attempts,
      errorCode: "crm_error",
      errorMessage: safeErrorMessage(lastError),
      preWriteFingerprint,
      currentVisit: preWrite.visit,
    });
  } finally {
    if (!lease.externallyManaged) {
      await input.leaseStore.release(lease);
    }
  }
}

function externalCrmWriteLease(
  request: GuardedCrmWriteBackRequest,
  ttlMs: number,
  now: Date,
): CrmWriteLease {
  return Object.freeze({
    visitId: request.cliniccardsVisitId,
    lockToken: request.crmWriteLockToken ?? "",
    messageId: request.messageId,
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    externallyManaged: true,
  });
}

function targetStatusForAction(
  action: CrmWriteBackAction,
): ClinicCardsVisitWriteStatus {
  return action === "confirm" ? "CONFIRMED" : "CANCELLED";
}

function isActionAllowed(
  visit: ClinicCardsVisit,
  action: CrmWriteBackAction,
): boolean {
  return action === "confirm"
    ? visit.status.allowConfirmAction
    : visit.status.allowCancelAction;
}

function result(
  request: GuardedCrmWriteBackRequest,
  crmTargetStatus: ClinicCardsVisitWriteStatus,
  partial:
    & Omit<
      Partial<GuardedCrmWriteBackResult>,
      "action" | "cliniccardsVisitId" | "crmTargetStatus" | "crmWritebackOk"
    >
    & Pick<GuardedCrmWriteBackResult, "status" | "dryRun" | "staffAttention">,
): GuardedCrmWriteBackResult {
  return Object.freeze({
    action: request.action,
    cliniccardsVisitId: request.cliniccardsVisitId,
    crmTargetStatus,
    crmWritebackOk: partial.status === "written",
    attempts: partial.attempts ?? 0,
    ...partial,
  });
}

function normalizedCrmWriteAllowlist(
  allowlist: readonly string[],
): ReadonlySet<string> {
  return new Set(
    allowlist
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "ClinicCards write-back failed";
}

function constantTimeStringEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let diff = leftBytes.byteLength ^ rightBytes.byteLength;
  const maxLength = Math.max(leftBytes.byteLength, rightBytes.byteLength);

  for (let index = 0; index < maxLength; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return diff === 0;
}
