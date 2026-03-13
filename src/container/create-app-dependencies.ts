import { ExternalAlertMonitorService } from '../application/services/external-alert-monitor-service.js';
import { ExternalAlertMonitorWorker } from '../application/services/external-alert-monitor-worker.js';
import { AccountReconciliationService } from '../application/services/account-reconciliation-service.js';
import { MonitoringWorker } from '../application/services/monitoring-worker.js';
import { SystemMonitoringService } from '../application/services/system-monitoring-service.js';
import { OnchainService } from '../application/services/onchain-service.js';
import { env } from '../config/env.js';
import { getConfiguredSystemWallets } from '../config/system-wallets.js';
import { parseKoriAmount } from '../domain/value-objects/money.js';
import { DepositService } from '../application/services/deposit-service.js';
import { DepositMonitorService } from '../application/services/deposit-monitor-service.js';
import { DepositMonitorWorker } from '../application/services/deposit-monitor-worker.js';
import { ActivationGrantService } from '../application/services/activation-grant-service.js';
import { ActivationGrantWorker } from '../application/services/activation-grant-worker.js';
import { AlertService } from '../application/services/alert-service.js';
import { AlertWorker } from '../application/services/alert-worker.js';
import { OperationsService } from '../application/services/operations-service.js';
import { SchedulerService } from '../application/services/scheduler-service.js';
import { SweepBotService } from '../application/services/sweep-bot-service.js';
import { SweepBotWorker } from '../application/services/sweep-bot-worker.js';
import { VirtualWalletService } from '../application/services/virtual-wallet-service.js';
import { VirtualWalletLifecyclePolicyService } from '../application/services/virtual-wallet-lifecycle-policy-service.js';
import { WalletService } from '../application/services/wallet-service.js';
import { WithdrawService } from '../application/services/withdraw-service.js';
import { MockTronGateway } from '../infrastructure/blockchain/mock-tron-gateway.js';
import { TronWalletReader } from '../infrastructure/blockchain/tron-wallet-reader.js';
import { TronTrc20EventReader } from '../infrastructure/blockchain/tron-trc20-event-reader.js';
import { TronWebTrc20Gateway } from '../infrastructure/blockchain/tronweb-trc20-gateway.js';
import { InMemoryEventPublisher } from '../infrastructure/events/in-memory-event-publisher.js';
import { FoxyaInternalDepositClient } from '../infrastructure/integration/foxya-internal-deposit-client.js';
import { FoxyaInternalWalletClient } from '../infrastructure/integration/foxya-internal-wallet-client.js';
import { PostgresFoxyaAlertSourceRepository } from '../infrastructure/integration/foxya-alert-source-repository.js';
import { PostgresFoxyaWalletRepository } from '../infrastructure/integration/foxya-wallet-repository.js';
import { TelegramAlertNotifier } from '../infrastructure/notifications/telegram-alert-notifier.js';
import { InMemoryAlertMonitorStateRepository } from '../infrastructure/persistence/in-memory-alert-monitor-state-repository.js';
import { InMemoryDepositMonitorRepository } from '../infrastructure/persistence/in-memory-deposit-monitor-repository.js';
import { InMemoryLedgerRepository } from '../infrastructure/persistence/in-memory-ledger-repository.js';
import { InMemoryMonitoringRepository } from '../infrastructure/persistence/in-memory-monitoring-repository.js';
import { InMemoryVirtualWalletRepository } from '../infrastructure/persistence/in-memory-virtual-wallet-repository.js';
import { PostgresAlertMonitorStateRepository } from '../infrastructure/persistence/postgres/postgres-alert-monitor-state-repository.js';
import { PostgresDepositMonitorRepository } from '../infrastructure/persistence/postgres/postgres-deposit-monitor-repository.js';
import { PostgresMonitoringRepository } from '../infrastructure/persistence/postgres/postgres-monitoring-repository.js';
import { PostgresLedgerRepository } from '../infrastructure/persistence/postgres/postgres-ledger-repository.js';
import { PostgresVirtualWalletRepository } from '../infrastructure/persistence/postgres/postgres-virtual-wallet-repository.js';
import { createPostgresDb, createPostgresPool } from '../infrastructure/persistence/postgres/postgres-pool.js';
import { AesGcmVirtualWalletKeyCipher } from '../infrastructure/security/virtual-wallet-key-cipher.js';
import type { BlockchainReader } from '../application/ports/blockchain-reader.js';
import type { TronGateway } from '../application/ports/tron-gateway.js';
import type { AppDependencies } from './app-dependencies.js';
import { Pool } from 'pg';

