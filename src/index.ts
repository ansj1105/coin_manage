import { loadRuntimeSecretsFromAsm } from './bootstrap/runtime-secrets.js';

await loadRuntimeSecretsFromAsm();

const [{ createApp }, { env }, { createAppDependencies }] = await Promise.all([
  import('./app.js'),
  import('./config/env.js'),
  import('./container/create-app-dependencies.js')
]);

const deps = createAppDependencies();

if (env.withdrawQueueWorkerEnabled && env.withdrawDispatchEnabled) {
  deps.withdrawJobQueue.start();
  void deps.operationsService.seedWithdrawalQueueRecovery();
}

if (env.singletonWorkersEnabled) {
  if (env.walletMonitorEnabled) {
    deps.monitoringWorker.start();
  }

  if (env.depositMonitorEnabled) {
    deps.depositMonitorWorker.start();
  }

  if (env.activationGrantEnabled) {
    deps.activationGrantWorker.start();
  }

  if (env.activationReclaimEnabled) {
    deps.activationReclaimWorker.start();
  }

  if (env.resourceDelegationEnabled) {
    deps.resourceDelegationWorker.start();
  }

  if (env.sweepBotEnabled) {
    deps.sweepBotWorker.start();
  }

  if (deps.alertService.enabled) {
    deps.alertWorker.start();
  }

  deps.outboxPublisherWorker.start();

  if (env.alertMonitor.enabled) {
    deps.externalAlertMonitorWorker.start();
  }
}

if (!env.httpEnabled && !env.singletonWorkersEnabled && !env.withdrawQueueWorkerEnabled) {
  throw new Error('at least one runtime role must be enabled');
}

if (env.httpEnabled) {
  const app = createApp(deps);
  app.listen(env.port, () => {
    console.log(`korion-kori-backend listening on port ${env.port}`);
  });
} else {
  console.log('korion-kori-backend started in worker-only mode');
}
