import { Router } from 'express';
import { zodToDomainError } from '../../../core/validation.js';
import { DomainError } from '../../../domain/errors/domain-error.js';
import { createRequireWithdrawApiKey } from '../middleware/withdraw-auth.js';
import {
  offlinePayCompensateSettlementRequestSchema,
  offlinePayDeviceUpsertRequestSchema,
  offlinePayDeviceUpsertResponseSchema,
  offlinePayFinalizeSettlementRequestSchema,
  offlinePayLockRequestSchema,
  offlinePayLockResponseSchema,
  offlinePayPendingBalanceResponseSchema,
  offlinePayReleaseRequestSchema,
  offlinePayReleaseResponseSchema,
  offlinePaySettlementResponseSchema
} from '../../../contracts/offline-pay-contracts.js';
import { OfflinePayService } from '../../../application/services/offline-pay-service.js';

export const createInternalOfflinePayRoutes = (
  offlinePayService: OfflinePayService,
  options: { internalApiKey?: string }
): Router => {
  const router = Router();
  const requireInternalApiKey = createRequireWithdrawApiKey(
    options.internalApiKey,
    'OFFLINE_PAY_INTERNAL_UNAUTHORIZED',
    'offline_pay internal api key is required'
  );

  router.use(requireInternalApiKey);

  router.get('/users/:userId/pending-balance', async (req, res, next) => {
    try {
      const assetCode = typeof req.query.assetCode === 'string' && req.query.assetCode.trim()
        ? req.query.assetCode.trim()
        : 'KORI';
      const result = await offlinePayService.getPendingBalance({
        userId: req.params.userId,
        assetCode
      });
      res.status(200).json(offlinePayPendingBalanceResponseSchema.parse(result));
    } catch (error) {
      next(error);
    }
  });

  router.post('/collateral/lock', async (req, res, next) => {
    try {
      const parsed = offlinePayLockRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw zodToDomainError(parsed.error);
      }
      const result = await offlinePayService.lockCollateral(parsed.data);
      res.status(200).json(offlinePayLockResponseSchema.parse(result));
    } catch (error) {
      next(error);
    }
  });

  router.post('/collateral/release', async (req, res, next) => {
    try {
      const parsed = offlinePayReleaseRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw zodToDomainError(parsed.error);
      }
      const result = await offlinePayService.releaseCollateral(parsed.data);
      res.status(200).json(offlinePayReleaseResponseSchema.parse(result));
    } catch (error) {
      next(error);
    }
  });

  router.post('/settlements/finalize', async (req, res, next) => {
    try {
      const parsed = offlinePayFinalizeSettlementRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw zodToDomainError(parsed.error);
      }
      if (parsed.data.settlementStatus !== 'SETTLED' && parsed.data.settlementStatus !== 'CONFLICT') {
        throw new DomainError(400, 'INVALID_REQUEST', 'settlementStatus must be SETTLED or CONFLICT');
      }
      const result = await offlinePayService.finalizeSettlement(parsed.data);
      res.status(200).json(offlinePaySettlementResponseSchema.parse(result));
    } catch (error) {
      next(error);
    }
  });

  router.post('/settlements/compensate', async (req, res, next) => {
    try {
      const parsed = offlinePayCompensateSettlementRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw zodToDomainError(parsed.error);
      }
      const result = await offlinePayService.compensateSettlement(parsed.data);
      res.status(200).json(offlinePaySettlementResponseSchema.parse(result));
    } catch (error) {
      next(error);
    }
  });

  router.post('/devices/upsert', async (req, res, next) => {
    try {
      const parsed = offlinePayDeviceUpsertRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw zodToDomainError(parsed.error);
      }
      const result = await offlinePayService.upsertDevice(parsed.data);
      res.status(200).json(offlinePayDeviceUpsertResponseSchema.parse(result));
    } catch (error) {
      next(error);
    }
  });

  return router;
};
