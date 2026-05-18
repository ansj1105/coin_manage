import { z } from 'zod';

export const offlinePayLockRequestSchema = z
  .object({
    userId: z.string().min(1).max(64),
    deviceId: z.string().min(1).max(128),
    assetCode: z.string().min(1).max(32),
    amount: z.string().regex(/^-?[0-9]+\.[0-9]{6}$/),
    referenceId: z.string().min(1).max(128),
    policyVersion: z.number().int().positive()
  })
  .strict();

export const offlinePayLockResponseSchema = z
  .object({
    lockId: z.string().min(1).max(128),
    status: z.literal('LOCKED')
  })
  .strict();

export const offlinePayReleaseRequestSchema = z
  .object({
    userId: z.string().min(1).max(64),
    deviceId: z.string().min(1).max(128),
    collateralId: z.string().min(1).max(128),
    assetCode: z.string().min(1).max(32),
    amount: z.string().regex(/^-?[0-9]+\.[0-9]{6}$/),
    referenceId: z.string().min(1).max(128)
  })
  .strict();

export const offlinePayReleaseResponseSchema = z
  .object({
    releaseId: z.string().min(1).max(128),
    status: z.literal('RELEASED')
  })
  .strict();

export const offlinePayFinalizeSettlementRequestSchema = z
  .object({
    settlementId: z.string().min(1).max(128),
    batchId: z.string().min(1).max(128),
    collateralId: z.string().min(1).max(128),
    proofId: z.string().min(1).max(128),
    userId: z.string().min(1).max(64),
    deviceId: z.string().min(1).max(128),
    receiverUserId: z.string().min(1).max(64).optional(),
    receiverDeviceId: z.string().min(1).max(128).optional(),
    assetCode: z.string().min(1).max(32),
    amount: z.string().regex(/^-?[0-9]+\.[0-9]{6}$/),
    feeAmount: z.string().regex(/^-?[0-9]+\.[0-9]{6}$/).optional(),
    settlementStatus: z.string().min(1).max(32),
    releaseAction: z.enum(['RELEASE', 'ADJUST']),
    conflictDetected: z.boolean(),
    proofFingerprint: z.string().length(64),
    newStateHash: z.string().min(1).max(256),
    previousHash: z.string().min(1).max(256),
    monotonicCounter: z.number().int().positive(),
    nonce: z.string().min(1).max(256),
    signature: z.string().min(1).max(4096)
  })
  .strict();

export const offlinePayCompensateSettlementRequestSchema = z
  .object({
    settlementId: z.string().min(1).max(128),
    batchId: z.string().min(1).max(128),
    collateralId: z.string().min(1).max(128),
    proofId: z.string().min(1).max(128),
    userId: z.string().min(1).max(64),
    deviceId: z.string().min(1).max(128),
    assetCode: z.string().min(1).max(32),
    amount: z.string().regex(/^-?[0-9]+\.[0-9]{6}$/),
    releaseAction: z.enum(['RELEASE', 'ADJUST']),
    proofFingerprint: z.string().length(64),
    compensationReason: z.string().min(1).max(256)
  })
  .strict();

export const offlinePayDeviceUpsertRequestSchema = z
  .object({
    userId: z.string().min(1).max(64),
    deviceId: z.string().min(1).max(128),
    status: z.enum(['ACTIVE', 'REVOKED']),
    keyVersion: z.number().int().positive().optional(),
    lastSeenAt: z.string().datetime().optional()
  })
  .strict();

export const offlinePayDeviceUpsertResponseSchema = z
  .object({
    status: z.literal('OK'),
    deviceId: z.string().min(1).max(128)
  })
  .strict();

export const offlinePaySettlementResponseSchema = z
  .object({
    status: z.literal('OK'),
    message: z.string().min(1).max(200),
    settlementId: z.string().min(1).max(128),
    ledgerOutcome: z.enum(['FINALIZED', 'COMPENSATED']),
    releaseAction: z.enum(['RELEASE', 'ADJUST']),
    duplicated: z.boolean(),
    feeAmount: z.string().regex(/^-?[0-9]+\.[0-9]{6}$/),
    accountingSide: z.literal('SENDER'),
    receiverSettlementMode: z.enum(['EXTERNAL_HISTORY_SYNC', 'LEDGER_AND_EXTERNAL_HISTORY_SYNC']),
    settlementModel: z.enum(['SENDER_LEDGER_PLUS_RECEIVER_HISTORY', 'SENDER_LEDGER_PLUS_RECEIVER_LEDGER_AND_HISTORY']),
    reconciliationTrackingOwner: z.literal('OFFLINE_PAY_SAGA'),
    postAvailableBalance: z.string().regex(/^-?[0-9]+\.[0-9]{6}$/),
    postLockedBalance: z.string().regex(/^-?[0-9]+\.[0-9]{6}$/),
    postOfflinePayPendingBalance: z.string().regex(/^-?[0-9]+\.[0-9]{6}$/)
  })
  .strict();

export type OfflinePayLockRequest = z.infer<typeof offlinePayLockRequestSchema>;
export type OfflinePayLockResponse = z.infer<typeof offlinePayLockResponseSchema>;
export type OfflinePayReleaseRequest = z.infer<typeof offlinePayReleaseRequestSchema>;
export type OfflinePayReleaseResponse = z.infer<typeof offlinePayReleaseResponseSchema>;
export type OfflinePayFinalizeSettlementRequest = z.infer<typeof offlinePayFinalizeSettlementRequestSchema>;
export type OfflinePayCompensateSettlementRequest = z.infer<typeof offlinePayCompensateSettlementRequestSchema>;
export type OfflinePayDeviceUpsertRequest = z.infer<typeof offlinePayDeviceUpsertRequestSchema>;
export type OfflinePayDeviceUpsertResponse = z.infer<typeof offlinePayDeviceUpsertResponseSchema>;
export type OfflinePaySettlementResponse = z.infer<typeof offlinePaySettlementResponseSchema>;
