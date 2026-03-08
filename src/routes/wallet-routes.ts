import { Router } from 'express';
import { z } from 'zod';
import { formatKoriAmount } from '../core/money.js';
import { requireIdempotencyKey, zodToDomainError } from '../core/validation.js';
import { WalletService } from '../services/wallet-service.js';

const transferSchema = z.object({
  fromUserId: z.string().min(1),
  toUserId: z.string().min(1),
  amount: z.number().positive()
});

export const createWalletRoutes = (walletService: WalletService): Router => {
  const router = Router();

  router.get('/:userId/balance', async (req, res, next) => {
    try {
      const userId = req.params.userId;
      const account = await walletService.getBalance(userId);
      res.json({
        userId: account.userId,
        balance: formatKoriAmount(account.balance),
        lockedBalance: formatKoriAmount(account.lockedBalance),
        updatedAt: account.updatedAt
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/transfer', async (req, res, next) => {
    try {
      const parsed = transferSchema.safeParse(req.body);
      if (!parsed.success) {
        throw zodToDomainError(parsed.error);
      }

      const idempotencyKey = requireIdempotencyKey(req.header('Idempotency-Key'));
      const result = await walletService.transfer({
        ...parsed.data,
        amountKori: parsed.data.amount,
        idempotencyKey
      });

      res.status(result.duplicated ? 200 : 201).json({
        duplicated: result.duplicated,
        transfer: {
          fromTxId: result.fromTx.txId,
          toTxId: result.toTx.txId,
          amount: formatKoriAmount(result.fromTx.amount)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
