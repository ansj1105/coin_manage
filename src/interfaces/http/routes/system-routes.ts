import { Router } from 'express';
import { z } from 'zod';
import type { CollectorRunRecord, StoredWalletMonitoringSnapshot } from '../../../application/ports/monitoring-repository.js';
import type { DepositMonitorStatus } from '../../../domain/deposit-monitor/types.js';
import { AlertService } from '../../../application/services/alert-service.js';
import { DepositMonitorService } from '../../../application/services/deposit-monitor-service.js';
import { ExternalAlertMonitorService } from '../../../application/services/external-alert-monitor-service.js';
import { OperationsService } from '../../../application/services/operations-service.js';
import { SweepBotService } from '../../../application/services/sweep-bot-service.js';
import { SystemMonitoringService } from '../../../application/services/system-monitoring-service.js';
import { WithdrawGuardService, type HotWalletReadiness } from '../../../application/services/withdraw-guard-service.js';
import { buildBlockchainNetworkCatalog } from '../../../config/blockchain-networks.js';
import { env } from '../../../config/env.js';
import { getRuntimeContractProfile, setRuntimeContractProfile } from '../../../config/runtime-settings.js';
import { getConfiguredSystemWallets } from '../../../config/system-wallets.js';
import {
  buildLedgerContractExamples,
  parseLedgerContract,
  verifyLedgerContractSignature
} from '../../../contracts/ledger-contracts.js';
import { DomainError } from '../../../domain/errors/domain-error.js';
import { formatKoriAmount } from '../../../domain/value-objects/money.js';
import { tronAddressPattern } from '../../../domain/value-objects/tron-address.js';
import { hasAsmSecretBinding } from '../../../bootstrap/runtime-secrets.js';

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

const telegramTestSchema = z.object({
  message: z.string().trim().min(1).max(2000).optional()
});

const ledgerContractVerifySchema = z.object({
  payload: z.record(z.string(), z.unknown())
});

const depositReconcileSchema = z.object({
  lookbackMs: z.number().int().positive().max(30 * 24 * 60 * 60 * 1000).optional(),
  addresses: z.array(z.string().regex(tronAddressPattern)).max(100).optional(),
  txHashes: z.array(z.string().min(8).max(128)).max(100).optional()
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
    externalAlertMonitor?: Awaited<ReturnType<ExternalAlertMonitorService['getStatus']>>;
  },
  withdrawReadiness?: HotWalletReadiness,
  withdrawExternalSync?: Awaited<ReturnType<OperationsService['getWithdrawalExternalSyncStatus']>>
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
      withdrawMinTrxSun: env.withdrawMinTrxSun.toString(),
      withdrawMinBandwidth: env.withdrawMinBandwidth,
      withdrawMinEnergy: env.withdrawMinEnergy,
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
      hotWalletPrivateKeyConfigured: !PLACEHOLDER_SECRETS.has(env.hotWalletPrivateKey),
      withdrawRequestApiKeyConfigured: Boolean(env.withdrawRequestApiKey),
      withdrawAdminApiKeyConfigured: Boolean(env.withdrawAdminApiKey),
      secretSources: {
        jwt: hasAsmSecretBinding('JWT_SECRET') ? 'asm' : 'env',
        hotWalletPrivateKey: hasAsmSecretBinding('HOT_WALLET_PRIVATE_KEY') ? 'asm' : 'env',
        foxyaInternalApiKey: hasAsmSecretBinding('FOXYA_INTERNAL_API_KEY') ? 'asm' : 'env',
        foxyaInternalWithdrawalApiKey: hasAsmSecretBinding('FOXYA_INTERNAL_WITHDRAWAL_API_KEY')
          ? 'asm'
          : hasAsmSecretBinding('FOXYA_INTERNAL_API_KEY')
            ? 'asm:fallback-deposit'
            : env.foxyaInternalWithdrawalApiKey
              ? 'env'
              : 'unconfigured',
        foxyaEncryptionKey: hasAsmSecretBinding('FOXYA_ENCRYPTION_KEY') ? 'asm' : 'env',
        virtualWalletEncryptionKey: hasAsmSecretBinding('VIRTUAL_WALLET_ENCRYPTION_KEY') ? 'asm' : 'env'
      }
    },
    sandbox: {
      runtimeProfileEditable: env.runtimeProfileEditable,
      directOnchainSendEnabled: env.sandboxDirectOnchainSendEnabled,
      mainnetDirectOnchainSendEnabled: env.sandboxMainnetDirectOnchainSendEnabled,
      onchainTransferSourcePolicy: 'hot_only',
      onchainTransferExecutableWalletCodes: ['hot']
    },
    withdrawals: {
      readiness: withdrawReadiness ?? null,
      externalSync: withdrawExternalSync ?? null
    },
    reconciliation: reconciliation ?? null
  };
};

