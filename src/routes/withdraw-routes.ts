import { Router } from 'express';
import { DomainError } from '../core/domain-error.js';
import { formatKoriAmount } from '../core/money.js';
import { tronAddressPattern } from '../core/tron.js';
import { requireIdempotencyKey, zodToDomainError } from '../core/validation.js';
import { WithdrawService } from '../services/withdraw-service.js';
import { z } from 'zod';

const requestSchema = z.object({
  userId: z.string().min(1),
  amount: z.number().positive(),
  toAddress: z.string().regex(tronAddressPattern, 'invalid TRON address format')
});

export const createWithdrawRoutes = (withdrawService: WithdrawService): Router => {
  const router = Router();

  router.post('/', async (req, res, next) => {
    try {
      const parsed = requestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw zodToDomainError(parsed.error);
      }

      const idempotencyKey = requireIdempotencyKey(req.header('Idempotency-Key'));
      const result = await withdrawService.request({
        userId: parsed.data.userId,
        amountKori: parsed.data.amount,
        toAddress: parsed.data.toAddress,
        idempotencyKey
      });

      res.status(result.duplicated ? 200 : 201).json({
        duplicated: result.duplicated,
        withdrawal: {
          ...result.withdrawal,
          amount: formatKoriAmount(result.withdrawal.amount)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:withdrawalId/approve', async (req, res, next) => {
    try {
      const withdrawal = await withdrawService.approve(req.params.withdrawalId);
      res.json({
        withdrawal: {
          ...withdrawal,
          amount: formatKoriAmount(withdrawal.amount)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:withdrawalId/broadcast', async (req, res, next) => {
    try {
      const withdrawal = await withdrawService.broadcast(req.params.withdrawalId);
      if (!withdrawal) {
        throw new DomainError(404, 'NOT_FOUND', 'withdrawal not found');
      }
      res.json({
        withdrawal: {
          ...withdrawal,
          amount: formatKoriAmount(withdrawal.amount)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:withdrawalId/confirm', async (req, res, next) => {
    try {
      const withdrawal = await withdrawService.confirm(req.params.withdrawalId);
      res.json({
        withdrawal: {
          ...withdrawal,
          amount: formatKoriAmount(withdrawal.amount)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:withdrawalId', async (req, res, next) => {
    try {
      const withdrawal = await withdrawService.get(req.params.withdrawalId);
      if (!withdrawal) {
        throw new DomainError(404, 'NOT_FOUND', 'withdrawal not found');
      }
      res.json({
        withdrawal: {
          ...withdrawal,
          amount: formatKoriAmount(withdrawal.amount)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
