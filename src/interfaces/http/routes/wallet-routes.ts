import { Router } from 'express';
import { formatKoriAmount } from '../../../domain/value-objects/money.js';
import { requireIdempotencyKey, zodToDomainError } from '../../../core/validation.js';
import { AccountReconciliationService } from '../../../application/services/account-reconciliation-service.js';
import { WalletService } from '../../../application/services/wallet-service.js';
import {
  walletAccountRefSchema,
  walletBindSchema,
  walletReconcileQuerySchema,
  walletReconcileRequestSchema,
  walletTimelineQuerySchema,
  walletTransferSchema
} from '../schemas/wallet-schemas.js';

export const createWalletRoutes = (
  walletService: WalletService,
  accountReconciliationService?: AccountReconciliationService
): Router => {
  const router = Router();

  router.post('/address-binding', async (req, res, next) => {
    try {
      const parsed = walletBindSchema.safeParse(req.body);
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
      const parsed = walletAccountRefSchema.safeParse({
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
      const reconcileQuery = walletReconcileQuerySchema.safeParse(req.query ?? {});
      if (!reconcileQuery.success) {
        throw zodToDomainError(reconcileQuery.error);
      }
      const parsed = walletAccountRefSchema.safeParse({
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
      const reconcileQuery = walletReconcileQuerySchema.safeParse(req.query ?? {});
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

      const parsed = walletReconcileRequestSchema.safeParse(req.body ?? {});
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
      const parsed = walletTransferSchema.safeParse(req.body);
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

  router.get('/timeline', async (req, res, next) => {
    try {
      const parsed = walletTimelineQuerySchema.safeParse({
        userId: req.query.userId,
        walletAddress: req.query.walletAddress,
        limit: req.query.limit
      });
      if (!parsed.success) {
        throw zodToDomainError(parsed.error);
      }

      const items = await walletService.getTimeline(parsed.data);
      res.json({
        items: items.map((item) => ({
          ...item,
          amount: formatKoriAmount(item.amount)
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
