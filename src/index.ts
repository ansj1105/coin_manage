import { createApp } from './app.js';
import { env } from './config/env.js';
import { createAppDependencies } from './container/create-app-dependencies.js';

const deps = createAppDependencies();
const app = createApp(deps);

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

if (env.alertMonitor.enabled) {
  deps.externalAlertMonitorWorker.start();
}

app.listen(env.port, () => {
  console.log(`korion-kori-backend listening on port ${env.port}`);
});
