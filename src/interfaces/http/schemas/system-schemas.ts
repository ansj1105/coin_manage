import { z } from 'zod';

export const auditLogsQuerySchema = z
  .object({
    entityType: z.enum(['withdrawal', 'sweep', 'system']).optional(),
    entityId: z.string().trim().min(1).max(128).optional(),
    actorId: z.string().trim().min(1).max(64).optional(),
    action: z.string().trim().min(1).max(100).optional(),
    createdFrom: z.string().datetime().optional(),
    createdTo: z.string().datetime().optional(),
    limit: z.coerce.number().int().positive().max(200).optional()
  })
  .refine(
    (input) => !input.createdFrom || !input.createdTo || input.createdFrom <= input.createdTo,
    {
      message: 'createdFrom must be earlier than or equal to createdTo',
      path: ['createdFrom']
    }
  );

export const networkFeeReceiptsQuerySchema = z.object({
  referenceType: z.enum(['withdrawal', 'sweep']).optional(),
  referenceId: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().positive().max(200).optional()
});

export const networkFeeDailySnapshotsQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(365).optional()
});

export const outboxStatusQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional()
});

export const monitoringHistoryQuerySchema = z
  .object({
    walletCodes: z.union([z.string(), z.array(z.string())]).optional(),
    createdFrom: z.string().datetime().optional(),
    createdTo: z.string().datetime().optional(),
    limit: z.coerce.number().int().positive().max(2000).optional()
  })
  .transform((input) => ({
    walletCodes:
      typeof input.walletCodes === 'string'
        ? input.walletCodes
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        : input.walletCodes,
    createdFrom: input.createdFrom,
    createdTo: input.createdTo,
    limit: input.limit
  }))
  .refine((input) => !input.createdFrom || !input.createdTo || input.createdFrom <= input.createdTo, {
    message: 'createdFrom must be earlier than or equal to createdTo',
    path: ['createdFrom']
  });

export const replayOutboxSchema = z
  .object({
    outboxEventIds: z.array(z.string().uuid()).min(1).max(100).optional(),
    limit: z.coerce.number().int().positive().max(200).optional(),
    actorId: z.string().trim().min(1).max(64).optional()
  })
  .refine((input) => input.outboxEventIds || input.limit, {
    message: 'outboxEventIds or limit is required'
  });

export const recoverOutboxProcessingSchema = z.object({
  timeoutSec: z.coerce.number().int().positive().max(86400).optional(),
  actorId: z.string().trim().min(1).max(64).optional()
});

export const acknowledgeOutboxDeadLetterSchema = z
  .object({
    outboxEventIds: z.array(z.string().uuid()).min(1).max(100).optional(),
    limit: z.coerce.number().int().positive().max(200).optional(),
    actorId: z.string().trim().min(1).max(64).optional(),
    note: z.string().trim().max(500).optional(),
    category: z.enum(['external_dependency', 'validation', 'state_conflict', 'network', 'unknown']).optional(),
    incidentRef: z.string().trim().max(128).optional()
  })
  .refine((input) => input.outboxEventIds || input.limit, {
    message: 'outboxEventIds or limit is required'
  });
