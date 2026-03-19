import { Router } from 'express';
import { WITHDRAW_BRIDGE_SCHEMA_VERSION } from '../../../contracts/withdraw-bridge-contracts.js';
import { DomainError } from '../../../domain/errors/domain-error.js';
import { zodToDomainError } from '../../../core/validation.js';
import { WithdrawService } from '../../../application/services/withdraw-service.js';
import { createRequireWithdrawApiKey } from '../middleware/withdraw-auth.js';
import { internalWithdrawalStateParamsSchema } from '../schemas/internal-withdraw-schemas.js';

export const createInternalWithdrawRoutes = (
  withdrawService: WithdrawService,
  options: {
    internalApiKey?: string;
  }
): Router => {
  const router = Router();
  const requireInternalApiKey = createRequireWithdrawApiKey(
    options.internalApiKey,
    'WITHDRAW_INTERNAL_UNAUTHORIZED',
    'withdraw internal api key is required'
  );

  router.get('/coin-manage/:withdrawalId/state', requireInternalApiKey, async (req, res, next) => {
    try {
      const parsed = internalWithdrawalStateParamsSchema.safeParse(req.params);
      if (!parsed.success) {
        throw zodToDomainError(parsed.error);
      }

      const state = await withdrawService.getFoxyaPollingState(parsed.data.withdrawalId);
      if (!state) {
        throw new DomainError(404, 'NOT_FOUND', 'withdrawal not found');
      }

      res.json({
        schemaVersion: WITHDRAW_BRIDGE_SCHEMA_VERSION,
        ...state
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
