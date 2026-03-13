import { Router } from 'express';
import { z } from 'zod';
import { formatKoriAmount } from '../../../domain/value-objects/money.js';
import { tronAddressPattern } from '../../../domain/value-objects/tron-address.js';
import { requireIdempotencyKey, zodToDomainError } from '../../../core/validation.js';
import { AccountReconciliationService } from '../../../application/services/account-reconciliation-service.js';
import { WalletService } from '../../../application/services/wallet-service.js';

const accountRefSchema = z
  .object({
    userId: z.string().min(1).optional(),
    walletAddress: z.string().regex(tronAddressPattern).optional()
  })
  .refine((value) => value.userId || value.walletAddress, {
    message: 'userId or walletAddress is required'
  });

const bindWalletSchema = z.object({
  userId: z.string().min(1),
  walletAddress: z.string().regex(tronAddressPattern, 'invalid TRON address format')
});

const transferSchema = z
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

const reconcileRequestSchema = z
  .object({
    userId: z.string().min(1).optional(),
    walletAddress: z.string().regex(tronAddressPattern).optional(),
    txHashes: z.array(z.string().min(8).max(128)).max(100).optional(),
    lookbackMs: z.number().int().positive().max(30 * 24 * 60 * 60 * 1000).optional()
  })
  .refine((value) => value.userId || value.walletAddress, {
    message: 'userId or walletAddress is required'
  });

const reconcileQuerySchema = z.object({
  reconcile: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((value) => value === 'true'),
  lookbackMs: z.coerce.number().int().positive().max(30 * 24 * 60 * 60 * 1000).optional()
});

export const createWalletRoutes = (
  walletService: WalletService,
  accountReconciliationService?: AccountReconciliationService
): Router => {
  const router = Router();

  router.post('/address-binding', async (req, res, next) => {
    try {
      const parsed = bindWalletSchema.safeParse(req.body);
      if (!parsed.success) {
        throw zodToDomainError(parsed.error);
      }

      const binding = await walletService.bindWalletAddress(parsed.data);
      res.status(201).json({ binding });
    } catch (error) {
      next(error);
    }
  });

  router.get('/address-binding', async (req, res, next) => {
    try {
      const parsed = accountRefSchema.safeParse({
        userId: req.query.userId,
        walletAddress: req.query.walletAddress
      });
      if (!parsed.success) {
        throw zodToDomainError(parsed.error);
      }

      const binding = await walletService.getWalletBinding(parsed.data);
      res.json({ binding: binding ?? null });
    } catch (error) {
      next(error);
    }
  });

  router.get('/balance', async (req, res, next) => {
    try {
      const reconcileQuery = reconcileQuerySchema.safeParse(req.query ?? {});
      if (!reconcileQuery.success) {
        throw zodToDomainError(reconcileQuery.error);
      }
      const parsed = accountRefSchema.safeParse({
        userId: req.query.userId,
        walletAddress: req.query.walletAddress
      });
      if (!parsed.success) {
        throw zodToDomainError(parsed.error);
      }

      let reconcileResult;
      if (reconcileQuery.data.reconcile) {
        if (!accountReconciliationService) {
          throw new Error('account reconciliation service is not configured');
        }
        reconcileResult = await accountReconciliationService.reconcile({
          userId: parsed.data.userId,
          walletAddress: parsed.data.walletAddress,
          lookbackMs: reconcileQuery.data.lookbackMs
        });
      }

      const account = await walletService.getBalance(parsed.data);
      res.json({
        userId: account.userId,
        walletAddress: account.walletAddress,
        balance: formatKoriAmount(account.balance),
        lockedBalance: formatKoriAmount(account.lockedBalance),
        updatedAt: account.updatedAt,
        reconcile: reconcileResult ?? null
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:userId/address', async (req, res, next) => {
    try {
      const binding = await walletService.getWalletBinding({ userId: req.params.userId });
      res.json({
        userId: req.params.userId,
        walletAddress: binding?.walletAddress ?? null
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:userId/balance', async (req, res, next) => {
    try {
      const reconcileQuery = reconcileQuerySchema.safeParse(req.query ?? {});
      if (!reconcileQuery.success) {
        throw zodToDomainError(reconcileQuery.error);
      }
      const userId = req.params.userId;
      let reconcileResult;
      if (reconcileQuery.data.reconcile) {
        if (!accountReconciliationService) {
          throw new Error('account reconciliation service is not configured');
        }
        reconcileResult = await accountReconciliationService.reconcile({
          userId,
          lookbackMs: reconcileQuery.data.lookbackMs
        });
      }
      const account = await walletService.getBalance({ userId });
      res.json({
        userId: account.userId,
        walletAddress: account.walletAddress,
        balance: formatKoriAmount(account.balance),
        lockedBalance: formatKoriAmount(account.lockedBalance),
        updatedAt: account.updatedAt,
        reconcile: reconcileResult ?? null
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/reconcile', async (req, res, next) => {
    try {
      if (!accountReconciliationService) {
        throw new Error('account reconciliation service is not configured');
      }

      const parsed = reconcileRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw zodToDomainError(parsed.error);
      }

      const result = await accountReconciliationService.reconcile(parsed.data);
      res.json({ result });
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
        fromUserId: parsed.data.fromUserId,
        fromWalletAddress: parsed.data.fromWalletAddress,
        toUserId: parsed.data.toUserId,
        toWalletAddress: parsed.data.toWalletAddress,
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
