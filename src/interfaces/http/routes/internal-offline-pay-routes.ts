import { Router } from 'express';
import { zodToDomainError } from '../../../core/validation.js';
import { DomainError } from '../../../domain/errors/domain-error.js';
import { createRequireWithdrawApiKey } from '../middleware/withdraw-auth.js';
import {
  internalAckResponseSchema,
  offlinePayFinalizeSettlementRequestSchema,
  offlinePayLockRequestSchema,
  offlinePayLockResponseSchema
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
      res.status(200).json(internalAckResponseSchema.parse(result));
    } catch (error) {
      next(error);
    }
  });

  return router;
};
