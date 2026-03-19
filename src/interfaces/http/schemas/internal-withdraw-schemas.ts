import { z } from 'zod';

export const internalWithdrawalStateParamsSchema = z.object({
  withdrawalId: z.string().min(1).max(64)
});