type AppDependencyOverrides = {
  tronGateway?: TronGateway;
  blockchainReader?: BlockchainReader;
};

const createPersistence = () => {
  const limits = {
    singleLimit: parseKoriAmount(env.withdrawSingleLimitKori),
    dailyLimit: parseKoriAmount(env.withdrawDailyLimitKori)
  };

  if (env.ledgerProvider === 'postgres') {
    const pool = createPostgresPool();
    const db = createPostgresDb(pool);
    return {
      ledger: new PostgresLedgerRepository(db, limits),
      virtualWalletRepository: new PostgresVirtualWalletRepository(db, env.virtualWalletEncryptionKey),
      monitoringRepository: new PostgresMonitoringRepository(db),
      depositMonitorRepository: new PostgresDepositMonitorRepository(db),
      alertMonitorStateRepository: new PostgresAlertMonitorStateRepository(db)
    };
  }

  const ledger = new InMemoryLedgerRepository(limits);
  return {
    ledger,
    virtualWalletRepository: new InMemoryVirtualWalletRepository(ledger),
    monitoringRepository: new InMemoryMonitoringRepository(),
    depositMonitorRepository: new InMemoryDepositMonitorRepository(),
    alertMonitorStateRepository: new InMemoryAlertMonitorStateRepository()
  };
};

const createTronGateway = () => {
  return env.tronGatewayMode === 'trc20' ? new TronWebTrc20Gateway() : new MockTronGateway();
};

const resolveFoxyaInternalWalletApiUrl = () => {
  if (env.foxyaInternalWalletApiUrl) {
    return env.foxyaInternalWalletApiUrl;
  }

  if (!env.foxyaInternalApiUrl) {
    return undefined;
  }

  return env.foxyaInternalApiUrl.replace(/\/deposits\/?$/, '/wallets');
};

