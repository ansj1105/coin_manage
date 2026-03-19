import express from 'express';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import type { AppDependencies } from './container/app-dependencies.js';
import { errorHandler, notFoundHandler } from './interfaces/http/middleware/error-handler.js';
import { createDepositRoutes } from './interfaces/http/routes/deposit-routes.js';
import { createOnchainRoutes } from './interfaces/http/routes/onchain-routes.js';
import { createSchedulerRoutes } from './interfaces/http/routes/scheduler-routes.js';
import { createSystemRoutes } from './interfaces/http/routes/system-routes.js';
import { createInternalWithdrawRoutes } from './interfaces/http/routes/internal-withdraw-routes.js';
import { createInternalSignerRoutes } from './interfaces/http/routes/internal-signer-routes.js';
import { createWalletRoutes } from './interfaces/http/routes/wallet-routes.js';
import { createWithdrawRoutes } from './interfaces/http/routes/withdraw-routes.js';
import { createVirtualWalletRoutes } from './interfaces/http/routes/virtual-wallet-routes.js';

export const createApp = (deps: AppDependencies): express.Express => {
  const app = express();
  const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public');

  app.use(express.json());
  app.use('/sandbox', express.static(resolve(publicDir, 'sandbox')));

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'korion-kori-backend',
      ledgerProvider: env.ledgerProvider,
      tronGatewayMode: env.tronGatewayMode,
      timestamp: new Date().toISOString()
    });
  });

  app.get('/', (_req, res) => {
    res.redirect('/sandbox/');
  });

  app.use(
    '/api/system',
    createSystemRoutes(
      deps.systemMonitoringService,
      deps.operationsService,
      deps.depositMonitorService,
      deps.sweepBotService,
      deps.alertService,
      deps.externalAlertMonitorService,
      deps.withdrawGuardService,
      {
        adminApiKey: env.withdrawAdminApiKey
      }
    )
  );
  app.use('/api/onchain', createOnchainRoutes(deps.onchainService));
  app.use('/api/deposits', createDepositRoutes(deps.depositService));
  app.use('/api/virtual-wallets', createVirtualWalletRoutes(deps.virtualWalletService));
  app.use('/api/wallets', createWalletRoutes(deps.walletService, deps.accountReconciliationService));
  app.use('/api/withdrawals', createWithdrawRoutes(deps.withdrawService));
  app.use(
    '/api/internal/withdrawals',
    createInternalWithdrawRoutes(deps.withdrawService, {
      internalApiKey: env.foxyaInternalWithdrawalApiKey
    })
  );
  app.use(
    '/api/internal/signer',
    createInternalSignerRoutes(deps.withdrawalSigner, {
      internalApiKey: env.withdrawSignerApiKey,
      signerBackend: env.withdrawSignerBackend
    })
  );
  app.use('/api/scheduler', createSchedulerRoutes(deps.schedulerService));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
