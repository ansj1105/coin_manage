import { Router } from 'express';
import { z } from 'zod';
import { SchedulerService } from '../../../application/services/scheduler-service.js';
import { zodToDomainError } from '../../../core/validation.js';

const retrySchema = z.object({
  timeoutSec: z.number().int().positive().optional()
});

export const createSchedulerRoutes = (schedulerService: SchedulerService): Router => {
  const router = Router();

  router.post('/process-withdraw-queue', async (_req, res, next) => {
    try {
      const result = await schedulerService.processWithdrawQueue();
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/retry-pending', async (req, res, next) => {
    try {
      const parsed = retrySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw zodToDomainError(parsed.error);
      }

      const timeoutSec = parsed.data.timeoutSec ?? 60;
      const result = await schedulerService.retryPending(timeoutSec);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
};
