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
    assetCode: z.string().min(1).max(32),
    amount: z.string().regex(/^-?[0-9]+\.[0-9]{6}$/),
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

export const internalAckResponseSchema = z
  .object({
    status: z.literal('OK'),
    message: z.string().min(1).max(200)
  })
  .strict();

export type OfflinePayLockRequest = z.infer<typeof offlinePayLockRequestSchema>;
export type OfflinePayLockResponse = z.infer<typeof offlinePayLockResponseSchema>;
export type OfflinePayReleaseRequest = z.infer<typeof offlinePayReleaseRequestSchema>;
export type OfflinePayReleaseResponse = z.infer<typeof offlinePayReleaseResponseSchema>;
export type OfflinePayFinalizeSettlementRequest = z.infer<typeof offlinePayFinalizeSettlementRequestSchema>;
export type OfflinePayCompensateSettlementRequest = z.infer<typeof offlinePayCompensateSettlementRequestSchema>;
export type InternalAckResponse = z.infer<typeof internalAckResponseSchema>;
