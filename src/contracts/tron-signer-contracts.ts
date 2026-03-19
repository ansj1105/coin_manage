import { z } from 'zod';

export const TRON_SIGNER_SCHEMA_VERSION = '2026-03-19.tron-signer.v1';

const networkSchema = z.enum(['mainnet', 'testnet']).optional();
const resourceSchema = z.enum(['BANDWIDTH', 'ENERGY']);

export const tronSignerBroadcastTransferRequestSchema = z.object({
  schemaVersion: z.literal(TRON_SIGNER_SCHEMA_VERSION),
  toAddress: z.string().regex(/^T[1-9A-HJ-NP-Za-km-z]{33}$/),
  amountSun: z.string().regex(/^\d+$/),
  network: networkSchema,
  apiUrl: z.string().url().optional(),
  contractAddress: z.string().optional(),
  fromAddress: z.string().optional()
});

export const tronSignerBroadcastNativeRequestSchema = z.object({
  schemaVersion: z.literal(TRON_SIGNER_SCHEMA_VERSION),
  toAddress: z.string().regex(/^T[1-9A-HJ-NP-Za-km-z]{33}$/),
  amountSun: z.string().regex(/^\d+$/),
  network: networkSchema,
  apiUrl: z.string().url().optional(),
  fromAddress: z.string().optional()
});

export const tronSignerResourceRequestSchema = z.object({
  schemaVersion: z.literal(TRON_SIGNER_SCHEMA_VERSION),
  receiverAddress: z.string().regex(/^T[1-9A-HJ-NP-Za-km-z]{33}$/),
  amountSun: z.string().regex(/^\d+$/),
  resource: resourceSchema,
  network: networkSchema,
  fromAddress: z.string().optional(),
  lock: z.boolean().optional(),
  lockPeriod: z.number().int().positive().optional()
});

export const tronSignerTxResponseSchema = z.object({
  schemaVersion: z.literal(TRON_SIGNER_SCHEMA_VERSION),
  txHash: z.string().min(8).max(128),
  signerBackend: z.enum(['local', 'remote']),
  broadcastedAt: z.string().datetime()
});
