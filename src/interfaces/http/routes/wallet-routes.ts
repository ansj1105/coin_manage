import { Router } from 'express';
import { z } from 'zod';
import { formatKoriAmount } from '../../../domain/value-objects/money.js';
import { tronAddressPattern } from '../../../domain/value-objects/tron-address.js';
import { requireIdempotencyKey, zodToDomainError } from '../../../core/validation.js';
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

export const createWalletRoutes = (walletService: WalletService): Router => {
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
      const parsed = accountRefSchema.safeParse({
        userId: req.query.userId,
        walletAddress: req.query.walletAddress
      });
      if (!parsed.success) {
        throw zodToDomainError(parsed.error);
      }

      const account = await walletService.getBalance(parsed.data);
      res.json({
        userId: account.userId,
        walletAddress: account.walletAddress,
        balance: formatKoriAmount(account.balance),
        lockedBalance: formatKoriAmount(account.lockedBalance),
        updatedAt: account.updatedAt
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
      const userId = req.params.userId;
      const account = await walletService.getBalance({ userId });
      res.json({
        userId: account.userId,
        walletAddress: account.walletAddress,
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
