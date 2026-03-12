import { Router } from 'express';
import { z } from 'zod';
import { tronAddressPattern } from '../../../domain/value-objects/tron-address.js';
import { requireIdempotencyKey, zodToDomainError } from '../../../core/validation.js';
import { VirtualWalletService } from '../../../application/services/virtual-wallet-service.js';

const issueVirtualWalletSchema = z.object({
  userId: z.string().min(1),
  currencyId: z.coerce.number().int().positive(),
  network: z.enum(['mainnet', 'testnet'])
});

const transitionSchema = z.object({
  virtualWalletId: z.string().uuid()
});

const virtualWalletLookupSchema = z
  .object({
    userId: z.string().min(1).optional(),
    walletAddress: z.string().regex(tronAddressPattern, 'invalid TRON address format').optional()
  })
  .refine((value) => value.userId || value.walletAddress, {
    message: 'userId or walletAddress is required'
  });

export const createVirtualWalletRoutes = (virtualWalletService: VirtualWalletService): Router => {
  const router = Router();

  router.post('/', async (req, res, next) => {
    try {
      const parsed = issueVirtualWalletSchema.safeParse(req.body);
      if (!parsed.success) {
        throw zodToDomainError(parsed.error);
      }

      const idempotencyKey = requireIdempotencyKey(req.header('Idempotency-Key'));
      const result = await virtualWalletService.issue({
        ...parsed.data,
        idempotencyKey
      });

      res.status(result.duplicated ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/reissue', async (req, res, next) => {
    try {
      const parsed = issueVirtualWalletSchema.safeParse(req.body);
      if (!parsed.success) {
        throw zodToDomainError(parsed.error);
      }

      const idempotencyKey = requireIdempotencyKey(req.header('Idempotency-Key'));
      const result = await virtualWalletService.reissue({
        ...parsed.data,
        idempotencyKey
      });

      res.status(result.duplicated ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/retire', async (req, res, next) => {
    try {
      const parsed = transitionSchema.safeParse(req.body);
      if (!parsed.success) {
        throw zodToDomainError(parsed.error);
      }
      res.json({ binding: await virtualWalletService.retire(parsed.data) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/disable', async (req, res, next) => {
    try {
      const parsed = transitionSchema.safeParse(req.body);
      if (!parsed.success) {
        throw zodToDomainError(parsed.error);
      }
      res.json({ binding: await virtualWalletService.disable(parsed.data) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/', async (req, res, next) => {
    try {
      const parsed = virtualWalletLookupSchema.safeParse({
        userId: req.query.userId,
        walletAddress: req.query.walletAddress
      });
      if (!parsed.success) {
        throw zodToDomainError(parsed.error);
      }

      const binding = await virtualWalletService.get(parsed.data);
      res.json({ binding: binding ?? null });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
