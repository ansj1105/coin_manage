import { env } from '../config/env.js';
import { parseKoriAmount } from '../domain/value-objects/money.js';
import { DepositService } from '../application/services/deposit-service.js';
import { SchedulerService } from '../application/services/scheduler-service.js';
import { WalletService } from '../application/services/wallet-service.js';
import { WithdrawService } from '../application/services/withdraw-service.js';
import { MockTronGateway } from '../infrastructure/blockchain/mock-tron-gateway.js';
import { TronWebTrc20Gateway } from '../infrastructure/blockchain/tronweb-trc20-gateway.js';
import { InMemoryEventPublisher } from '../infrastructure/events/in-memory-event-publisher.js';
import { InMemoryLedgerRepository } from '../infrastructure/persistence/in-memory-ledger-repository.js';
import { PostgresLedgerRepository } from '../infrastructure/persistence/postgres/postgres-ledger-repository.js';
import { createPostgresDb, createPostgresPool } from '../infrastructure/persistence/postgres/postgres-pool.js';
import type { AppDependencies } from './app-dependencies.js';

const createLedgerRepository = () => {
  const limits = {
    singleLimit: parseKoriAmount(env.withdrawSingleLimitKori),
    dailyLimit: parseKoriAmount(env.withdrawDailyLimitKori)
  };

  if (env.ledgerProvider === 'postgres') {
    const pool = createPostgresPool();
    const db = createPostgresDb(pool);
    return new PostgresLedgerRepository(db, limits);
  }

  return new InMemoryLedgerRepository(limits);
};

const createTronGateway = () => {
  return env.tronGatewayMode === 'trc20' ? new TronWebTrc20Gateway() : new MockTronGateway();
};

export const createAppDependencies = (): AppDependencies => {
  const eventPublisher = new InMemoryEventPublisher();
  const ledger = createLedgerRepository();
  const tronGateway = createTronGateway();
  const trackedDepositWallets = [
    env.treasuryWalletAddress,
    ...env.depositWalletAddresses,
    env.hotWalletAddress
  ];

  const depositService = new DepositService(ledger, eventPublisher, trackedDepositWallets);
  const walletService = new WalletService(ledger, eventPublisher);
  const withdrawService = new WithdrawService(ledger, eventPublisher, tronGateway);
  const schedulerService = new SchedulerService(ledger, withdrawService, eventPublisher);

  return {
    ledger,
    eventPublisher,
    depositService,
    walletService,
    withdrawService,
    schedulerService
  };
};
