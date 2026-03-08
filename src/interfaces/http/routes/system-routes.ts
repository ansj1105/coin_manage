import { Router } from 'express';
import { z } from 'zod';
import { BlockchainMonitorService } from '../../../application/services/blockchain-monitor-service.js';
import type { WalletMonitoringSnapshot } from '../../../application/ports/blockchain-reader.js';
import { env } from '../../../config/env.js';
import { getRuntimeContractProfile, setRuntimeContractProfile } from '../../../config/runtime-settings.js';
import { getConfiguredSystemWallets } from '../../../config/system-wallets.js';
import { DomainError } from '../../../domain/errors/domain-error.js';
import { tronAddressPattern } from '../../../domain/value-objects/tron-address.js';

const PLACEHOLDER_SECRETS = new Set([
  'replace-with-strong-secret',
  'replace-with-private-key',
  'dev-only-secret-change-me',
  'dev-only-private-key-change-me'
]);

const runtimeProfileSchema = z.object({
  profile: z.enum(['runtime', 'mainnet', 'testnet', 'custom']),
  customContractAddress: z.string().regex(tronAddressPattern).optional()
});

export const buildSystemStatusResponse = (walletMonitoring: WalletMonitoringSnapshot[] = []) => {
  const walletMonitoringByAddress = new Map(walletMonitoring.map((snapshot) => [snapshot.address, snapshot]));
  const walletCatalog = getConfiguredSystemWallets().map((wallet) => ({
    ...wallet,
    monitoring: walletMonitoringByAddress.get(wallet.address) ?? null
  }));
  const trackedWallets = walletCatalog.map((wallet) => wallet.address);
  const contractRuntime = getRuntimeContractProfile();

  return {
    service: {
      name: 'korion-kori-backend',
      nodeEnv: env.nodeEnv,
      port: env.port
    },
    runtime: {
      ledgerProvider: env.ledgerProvider,
      tronGatewayMode: env.tronGatewayMode,
      tronApiUrl: env.tronApiUrl,
      tronApiKeyConfigured: Boolean(env.tronApiKey),
      koriTokenContractConfigured: Boolean(env.koriTokenContractAddress),
      schedulerPendingTimeoutSec: env.schedulerPendingTimeoutSec
    },
    limits: {
      withdrawSingleLimitKori: env.withdrawSingleLimitKori,
      withdrawDailyLimitKori: env.withdrawDailyLimitKori,
      tronFeeLimitSun: env.tronFeeLimitSun
    },
    wallets: {
      treasury: env.treasuryWalletAddress,
      deposits: env.depositWalletAddresses,
      hot: env.hotWalletAddress,
      tracked: trackedWallets,
      catalog: walletCatalog
    },
    contracts: contractRuntime,
    database: {
      host: env.db.host,
      port: env.db.port,
      name: env.db.name,
      schema: env.db.schema
    },
    security: {
      jwtConfigured: !PLACEHOLDER_SECRETS.has(env.jwtSecret),
      hotWalletPrivateKeyConfigured: !PLACEHOLDER_SECRETS.has(env.hotWalletPrivateKey)
    }
  };
};

export const createSystemRoutes = (blockchainMonitorService: BlockchainMonitorService): Router => {
  const router = Router();
  const getTrackedWalletAddresses = () => {
    const configured = getConfiguredSystemWallets();
    const hotWallet = configured.find((wallet) => wallet.code === 'hot');
    const others = configured.filter((wallet) => wallet.code !== 'hot');
    return hotWallet ? [hotWallet.address, ...others.map((wallet) => wallet.address)] : configured.map((wallet) => wallet.address);
  };

  router.get('/status', async (_req, res, next) => {
    try {
      const monitoring = await blockchainMonitorService.getWalletMonitoring(getTrackedWalletAddresses());
      res.json(buildSystemStatusResponse(monitoring));
    } catch (error) {
      next(error);
    }
  });

  router.post('/runtime-profile', async (req, res, next) => {
    try {
      if (!env.runtimeProfileEditable) {
        throw new DomainError(403, 'FORBIDDEN', 'runtime profile switching is disabled for this runtime');
      }

      const parsed = runtimeProfileSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new DomainError(400, 'INVALID_REQUEST', 'invalid runtime profile payload', parsed.error.flatten());
      }

      if (parsed.data.profile === 'custom' && !parsed.data.customContractAddress) {
        throw new DomainError(400, 'INVALID_REQUEST', 'customContractAddress is required for custom profile');
      }

      setRuntimeContractProfile(parsed.data.profile, parsed.data.customContractAddress);
      const monitoring = await blockchainMonitorService.getWalletMonitoring(getTrackedWalletAddresses());
      res.json(buildSystemStatusResponse(monitoring));
    } catch (error) {
      next(error);
    }
  });

  return router;
};
