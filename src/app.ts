import express from 'express';
import { env } from './config/env.js';
import type { AppDependencies } from './container/app-dependencies.js';
import { errorHandler, notFoundHandler } from './interfaces/http/middleware/error-handler.js';
import { createDepositRoutes } from './interfaces/http/routes/deposit-routes.js';
import { createSchedulerRoutes } from './interfaces/http/routes/scheduler-routes.js';
import { createWalletRoutes } from './interfaces/http/routes/wallet-routes.js';
import { createWithdrawRoutes } from './interfaces/http/routes/withdraw-routes.js';

export const createApp = (deps: AppDependencies): express.Express => {
  const app = express();

  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'korion-kori-backend',
      ledgerProvider: env.ledgerProvider,
      tronGatewayMode: env.tronGatewayMode,
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
