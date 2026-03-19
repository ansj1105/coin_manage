import { z } from 'zod';

export const internalSignerBroadcastParamsSchema = z.object({
  withdrawalId: z.string().min(1).max(64)
});

export const internalSignerBroadcastRequestSchema = z.object({
  schemaVersion: z.literal('2026-03-19.withdraw-signer.v1'),
  toAddress: z.string().regex(/^T[1-9A-HJ-NP-Za-km-z]{33}$/),
  amountSun: z.string().regex(/^\d+$/)
});
