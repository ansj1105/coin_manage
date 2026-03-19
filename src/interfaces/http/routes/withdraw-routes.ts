import { Router } from 'express';
import { WithdrawService } from '../../../application/services/withdraw-service.js';
import { env } from '../../../config/env.js';
import type { Withdrawal } from '../../../domain/ledger/types.js';
import { mapWithdrawalDisplayStatus } from '../../../domain/ledger/withdraw-display-status.js';
import { DomainError } from '../../../domain/errors/domain-error.js';
import { formatKoriAmount } from '../../../domain/value-objects/money.js';
import { requireIdempotencyKey, zodToDomainError } from '../../../core/validation.js';
import {
  withdrawAddressPolicyParamsSchema,
  withdrawAddressPolicyQuerySchema,
  withdrawAddressPolicyUpsertSchema,
  withdrawApproveSchema,
  withdrawExternalAuthConfirmSchema,
  withdrawOfflineSubmitSchema,
  withdrawRequestSchema
} from '../schemas/withdraw-schemas.js';
import {
  createRequireWithdrawApiKey,
  readWithdrawActorId,
  readWithdrawAdminActorId
} from '../middleware/withdraw-auth.js';

type WithdrawRouteSecurityOptions = {
  requestApiKey?: string;
  adminApiKey?: string;
};

const serializeWithdrawal = (withdrawal: Withdrawal) => ({
  ...withdrawal,
  amount: formatKoriAmount(withdrawal.amount),
  displayStatus: mapWithdrawalDisplayStatus(withdrawal)
});

