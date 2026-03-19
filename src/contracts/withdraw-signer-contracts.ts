import { z } from 'zod';

export const WITHDRAW_SIGNER_SCHEMA_VERSION = '2026-03-19.withdraw-signer.v1';

export const withdrawalSignerBroadcastRequestSchema = z.object({
  schemaVersion: z.literal(WITHDRAW_SIGNER_SCHEMA_VERSION),
  withdrawalId: z.string().min(1).max(64),
  toAddress: z.string().regex(/^T[1-9A-HJ-NP-Za-km-z]{33}$/),
  amountSun: z.string().regex(/^\d+$/)
});

export const withdrawalSignerBroadcastResponseSchema = z.object({
  schemaVersion: z.literal(WITHDRAW_SIGNER_SCHEMA_VERSION),
  withdrawalId: z.string().min(1).max(64),
  txHash: z.string().min(8).max(128),
  signerBackend: z.enum(['local', 'remote']),
  broadcastedAt: z.string().datetime()
});

export type WithdrawalSignerBroadcastRequestContract = z.infer<typeof withdrawalSignerBroadcastRequestSchema>;
export type WithdrawalSignerBroadcastResponseContract = z.infer<typeof withdrawalSignerBroadcastResponseSchema>;
