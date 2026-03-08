import express from 'express';
import { env } from './config/env.js';
import { parseKoriAmount } from './domain/value-objects/money.js';
import { DepositService } from './application/services/deposit-service.js';
import { SchedulerService } from './application/services/scheduler-service.js';
import { WalletService } from './application/services/wallet-service.js';
import { WithdrawService } from './application/services/withdraw-service.js';
import { MockTronGateway } from './infrastructure/blockchain/mock-tron-gateway.js';
import { InMemoryEventPublisher } from './infrastructure/events/in-memory-event-publisher.js';
import { InMemoryLedgerRepository } from './infrastructure/persistence/in-memory-ledger-repository.js';
import { errorHandler, notFoundHandler } from './interfaces/http/middleware/error-handler.js';
import { createDepositRoutes } from './interfaces/http/routes/deposit-routes.js';
import { createSchedulerRoutes } from './interfaces/http/routes/scheduler-routes.js';
import { createWalletRoutes } from './interfaces/http/routes/wallet-routes.js';
import { createWithdrawRoutes } from './interfaces/http/routes/withdraw-routes.js';

export interface AppDependencies {
  ledger: InMemoryLedgerRepository;
  eventPublisher: InMemoryEventPublisher;
  depositService: DepositService;
  walletService: WalletService;
  withdrawService: WithdrawService;
  schedulerService: SchedulerService;
}

export const buildDependencies = (): AppDependencies => {
  const eventPublisher = new InMemoryEventPublisher();
  const ledger = new InMemoryLedgerRepository({
    singleLimit: parseKoriAmount(env.withdrawSingleLimitKori),
    dailyLimit: parseKoriAmount(env.withdrawDailyLimitKori)
  });
  const tronGateway = new MockTronGateway();
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

export const createApp = (deps: AppDependencies): express.Express => {
  const app = express();

  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'korion-kori-backend',
      timestamp: new Date().toISOString()
    });
  });

  app.use('/api/deposits', createDepositRoutes(deps.depositService));
  app.use('/api/wallets', createWalletRoutes(deps.walletService));
  app.use('/api/withdrawals', createWithdrawRoutes(deps.withdrawService));
  app.use('/api/scheduler', createSchedulerRoutes(deps.schedulerService));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
