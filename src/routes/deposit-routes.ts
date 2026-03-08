import { Router } from 'express';
import { z } from 'zod';
import { formatKoriAmount } from '../core/money.js';
import { zodToDomainError } from '../core/validation.js';
import { DepositService } from '../services/deposit-service.js';

const bodySchema = z.object({
  userId: z.string().min(1),
  txHash: z.string().min(8).max(128),
  amount: z.number().positive(),
  blockNumber: z.number().int().nonnegative()
});

export const createDepositRoutes = (depositService: DepositService): Router => {
  const router = Router();

  router.post('/scan', async (req, res, next) => {
    try {
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        throw zodToDomainError(parsed.error);
      }

      const result = await depositService.processDeposit({
        userId: parsed.data.userId,
        txHash: parsed.data.txHash,
        amountKori: parsed.data.amount,
        blockNumber: parsed.data.blockNumber
      });

      res.status(result.duplicated ? 200 : 201).json({
        duplicated: result.duplicated,
        deposit: {
          ...result.deposit,
          amount: formatKoriAmount(result.deposit.amount)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
