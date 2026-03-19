import { Router } from 'express';
import type { WithdrawalSigner } from '../../../application/ports/withdrawal-signer.js';
import {
  WITHDRAW_SIGNER_SCHEMA_VERSION,
  withdrawalSignerBroadcastResponseSchema
} from '../../../contracts/withdraw-signer-contracts.js';
import { zodToDomainError } from '../../../core/validation.js';
import { createRequireWithdrawApiKey } from '../middleware/withdraw-auth.js';
import { internalSignerBroadcastParamsSchema, internalSignerBroadcastRequestSchema } from '../schemas/internal-signer-schemas.js';

export const createInternalSignerRoutes = (
  withdrawalSigner: WithdrawalSigner,
  options: {
    internalApiKey?: string;
    signerBackend: 'local' | 'remote';
  }
): Router => {
  const router = Router();
  const requireInternalApiKey = createRequireWithdrawApiKey(
    options.internalApiKey,
    'WITHDRAW_SIGNER_UNAUTHORIZED',
    'withdraw signer api key is required'
  );

  router.post('/withdrawals/:withdrawalId/broadcast', requireInternalApiKey, async (req, res, next) => {
    try {
      const params = internalSignerBroadcastParamsSchema.safeParse(req.params);
      if (!params.success) {
        throw zodToDomainError(params.error);
      }

      const body = internalSignerBroadcastRequestSchema.safeParse(req.body ?? {});
      if (!body.success) {
        throw zodToDomainError(body.error);
      }

      const { txHash } = await withdrawalSigner.broadcastWithdrawal({
        withdrawalId: params.data.withdrawalId,
        toAddress: body.data.toAddress,
        amount: BigInt(body.data.amountSun)
      });

      res.json(
        withdrawalSignerBroadcastResponseSchema.parse({
          schemaVersion: WITHDRAW_SIGNER_SCHEMA_VERSION,
          withdrawalId: params.data.withdrawalId,
          txHash,
          signerBackend: options.signerBackend,
          broadcastedAt: new Date().toISOString()
        })
      );
    } catch (error) {
      next(error);
    }
  });

  return router;
};
