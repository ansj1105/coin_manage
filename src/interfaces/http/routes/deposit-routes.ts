import { Router } from 'express';
import { z } from 'zod';
import { formatKoriAmount } from '../../../domain/value-objects/money.js';
import { tronAddressPattern } from '../../../domain/value-objects/tron-address.js';
import { zodToDomainError } from '../../../core/validation.js';
import { DepositService } from '../../../application/services/deposit-service.js';

const bodySchema = z.object({
  userId: z.string().min(1),
  txHash: z.string().min(8).max(128),
  toAddress: z.string().regex(tronAddressPattern, 'invalid TRON address format'),
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
        toAddress: parsed.data.toAddress,
        amountKori: parsed.data.amount,
        blockNumber: parsed.data.blockNumber
      });

      if (!result.accepted) {
        res.status(202).json({
          accepted: false,
          reason: result.reason
        });
        return;
      }

      res.status(result.duplicated ? 200 : 201).json({
        accepted: true,
        duplicated: result.duplicated,
        deposit: result.deposit
          ? {
              ...result.deposit,
              amount: formatKoriAmount(result.deposit.amount)
            }
          : undefined
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