export const createSystemRoutes = (
  systemMonitoringService: SystemMonitoringService,
  operationsService: OperationsService,
  depositMonitorService: DepositMonitorService,
  sweepBotService: SweepBotService,
  alertService: AlertService,
  externalAlertMonitorService: ExternalAlertMonitorService,
  withdrawGuardService: WithdrawGuardService
): Router => {
  const router = Router();
  const getConfiguredWallets = () => getConfiguredSystemWallets();

  router.get('/status', async (_req, res, next) => {
    try {
      const wallets = getConfiguredWallets();
      const [monitoring, collectorRuns, depositMonitor, reconciliation, withdrawReadiness, withdrawExternalSync] =
        await Promise.all([
        systemMonitoringService.getStoredWallets(wallets),
        systemMonitoringService.getCollectorRuns(),
        depositMonitorService.getStatus(),
        operationsService.getReconciliationReport(),
        withdrawGuardService.getHotWalletReadiness(),
        operationsService.getWithdrawalExternalSyncStatus()
      ]);
      const externalAlertMonitor = await externalAlertMonitorService.getStatus();
      res.json(
        buildSystemStatusResponse(monitoring, collectorRuns, depositMonitor, reconciliation, {
          sweepBot: sweepBotService.getStatus(),
          telegramEnabled: alertService.enabled,
          externalAlertMonitor
        }, withdrawReadiness, withdrawExternalSync)
      );
    } catch (error) {
      next(error);
    }
  });

  router.post('/monitoring/run', async (_req, res, next) => {
    try {
      const wallets = getConfiguredWallets();
      const { snapshots, run } = await systemMonitoringService.collectWallets(wallets);
      const [collectorRuns, depositMonitor, reconciliation, withdrawReadiness] = await Promise.all([
        systemMonitoringService.getCollectorRuns(),
        depositMonitorService.getStatus(),
        operationsService.getReconciliationReport(),
        withdrawGuardService.getHotWalletReadiness()
      ]);
      const externalAlertMonitor = await externalAlertMonitorService.getStatus();
      res.json({
        run,
        status: buildSystemStatusResponse(snapshots, collectorRuns, depositMonitor, reconciliation, {
          sweepBot: sweepBotService.getStatus(),
          telegramEnabled: alertService.enabled,
          externalAlertMonitor
        }, withdrawReadiness)
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

  router.post('/deposit-monitor/reconcile', async (req, res, next) => {
    try {
      const parsed = depositReconcileSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new DomainError(400, 'INVALID_REQUEST', 'invalid deposit reconcile payload', parsed.error.flatten());
      }

      const result = await depositMonitorService.reconcile(parsed.data);
      res.json({
        result,
        status: await depositMonitorService.getStatus()
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/ledger/contracts', async (_req, res, next) => {
    try {
      res.json({
        issuer: env.ledgerIdentity.systemId,
        schemaVersion: buildLedgerContractExamples().schemaVersion,
        verification: {
          algorithm: 'HMAC-SHA256',
          verifyRoute: '/system/ledger/contracts/verify',
          note: 'Verify signature against the exact JSON body excluding no fields.'
        },
        examples: buildLedgerContractExamples()
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/ledger/contracts/verify', async (req, res, next) => {
    try {
      const parsed = ledgerContractVerifySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new DomainError(400, 'INVALID_REQUEST', 'invalid ledger contract verify payload', parsed.error.flatten());
      }

      const contract = parseLedgerContract(parsed.data.payload);
      const signatureValid = verifyLedgerContractSignature(contract);

      res.json({
        valid: signatureValid,
        eventType: contract.eventType,
        issuer: contract.issuer
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
      const externalAlertMonitor = await externalAlertMonitorService.getStatus();
      res.json(
        buildSystemStatusResponse(snapshots, collectorRuns, depositMonitor, reconciliation, {
          sweepBot: sweepBotService.getStatus(),
          telegramEnabled: alertService.enabled,
          externalAlertMonitor
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

  router.post('/alerts/telegram/test', async (req, res, next) => {
    try {
      const parsed = telegramTestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new DomainError(400, 'INVALID_REQUEST', 'invalid telegram test payload', parsed.error.flatten());
      }

      await alertService.sendTestMessage(parsed.data.message);
      res.json({ ok: true, telegramEnabled: alertService.enabled });
    } catch (error) {
      next(error);
    }
  });

  router.get('/external-alert-monitor', async (_req, res, next) => {
    try {
      res.json(await externalAlertMonitorService.getStatus());
    } catch (error) {
      next(error);
    }
  });

  router.post('/external-alert-monitor/run', async (_req, res, next) => {
    try {
      const result = await externalAlertMonitorService.runCycle();
      res.json({
        result,
        status: await externalAlertMonitorService.getStatus()
      });
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

  router.get('/withdraw-jobs/failed', async (req, res, next) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      res.json({
        jobs: await operationsService.listFailedWithdrawJobs(limit)
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/withdraw-jobs/recover', async (_req, res, next) => {
    try {
      res.json({
        result: await operationsService.seedWithdrawalQueueRecovery()
      });
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

  router.post('/ledger/projections/rebuild', async (_req, res, next) => {
    try {
      const result = await operationsService.rebuildLedgerProjections();
      const reconciliation = await operationsService.getReconciliationReport();
      res.json({
        result,
        reconciliation
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
