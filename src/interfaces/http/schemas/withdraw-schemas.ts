import { z } from 'zod';
import { tronAddressPattern } from '../../../domain/value-objects/tron-address.js';

export const withdrawApprovalReasonCodeSchema = z.enum([
  'manual_review_passed',
  'high_value_verified',
  'trusted_destination_verified',
  'account_activity_verified',
  'ops_override'
]);

export const withdrawRequestSchema = z
  .object({
    userId: z.string().min(1).optional(),
    walletAddress: z.string().regex(tronAddressPattern, 'invalid TRON address format').optional(),
    amount: z.number().positive(),
    toAddress: z.string().regex(tronAddressPattern, 'invalid TRON address format'),
    clientIp: z.string().max(64).optional(),
    deviceId: z.string().max(128).optional()
  })
  .refine((value) => value.userId || value.walletAddress, {
    message: 'userId or walletAddress is required'
  });

export const withdrawApproveSchema = z.object({
  adminId: z.string().min(1).optional(),
  reasonCode: withdrawApprovalReasonCodeSchema.optional(),
  note: z.string().max(500).optional()
});

export const withdrawExternalAuthConfirmSchema = z.object({
  provider: z.string().min(1).max(64),
  requestId: z.string().min(1).max(128),
  actorId: z.string().min(1).max(64).optional()
});

export const withdrawOfflineSubmitSchema = z.object({
  txHash: z.string().min(8).max(128),
  note: z.string().max(500).optional(),
  actorId: z.string().min(1).max(64).optional()
});

export const withdrawAddressPolicyTypeSchema = z.enum(['blacklist', 'whitelist', 'internal_blocked']);

export const withdrawAddressPolicyUpsertSchema = z.object({
  address: z.string().regex(tronAddressPattern, 'invalid TRON address format'),
  policyType: withdrawAddressPolicyTypeSchema,
  reason: z.string().max(500).optional()
});

export const withdrawAddressPolicyQuerySchema = z.object({
  address: z.string().regex(tronAddressPattern, 'invalid TRON address format').optional(),
  policyType: withdrawAddressPolicyTypeSchema.optional(),
  limit: z.coerce.number().int().positive().max(200).optional()
});

export const withdrawAddressPolicyParamsSchema = z.object({
  address: z.string().regex(tronAddressPattern, 'invalid TRON address format'),
  policyType: withdrawAddressPolicyTypeSchema
});

export const withdrawRequestJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    userId: { type: 'string', minLength: 1 },
    walletAddress: { type: 'string', pattern: tronAddressPattern.source },
    amount: { type: 'number', exclusiveMinimum: 0 },
    toAddress: { type: 'string', pattern: tronAddressPattern.source },
    clientIp: { type: 'string', maxLength: 64 },
    deviceId: { type: 'string', maxLength: 128 }
  },
  required: ['amount', 'toAddress'],
  anyOf: [{ required: ['userId'] }, { required: ['walletAddress'] }]
} as const;

export const withdrawAddressPolicyUpsertJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    address: { type: 'string', pattern: tronAddressPattern.source },
    policyType: { type: 'string', enum: ['blacklist', 'whitelist', 'internal_blocked'] },
    reason: { type: 'string', maxLength: 500 }
  },
  required: ['address', 'policyType']
} as const;
