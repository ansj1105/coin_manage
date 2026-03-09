import { Router } from 'express';
import { z } from 'zod';
import type { CollectorRunRecord, StoredWalletMonitoringSnapshot } from '../../../application/ports/monitoring-repository.js';
import type { DepositMonitorStatus } from '../../../domain/deposit-monitor/types.js';
import { AlertService } from '../../../application/services/alert-service.js';
import { DepositMonitorService } from '../../../application/services/deposit-monitor-service.js';
import { OperationsService } from '../../../application/services/operations-service.js';
import { SweepBotService } from '../../../application/services/sweep-bot-service.js';
import { SystemMonitoringService } from '../../../application/services/system-monitoring-service.js';
import { buildBlockchainNetworkCatalog } from '../../../config/blockchain-networks.js';
import { env } from '../../../config/env.js';
import { getRuntimeContractProfile, setRuntimeContractProfile } from '../../../config/runtime-settings.js';
import { getConfiguredSystemWallets } from '../../../config/system-wallets.js';
import { DomainError } from '../../../domain/errors/domain-error.js';
import { formatKoriAmount } from '../../../domain/value-objects/money.js';
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

const sweepTransitionSchema = z.object({
  txHash: z.string().min(8).max(128).optional(),
  note: z.string().max(500).optional()
});

