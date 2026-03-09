import { MonitoringWorker } from '../application/services/monitoring-worker.js';
import { SystemMonitoringService } from '../application/services/system-monitoring-service.js';
import { OnchainService } from '../application/services/onchain-service.js';
import { env } from '../config/env.js';
import { getConfiguredSystemWallets } from '../config/system-wallets.js';
import { parseKoriAmount } from '../domain/value-objects/money.js';
import { DepositService } from '../application/services/deposit-service.js';
import { DepositMonitorService } from '../application/services/deposit-monitor-service.js';
import { DepositMonitorWorker } from '../application/services/deposit-monitor-worker.js';
import { OperationsService } from '../application/services/operations-service.js';
import { SchedulerService } from '../application/services/scheduler-service.js';
import { WalletService } from '../application/services/wallet-service.js';
import { WithdrawService } from '../application/services/withdraw-service.js';
import { MockTronGateway } from '../infrastructure/blockchain/mock-tron-gateway.js';
import { TronWalletReader } from '../infrastructure/blockchain/tron-wallet-reader.js';
import { TronTrc20EventReader } from '../infrastructure/blockchain/tron-trc20-event-reader.js';
import { TronWebTrc20Gateway } from '../infrastructure/blockchain/tronweb-trc20-gateway.js';
import { InMemoryEventPublisher } from '../infrastructure/events/in-memory-event-publisher.js';
import { FoxyaInternalDepositClient } from '../infrastructure/integration/foxya-internal-deposit-client.js';
import { InMemoryDepositMonitorRepository } from '../infrastructure/persistence/in-memory-deposit-monitor-repository.js';
import { InMemoryLedgerRepository } from '../infrastructure/persistence/in-memory-ledger-repository.js';
import { InMemoryMonitoringRepository } from '../infrastructure/persistence/in-memory-monitoring-repository.js';
import { PostgresDepositMonitorRepository } from '../infrastructure/persistence/postgres/postgres-deposit-monitor-repository.js';
import { PostgresMonitoringRepository } from '../infrastructure/persistence/postgres/postgres-monitoring-repository.js';
import { PostgresLedgerRepository } from '../infrastructure/persistence/postgres/postgres-ledger-repository.js';
import { createPostgresDb, createPostgresPool } from '../infrastructure/persistence/postgres/postgres-pool.js';
import type { BlockchainReader } from '../application/ports/blockchain-reader.js';
import type { TronGateway } from '../application/ports/tron-gateway.js';
import type { AppDependencies } from './app-dependencies.js';

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
      monitoringRepository: new PostgresMonitoringRepository(db),
      depositMonitorRepository: new PostgresDepositMonitorRepository(db)
    };
  }

  return {
    ledger: new InMemoryLedgerRepository(limits),
    monitoringRepository: new InMemoryMonitoringRepository(),
    depositMonitorRepository: new InMemoryDepositMonitorRepository()
  };
};

const createTronGateway = () => {
  return env.tronGatewayMode === 'trc20' ? new TronWebTrc20Gateway() : new MockTronGateway();
};

export const createAppDependencies = (overrides: AppDependencyOverrides = {}): AppDependencies => {
  const eventPublisher = new InMemoryEventPublisher();
  const { ledger, monitoringRepository, depositMonitorRepository } = createPersistence();
  const tronGateway = overrides.tronGateway ?? createTronGateway();
  const blockchainReader = overrides.blockchainReader ?? new TronWalletReader();
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
  const depositMonitorService = new DepositMonitorService(depositMonitorRepository, foxyaClient, trc20EventReader);
  const depositMonitorWorker = new DepositMonitorWorker(
    depositMonitorService,
    env.depositMonitorPollIntervalSec * 1000
  );
  const walletService = new WalletService(ledger, eventPublisher);
  const withdrawService = new WithdrawService(ledger, eventPublisher, tronGateway);
  const schedulerService = new SchedulerService(ledger, withdrawService, eventPublisher);
  const operationsService = new OperationsService(ledger, systemMonitoringService);

  return {
    ledger,
    depositMonitorRepository,
    eventPublisher,
    systemMonitoringService,
    onchainService,
    depositMonitorService,
    depositMonitorWorker,
    monitoringWorker,
    depositService,
    walletService,
    withdrawService,
    schedulerService,
    operationsService
  };
};