export const createAppDependencies = (overrides: AppDependencyOverrides = {}): AppDependencies => {
  const eventPublisher = new InMemoryEventPublisher();
  const { ledger, virtualWalletRepository, monitoringRepository, depositMonitorRepository, alertMonitorStateRepository } =
    createPersistence();
  const tronGateway = overrides.tronGateway ?? createTronGateway();
  const blockchainReader = overrides.blockchainReader ?? new TronWalletReader();
  const alertNotifier = env.telegram ? new TelegramAlertNotifier(env.telegram.botToken, env.telegram.chatId) : undefined;
  const alertService = new AlertService(alertNotifier);
  const trc20EventReader = new TronTrc20EventReader();
  const systemWallets = getConfiguredSystemWallets();
  const systemMonitoringService = new SystemMonitoringService(
    blockchainReader,
    monitoringRepository,
    env.walletMonitorRequestGapMs
  );
  const onchainService = new OnchainService(blockchainReader, tronGateway);
  const monitoringWorker = new MonitoringWorker(
    systemMonitoringService,
    systemWallets,
    env.walletMonitorIntervalSec * 1000
  );
  const trackedDepositWallets = [
    env.treasuryWalletAddress,
    ...env.depositWalletAddresses,
    env.hotWalletAddress
  ];

  const depositService = new DepositService(ledger, eventPublisher, trackedDepositWallets);
  const foxyaClient =
    env.foxyaInternalApiUrl && env.foxyaInternalApiKey
      ? new FoxyaInternalDepositClient(env.foxyaInternalApiUrl, env.foxyaInternalApiKey)
      : undefined;
  const foxyaWalletSyncClient =
    resolveFoxyaInternalWalletApiUrl() && env.foxyaInternalApiKey
      ? new FoxyaInternalWalletClient(resolveFoxyaInternalWalletApiUrl()!, env.foxyaInternalApiKey)
      : undefined;
  const foxyaWalletRepository =
    env.foxyaDb?.encryptionKey && env.foxyaDb.host && env.foxyaDb.name && env.foxyaDb.user
      ? new PostgresFoxyaWalletRepository(
          new Pool({
            host: env.foxyaDb.host,
            port: env.foxyaDb.port,
            database: env.foxyaDb.name,
            user: env.foxyaDb.user,
            password: env.foxyaDb.password,
            max: 5
          }),
          env.foxyaDb.encryptionKey
        )
      : undefined;
  const foxyaAlertSourceRepository =
    env.foxyaDb?.host && env.foxyaDb.name && env.foxyaDb.user
      ? new PostgresFoxyaAlertSourceRepository(
          new Pool({
            host: env.foxyaDb.host,
            port: env.foxyaDb.port,
            database: env.foxyaDb.name,
            user: env.foxyaDb.user,
            password: env.foxyaDb.password,
            max: 5
          })
        )
      : undefined;
  const virtualWalletLifecyclePolicy = new VirtualWalletLifecyclePolicyService(virtualWalletRepository);
  const activationGrantService = new ActivationGrantService(virtualWalletRepository, tronGateway, alertService);
  const activationGrantWorker = new ActivationGrantWorker(
    activationGrantService,
    alertService,
    env.activationGrantIntervalSec * 1000
  );
  const depositMonitorService = new DepositMonitorService(
    depositMonitorRepository,
    foxyaClient,
    trc20EventReader,
    ledger,
    virtualWalletLifecyclePolicy,
    alertService
  );
  const depositMonitorWorker = new DepositMonitorWorker(
    depositMonitorService,
    alertService,
    env.depositMonitorPollIntervalSec * 1000
  );
  const virtualWalletService = new VirtualWalletService(
    virtualWalletRepository,
    new AesGcmVirtualWalletKeyCipher(env.virtualWalletEncryptionKey),
    env.hotWalletAddress,
    undefined,
    foxyaWalletSyncClient
  );
  const walletService = new WalletService(ledger, eventPublisher);
  const withdrawService = new WithdrawService(ledger, eventPublisher, tronGateway, virtualWalletLifecyclePolicy);
  const accountReconciliationService = new AccountReconciliationService(ledger, depositMonitorService, withdrawService);
  const schedulerService = new SchedulerService(ledger, withdrawService, eventPublisher);
  const operationsService = new OperationsService(ledger, systemMonitoringService);
  const sweepBotService = new SweepBotService(
    depositMonitorRepository,
    foxyaClient,
    foxyaWalletRepository,
    ledger,
    tronGateway,
    alertService
  );
  const sweepBotWorker = new SweepBotWorker(sweepBotService, alertService, env.sweepBotPollIntervalSec * 1000);
  const alertWorker = new AlertWorker(alertService, operationsService, env.walletMonitorIntervalSec * 1000);
  const externalAlertMonitorService = new ExternalAlertMonitorService(
    alertMonitorStateRepository,
    alertService,
    foxyaAlertSourceRepository,
    {
      enabled: env.alertMonitor.enabled,
      tables: env.alertMonitor.tables,
      healthTargets: env.alertMonitor.healthTargets,
      eventLimit: env.alertMonitor.eventLimit,
      healthFailureThreshold: env.alertMonitor.healthFailureThreshold
    }
  );
  const externalAlertMonitorWorker = new ExternalAlertMonitorWorker(
    externalAlertMonitorService,
    env.alertMonitor.pollIntervalSec * 1000
  );

  return {
    ledger,
    depositMonitorRepository,
    alertMonitorStateRepository,
    eventPublisher,
    alertService,
    activationGrantService,
    activationGrantWorker,
    externalAlertMonitorService,
    externalAlertMonitorWorker,
    systemMonitoringService,
    onchainService,
    depositMonitorService,
    depositMonitorWorker,
    sweepBotService,
    sweepBotWorker,
    monitoringWorker,
    alertWorker,
    depositService,
    virtualWalletService,
    virtualWalletLifecyclePolicy,
    walletService,
    accountReconciliationService,
    withdrawService,
    schedulerService,
    operationsService
  };
};
