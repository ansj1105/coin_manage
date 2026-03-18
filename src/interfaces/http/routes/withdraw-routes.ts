import { Router } from 'express';
import { z } from 'zod';
import { WithdrawService } from '../../../application/services/withdraw-service.js';
import { env } from '../../../config/env.js';
import { DomainError } from '../../../domain/errors/domain-error.js';
import { formatKoriAmount } from '../../../domain/value-objects/money.js';
import { tronAddressPattern } from '../../../domain/value-objects/tron-address.js';
import { requireIdempotencyKey, zodToDomainError } from '../../../core/validation.js';
import {
  createRequireWithdrawApiKey,
  readWithdrawActorId,
  readWithdrawAdminActorId
} from '../middleware/withdraw-auth.js';

const requestSchema = z.object({
  userId: z.string().min(1).optional(),
  walletAddress: z.string().regex(tronAddressPattern, 'invalid TRON address format').optional(),
  amount: z.number().positive(),
  toAddress: z.string().regex(tronAddressPattern, 'invalid TRON address format'),
  clientIp: z.string().max(64).optional(),
  deviceId: z.string().max(128).optional()
}).refine((value) => value.userId || value.walletAddress, {
  message: 'userId or walletAddress is required'
});

const approveSchema = z.object({
  adminId: z.string().min(1).optional(),
  note: z.string().max(500).optional()
});

const externalAuthConfirmSchema = z.object({
  provider: z.string().min(1).max(64),
  requestId: z.string().min(1).max(128),
  actorId: z.string().min(1).max(64).optional()
});

type WithdrawRouteSecurityOptions = {
  requestApiKey?: string;
  adminApiKey?: string;
};

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
      const parsed = requestSchema.safeParse(req.body);
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
        withdrawal: {
          ...result.withdrawal,
          amount: formatKoriAmount(result.withdrawal.amount)
        }
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
          ...withdrawal,
          amount: formatKoriAmount(withdrawal.amount)
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
      const parsed = approveSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw zodToDomainError(parsed.error);
      }

      const result = await withdrawService.approve(req.params.withdrawalId, {
        adminId: readWithdrawAdminActorId(req) ?? parsed.data.adminId,
        note: parsed.data.note
      });
      res.json({
        approval: result.approval,
        withdrawal: {
          ...result.withdrawal,
          amount: formatKoriAmount(result.withdrawal.amount)
        },
        finalized: result.finalized
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:withdrawalId/external-auth/confirm', requireAdminApiKey, async (req, res, next) => {
    try {
      const parsed = externalAuthConfirmSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw zodToDomainError(parsed.error);
      }

      const withdrawal = await withdrawService.confirmExternalAuth(req.params.withdrawalId, {
        ...parsed.data,
        actorId: readWithdrawActorId(req) ?? parsed.data.actorId
      });
      res.json({
        withdrawal: {
          ...withdrawal,
          amount: formatKoriAmount(withdrawal.amount)
        }
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
        withdrawal: {
          ...withdrawal,
          amount: formatKoriAmount(withdrawal.amount)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:withdrawalId/confirm', requireAdminApiKey, async (req, res, next) => {
    try {
      const withdrawal = await withdrawService.confirm(req.params.withdrawalId);
      res.json({
        withdrawal: {
          ...withdrawal,
          amount: formatKoriAmount(withdrawal.amount)
        }
      });
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
        withdrawal: {
          ...withdrawal,
          amount: formatKoriAmount(withdrawal.amount)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
