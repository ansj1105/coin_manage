import { z } from 'zod';

export const PER_WALLET_SIGNER_SCHEMA_VERSION = '2026-03-19.per-wallet-signer.v1';

const networkSchema = z.enum(['mainnet', 'testnet']).optional();

export const perWalletActivationReclaimRequestSchema = z.object({
  schemaVersion: z.literal(PER_WALLET_SIGNER_SCHEMA_VERSION),
  toAddress: z.string().regex(/^T[1-9A-HJ-NP-Za-km-z]{33}$/),
  amountSun: z.string().regex(/^\d+$/),
  network: networkSchema
});

export const perWalletFoxyaSweepRequestSchema = z.object({
  schemaVersion: z.literal(PER_WALLET_SIGNER_SCHEMA_VERSION),
  sourceAddress: z.string().regex(/^T[1-9A-HJ-NP-Za-km-z]{33}$/),
  currencyId: z.number().int().positive(),
  toAddress: z.string().regex(/^T[1-9A-HJ-NP-Za-km-z]{33}$/),
  amountSun: z.string().regex(/^\d+$/),
  network: networkSchema
});

export const perWalletSignerTxResponseSchema = z.object({
  schemaVersion: z.literal(PER_WALLET_SIGNER_SCHEMA_VERSION),
  txHash: z.string().min(8).max(128),
  signerBackend: z.enum(['local', 'remote']),
  broadcastedAt: z.string().datetime()
});

export type PerWalletActivationReclaimRequestContract = z.infer<typeof perWalletActivationReclaimRequestSchema>;
export type PerWalletFoxyaSweepRequestContract = z.infer<typeof perWalletFoxyaSweepRequestSchema>;
