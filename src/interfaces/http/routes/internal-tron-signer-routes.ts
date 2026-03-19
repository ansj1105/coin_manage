import { Router } from 'express';
import type { TronGateway } from '../../../application/ports/tron-gateway.js';
import {
  TRON_SIGNER_SCHEMA_VERSION,
  tronSignerTxResponseSchema
} from '../../../contracts/tron-signer-contracts.js';
import { zodToDomainError } from '../../../core/validation.js';
import { createRequireWithdrawApiKey } from '../middleware/withdraw-auth.js';
import {
  tronSignerBroadcastNativeRequestSchema,
  tronSignerBroadcastTransferRequestSchema,
  tronSignerResourceRequestSchema
} from '../schemas/internal-tron-signer-schemas.js';

export const createInternalTronSignerRoutes = (
  tronGateway: TronGateway,
  options: {
    internalApiKey?: string;
    signerBackend: 'local' | 'remote';
  }
): Router => {
  const router = Router();
  const requireInternalApiKey = createRequireWithdrawApiKey(
    options.internalApiKey,
    'TRON_SIGNER_UNAUTHORIZED',
    'tron signer api key is required'
  );

  router.post('/tron/broadcast-transfer', requireInternalApiKey, async (req, res, next) => {
    try {
      const body = tronSignerBroadcastTransferRequestSchema.safeParse(req.body ?? {});
      if (!body.success) {
        throw zodToDomainError(body.error);
      }

      const { txHash } = await tronGateway.broadcastTransfer({
        toAddress: body.data.toAddress,
        amount: BigInt(body.data.amountSun),
        network: body.data.network,
        apiUrl: body.data.apiUrl,
        contractAddress: body.data.contractAddress,
        fromAddress: body.data.fromAddress
      });

      res.json(
        tronSignerTxResponseSchema.parse({
          schemaVersion: TRON_SIGNER_SCHEMA_VERSION,
          txHash,
          signerBackend: options.signerBackend,
          broadcastedAt: new Date().toISOString()
        })
      );
    } catch (error) {
      next(error);
    }
  });

  router.post('/tron/broadcast-native', requireInternalApiKey, async (req, res, next) => {
    try {
      const body = tronSignerBroadcastNativeRequestSchema.safeParse(req.body ?? {});
      if (!body.success) {
        throw zodToDomainError(body.error);
      }

      const { txHash } = await tronGateway.broadcastNativeTransfer({
        toAddress: body.data.toAddress,
        amount: BigInt(body.data.amountSun),
        network: body.data.network,
        apiUrl: body.data.apiUrl,
        fromAddress: body.data.fromAddress
      });

      res.json(
        tronSignerTxResponseSchema.parse({
          schemaVersion: TRON_SIGNER_SCHEMA_VERSION,
          txHash,
          signerBackend: options.signerBackend,
          broadcastedAt: new Date().toISOString()
        })
      );
    } catch (error) {
      next(error);
    }
  });

  router.post('/tron/delegate-resource', requireInternalApiKey, async (req, res, next) => {
    try {
      const body = tronSignerResourceRequestSchema.safeParse(req.body ?? {});
      if (!body.success) {
        throw zodToDomainError(body.error);
      }

      const { txHash } = await tronGateway.delegateResource({
        receiverAddress: body.data.receiverAddress,
        amountSun: BigInt(body.data.amountSun),
        resource: body.data.resource,
        network: body.data.network,
        fromAddress: body.data.fromAddress,
        lock: body.data.lock,
        lockPeriod: body.data.lockPeriod
      });

      res.json(
        tronSignerTxResponseSchema.parse({
          schemaVersion: TRON_SIGNER_SCHEMA_VERSION,
          txHash,
          signerBackend: options.signerBackend,
          broadcastedAt: new Date().toISOString()
        })
      );
    } catch (error) {
      next(error);
    }
  });

  router.post('/tron/undelegate-resource', requireInternalApiKey, async (req, res, next) => {
    try {
      const body = tronSignerResourceRequestSchema.safeParse(req.body ?? {});
      if (!body.success) {
        throw zodToDomainError(body.error);
      }

      const { txHash } = await tronGateway.undelegateResource({
        receiverAddress: body.data.receiverAddress,
        amountSun: BigInt(body.data.amountSun),
        resource: body.data.resource,
        network: body.data.network,
        fromAddress: body.data.fromAddress,
        lock: body.data.lock,
        lockPeriod: body.data.lockPeriod
      });

      res.json(
        tronSignerTxResponseSchema.parse({
          schemaVersion: TRON_SIGNER_SCHEMA_VERSION,
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