export const buildSystemStatusResponse = (
  walletMonitoring: StoredWalletMonitoringSnapshot[] = [],
  collectorRuns: CollectorRunRecord[] = [],
  depositMonitor?: DepositMonitorStatus,
  reconciliation?: {
    ledger: Record<string, string | number>;
    onchain: Record<string, string | number>;
    gap: { amount: string; status: string };
    alerts: string[];
  },
  automation?: {
    sweepBot: ReturnType<SweepBotService['getStatus']>;
    telegramEnabled: boolean;
  }
) => {
  const walletMonitoringByCode = new Map(walletMonitoring.map((snapshot) => [snapshot.walletCode, snapshot]));
  const walletCatalog = getConfiguredSystemWallets().map((wallet) => ({
    ...wallet,
    monitoring: walletMonitoringByCode.get(wallet.code) ?? null
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
      tronFeeLimitSun: env.tronFeeLimitSun,
      hotWalletAlertMinKori: env.hotWalletAlertMinKori,
      hotWalletAlertMinTrx: env.hotWalletAlertMinTrx,
      sweepPlanMinKori: env.sweepPlanMinKori
    },
    wallets: {
      treasury: env.treasuryWalletAddress,
      deposits: env.depositWalletAddresses,
      hot: env.hotWalletAddress,
      tracked: trackedWallets,
      catalog: walletCatalog
    },
    contracts: contractRuntime,
    networks: buildBlockchainNetworkCatalog(),
    monitoring: {
      enabled: env.walletMonitorEnabled,
      intervalSec: env.walletMonitorIntervalSec,
      requestGapMs: env.walletMonitorRequestGapMs,
      collectors: collectorRuns
    },
    depositMonitor: depositMonitor ?? null,
    automation: automation ?? null,
    database: {
      host: env.db.host,
      port: env.db.port,
      name: env.db.name,
      schema: env.db.schema
    },
    security: {
      jwtConfigured: !PLACEHOLDER_SECRETS.has(env.jwtSecret),
      hotWalletPrivateKeyConfigured: !PLACEHOLDER_SECRETS.has(env.hotWalletPrivateKey)
    },
    sandbox: {
      runtimeProfileEditable: env.runtimeProfileEditable,
      directOnchainSendEnabled: env.sandboxDirectOnchainSendEnabled,
      mainnetDirectOnchainSendEnabled: env.sandboxMainnetDirectOnchainSendEnabled,
      onchainTransferSourcePolicy: 'hot_only',
      onchainTransferExecutableWalletCodes: ['hot']
    },
    reconciliation: reconciliation ?? null
  };
};

export const createSystemRoutes = (
  systemMonitoringService: SystemMonitoringService,
  operationsService: OperationsService,
  depositMonitorService: DepositMonitorService,
  sweepBotService: SweepBotService,
  alertService: AlertService
): Router => {
  const router = Router();
  const getConfiguredWallets = () => getConfiguredSystemWallets();

  router.get('/status', async (_req, res, next) => {
    try {
      const wallets = getConfiguredWallets();
      const [monitoring, collectorRuns, depositMonitor, reconciliation] = await Promise.all([
        systemMonitoringService.getStoredWallets(wallets),
        systemMonitoringService.getCollectorRuns(),
        depositMonitorService.getStatus(),
        operationsService.getReconciliationReport()
      ]);
      res.json(
        buildSystemStatusResponse(monitoring, collectorRuns, depositMonitor, reconciliation, {
          sweepBot: sweepBotService.getStatus(),
          telegramEnabled: alertService.enabled
        })
      );
    } catch (error) {
      next(error);
    }
  });

  router.post('/monitoring/run', async (_req, res, next) => {
    try {
      const wallets = getConfiguredWallets();
      const { snapshots, run } = await systemMonitoringService.collectWallets(wallets);
      const [collectorRuns, depositMonitor, reconciliation] = await Promise.all([
        systemMonitoringService.getCollectorRuns(),
        depositMonitorService.getStatus(),
        operationsService.getReconciliationReport()
      ]);
      res.json({
        run,
        status: buildSystemStatusResponse(snapshots, collectorRuns, depositMonitor, reconciliation, {
          sweepBot: sweepBotService.getStatus(),
          telegramEnabled: alertService.enabled
        })
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/deposit-monitor', async (_req, res, next) => {
    try {
      res.json(await depositMonitorService.getStatus());
    } catch (error) {
      next(error);
    }
  });

  router.post('/deposit-monitor/run', async (_req, res, next) => {
    try {
      const result = await depositMonitorService.runCycle();
      res.json({
        result,
        status: await depositMonitorService.getStatus()
      });
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
      const wallets = getConfiguredWallets();
      const { snapshots } = await systemMonitoringService.collectWallets(wallets);
      const [collectorRuns, depositMonitor, reconciliation] = await Promise.all([
        systemMonitoringService.getCollectorRuns(),
        depositMonitorService.getStatus(),
        operationsService.getReconciliationReport()
      ]);
      res.json(
        buildSystemStatusResponse(snapshots, collectorRuns, depositMonitor, reconciliation, {
          sweepBot: sweepBotService.getStatus(),
          telegramEnabled: alertService.enabled
        })
      );
    } catch (error) {
      next(error);
    }
  });

  router.get('/sweep-bot', async (_req, res, next) => {
    try {
      res.json(sweepBotService.getStatus());
    } catch (error) {
      next(error);
    }
  });

  router.post('/sweep-bot/run', async (_req, res, next) => {
    try {
      const result = await sweepBotService.runCycle();
      res.json({
        result,
        status: sweepBotService.getStatus()
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/alerts/telegram/test', async (_req, res, next) => {
    try {
      await alertService.sendTestMessage();
      res.json({ ok: true, telegramEnabled: alertService.enabled });
    } catch (error) {
      next(error);
    }
  });

  router.get('/audit-logs', async (req, res, next) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const logs = await operationsService.listAuditLogs({
        entityType: req.query.entityType as 'withdrawal' | 'sweep' | 'system' | undefined,
        entityId: typeof req.query.entityId === 'string' ? req.query.entityId : undefined,
        limit
      });
      res.json({ logs });
    } catch (error) {
      next(error);
    }
  });

  router.get('/reconciliation', async (_req, res, next) => {
    try {
      res.json(await operationsService.getReconciliationReport());
    } catch (error) {
      next(error);
    }
  });

  router.post('/sweeps/plan', async (_req, res, next) => {
    try {
      const result = await operationsService.planSweeps();
      res.json({
        plannedCount: result.plannedCount,
        sweeps: result.sweeps.map((sweep) => ({
          ...sweep,
          amount: formatKoriAmount(sweep.amount)
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/sweeps', async (req, res, next) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const sweeps = await operationsService.listSweeps(limit);
      res.json({
        sweeps: sweeps.map((sweep) => ({
          ...sweep,
          amount: formatKoriAmount(sweep.amount)
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/sweeps/:sweepId/broadcast', async (req, res, next) => {
    try {
      const parsed = sweepTransitionSchema.safeParse(req.body ?? {});
      if (!parsed.success || !parsed.data.txHash) {
        throw new DomainError(400, 'INVALID_REQUEST', 'txHash is required for sweep broadcast');
      }
      const sweep = await operationsService.markSweepBroadcasted(
        req.params.sweepId,
        parsed.data.txHash,
        parsed.data.note
      );
      res.json({
        sweep: {
          ...sweep,
          amount: formatKoriAmount(sweep.amount)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/sweeps/:sweepId/confirm', async (req, res, next) => {
    try {
      const parsed = sweepTransitionSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new DomainError(400, 'INVALID_REQUEST', 'invalid sweep confirm payload', parsed.error.flatten());
      }
      const sweep = await operationsService.confirmSweep(req.params.sweepId, parsed.data.note);
      res.json({
        sweep: {
          ...sweep,
          amount: formatKoriAmount(sweep.amount)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