export const createWithdrawRoutes = (
  withdrawService: WithdrawService,
  security: WithdrawRouteSecurityOptions = {
    requestApiKey: env.withdrawRequestApiKey,
    adminApiKey: env.withdrawAdminApiKey
  }
): Router => {
  const router = Router();
  const requireRequestApiKey = createRequireWithdrawApiKey(
    security.requestApiKey,
    'WITHDRAW_REQUEST_UNAUTHORIZED',
    'withdraw request api key is required'
  );
  const requireAdminApiKey = createRequireWithdrawApiKey(
    security.adminApiKey,
    'WITHDRAW_ADMIN_UNAUTHORIZED',
    'withdraw admin api key is required'
  );

  router.post('/', requireRequestApiKey, async (req, res, next) => {
    try {
      const parsed = withdrawRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw zodToDomainError(parsed.error);
      }

      const idempotencyKey = requireIdempotencyKey(req.header('Idempotency-Key'));
      const result = await withdrawService.request({
        userId: parsed.data.userId,
        walletAddress: parsed.data.walletAddress,
        amountKori: parsed.data.amount,
        toAddress: parsed.data.toAddress,
        idempotencyKey,
        clientIp: parsed.data.clientIp,
        deviceId: parsed.data.deviceId
      });

      res.status(result.duplicated ? 200 : 201).json({
        duplicated: result.duplicated,
        withdrawal: serializeWithdrawal(result.withdrawal)
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/pending-approvals', requireAdminApiKey, async (_req, res, next) => {
    try {
      const withdrawals = await withdrawService.listPendingApprovals();
      res.json({
        withdrawals: withdrawals.map((withdrawal) => ({
          ...serializeWithdrawal(withdrawal)
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/reconcile', requireAdminApiKey, async (_req, res, next) => {
    try {
      const result = await withdrawService.reconcileBroadcasted();
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/:withdrawalId/approve', requireAdminApiKey, async (req, res, next) => {
    try {
      const parsed = withdrawApproveSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw zodToDomainError(parsed.error);
      }

      const result = await withdrawService.approve(req.params.withdrawalId, {
        adminId: readWithdrawAdminActorId(req) ?? parsed.data.adminId,
        reasonCode: parsed.data.reasonCode,
        note: parsed.data.note
      });
      res.json({
        approval: result.approval,
        withdrawal: serializeWithdrawal(result.withdrawal),
        finalized: result.finalized
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:withdrawalId/external-auth/confirm', requireAdminApiKey, async (req, res, next) => {
    try {
      const parsed = withdrawExternalAuthConfirmSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw zodToDomainError(parsed.error);
      }

      const withdrawal = await withdrawService.confirmExternalAuth(req.params.withdrawalId, {
        ...parsed.data,
        actorId: readWithdrawActorId(req) ?? parsed.data.actorId
      });
      res.json({
        withdrawal: serializeWithdrawal(withdrawal)
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:withdrawalId/broadcast', requireAdminApiKey, async (req, res, next) => {
    try {
      const withdrawal = await withdrawService.broadcast(req.params.withdrawalId);
      if (!withdrawal) {
        throw new DomainError(404, 'NOT_FOUND', 'withdrawal not found');
      }
      res.json({
        withdrawal: serializeWithdrawal(withdrawal)
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:withdrawalId/confirm', requireAdminApiKey, async (req, res, next) => {
    try {
      const withdrawal = await withdrawService.confirm(req.params.withdrawalId);
      res.json({
        withdrawal: serializeWithdrawal(withdrawal)
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/offline-pending', requireAdminApiKey, async (_req, res, next) => {
    try {
      const withdrawals = await withdrawService.listOfflineSigningPending();
      res.json({
        withdrawals: withdrawals.map((withdrawal) => ({
          ...serializeWithdrawal(withdrawal)
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:withdrawalId/offline-submit', requireAdminApiKey, async (req, res, next) => {
    try {
      const parsed = withdrawOfflineSubmitSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw zodToDomainError(parsed.error);
      }

      const withdrawal = await withdrawService.submitOfflineBroadcast(req.params.withdrawalId, {
        ...parsed.data,
        actorId: readWithdrawAdminActorId(req) ?? readWithdrawActorId(req) ?? parsed.data.actorId
      });
      if (!withdrawal) {
        throw new DomainError(404, 'NOT_FOUND', 'withdrawal not found');
      }

      res.json({
        withdrawal: serializeWithdrawal(withdrawal)
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/policies/addresses', requireAdminApiKey, async (req, res, next) => {
    try {
      const parsed = withdrawAddressPolicyQuerySchema.safeParse(req.query ?? {});
      if (!parsed.success) {
        throw zodToDomainError(parsed.error);
      }

      const policies = await withdrawService.listAddressPolicies(parsed.data);
      res.json({ policies });
    } catch (error) {
      next(error);
    }
  });

  router.post('/policies/addresses', requireAdminApiKey, async (req, res, next) => {
    try {
      const parsed = withdrawAddressPolicyUpsertSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw zodToDomainError(parsed.error);
      }

      const policy = await withdrawService.upsertAddressPolicy({
        ...parsed.data,
        createdBy: readWithdrawAdminActorId(req) ?? 'admin-unknown'
      });
      res.status(201).json({ policy });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/policies/addresses/:address/:policyType', requireAdminApiKey, async (req, res, next) => {
    try {
      const parsed = withdrawAddressPolicyParamsSchema.safeParse(req.params);
      if (!parsed.success) {
        throw zodToDomainError(parsed.error);
      }

      const deleted = await withdrawService.deleteAddressPolicy(parsed.data.address, parsed.data.policyType);
      res.json({ deleted });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:withdrawalId/approvals', requireAdminApiKey, async (req, res, next) => {
    try {
      const approvals = await withdrawService.listApprovals(req.params.withdrawalId);
      res.json({ approvals });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:withdrawalId', requireAdminApiKey, async (req, res, next) => {
    try {
      const withdrawal = await withdrawService.get(req.params.withdrawalId);
      if (!withdrawal) {
        throw new DomainError(404, 'NOT_FOUND', 'withdrawal not found');
      }
      res.json({
        withdrawal: serializeWithdrawal(withdrawal)
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
