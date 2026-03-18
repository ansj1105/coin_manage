import { z } from 'zod';
import { withdrawRequestJsonSchema, withdrawRequestSchema } from '../interfaces/http/schemas/withdraw-schemas.js';

export const WITHDRAW_BRIDGE_SCHEMA_VERSION = '1.0.0' as const;

export const withdrawBridgeRequestContractSchema = withdrawRequestSchema;
export type WithdrawBridgeRequestContract = z.infer<typeof withdrawBridgeRequestContractSchema>;

export const withdrawBridgeRequestJsonSchema = {
  $id: 'korion.withdraw.request',
  schemaVersion: WITHDRAW_BRIDGE_SCHEMA_VERSION,
  payload: withdrawRequestJsonSchema
} as const;
