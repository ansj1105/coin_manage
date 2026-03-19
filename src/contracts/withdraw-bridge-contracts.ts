import { z } from 'zod';
import { withdrawRequestJsonSchema, withdrawRequestSchema } from '../interfaces/http/schemas/withdraw-schemas.js';

export const WITHDRAW_BRIDGE_SCHEMA_VERSION = '1.0.0' as const;

export const withdrawBridgeRequestContractSchema = withdrawRequestSchema;
export type WithdrawBridgeRequestContract = z.infer<typeof withdrawBridgeRequestContractSchema>;

export const withdrawBridgePollingStatusSchema = z.enum(['PROCESSING', 'SENT', 'COMPLETED', 'FAILED']);

export const withdrawBridgeStateResponseContractSchema = z
  .object({
    schemaVersion: z.literal(WITHDRAW_BRIDGE_SCHEMA_VERSION),
    withdrawalId: z.string().min(1).max(64),
    externalTransferId: z.string().min(1).max(128).nullable(),
    status: withdrawBridgePollingStatusSchema,
    txHash: z.string().min(8).max(128).nullable(),
    failedReason: z.string().min(1).max(500).nullable(),
    updatedAt: z.string().datetime()
  })
  .strict();

export type WithdrawBridgeStateResponseContract = z.infer<typeof withdrawBridgeStateResponseContractSchema>;

export const withdrawBridgeRequestJsonSchema = {
  $id: 'korion.withdraw.request',
  schemaVersion: WITHDRAW_BRIDGE_SCHEMA_VERSION,
  payload: withdrawRequestJsonSchema
} as const;

export const withdrawBridgeStateResponseJsonSchema = {
  $id: 'korion.withdraw.state.response',
  schemaVersion: WITHDRAW_BRIDGE_SCHEMA_VERSION,
  payload: {
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'withdrawalId', 'externalTransferId', 'status', 'txHash', 'failedReason', 'updatedAt'],
    properties: {
      schemaVersion: {
        type: 'string',
        const: WITHDRAW_BRIDGE_SCHEMA_VERSION
      },
      withdrawalId: {
        type: 'string',
        minLength: 1,
        maxLength: 64
      },
      externalTransferId: {
        anyOf: [
          {
            type: 'string',
            minLength: 1,
            maxLength: 128
          },
          {
            type: 'null'
          }
        ]
      },
      status: {
        type: 'string',
        enum: ['PROCESSING', 'SENT', 'COMPLETED', 'FAILED']
      },
      txHash: {
        anyOf: [
          {
            type: 'string',
            minLength: 8,
            maxLength: 128
          },
          {
            type: 'null'
          }
        ]
      },
      failedReason: {
        anyOf: [
          {
            type: 'string',
            minLength: 1,
            maxLength: 500
          },
          {
            type: 'null'
          }
        ]
      },
      updatedAt: {
        type: 'string',
        format: 'date-time'
      }
    }
  }
} as const;
