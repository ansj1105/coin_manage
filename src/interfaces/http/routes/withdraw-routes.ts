import { Router } from 'express';
import { z } from 'zod';
import { WithdrawService } from '../../../application/services/withdraw-service.js';
import { DomainError } from '../../../domain/errors/domain-error.js';
import { formatKoriAmount } from '../../../domain/value-objects/money.js';
import { tronAddressPattern } from '../../../domain/value-objects/tron-address.js';
import { requireIdempotencyKey, zodToDomainError } from '../../../core/validation.js';

const requestSchema = z.object({
  userId: z.string().min(1).optional(),
  walletAddress: z.string().regex(tronAddressPattern, 'invalid TRON address format').optional(),
  amount: z.number().positive(),
  toAddress: z.string().regex(tronAddressPattern, 'invalid TRON address format')
}).refine((value) => value.userId || value.walletAddress, {
  message: 'userId or walletAddress is required'
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
        walletAddress: parsed.data.walletAddress,
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
