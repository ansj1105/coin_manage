import { z } from 'zod';
import { tronAddressPattern } from '../../../domain/value-objects/tron-address.js';

const walletAccountRefBaseSchema = z.object({
  userId: z.string().min(1).optional(),
  walletAddress: z.string().regex(tronAddressPattern).optional()
});

export const walletAccountRefSchema = walletAccountRefBaseSchema.refine((value) => value.userId || value.walletAddress, {
  message: 'userId or walletAddress is required'
});

export const walletBindSchema = z.object({
  userId: z.string().min(1),
  walletAddress: z.string().regex(tronAddressPattern, 'invalid TRON address format')
});

export const walletTransferSchema = z
  .object({
    fromUserId: z.string().min(1).optional(),
    fromWalletAddress: z.string().regex(tronAddressPattern).optional(),
    toUserId: z.string().min(1).optional(),
    toWalletAddress: z.string().regex(tronAddressPattern).optional(),
    amount: z.number().positive()
  })
  .refine((value) => value.fromUserId || value.fromWalletAddress, {
    message: 'fromUserId or fromWalletAddress is required'
  })
  .refine((value) => value.toUserId || value.toWalletAddress, {
    message: 'toUserId or toWalletAddress is required'
  });

export const walletReconcileRequestSchema = z
  .object({
    userId: z.string().min(1).optional(),
    walletAddress: z.string().regex(tronAddressPattern).optional(),
    txHashes: z.array(z.string().min(8).max(128)).max(100).optional(),
    lookbackMs: z.number().int().positive().max(30 * 24 * 60 * 60 * 1000).optional()
  })
  .refine((value) => value.userId || value.walletAddress, {
    message: 'userId or walletAddress is required'
  });

export const walletReconcileQuerySchema = z.object({
  reconcile: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((value) => value === 'true'),
  lookbackMs: z.coerce.number().int().positive().max(30 * 24 * 60 * 60 * 1000).optional()
});

export const walletTimelineQuerySchema = walletAccountRefBaseSchema
  .extend({
    limit: z.coerce.number().int().positive().max(100).optional()
  })
  .refine((value) => value.userId || value.walletAddress, {
    message: 'userId or walletAddress is required'
  });
