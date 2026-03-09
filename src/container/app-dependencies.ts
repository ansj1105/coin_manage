import type { EventPublisher } from '../application/ports/event-publisher.js';
import type { DepositMonitorRepository } from '../application/ports/deposit-monitor-repository.js';
import { DepositMonitorService } from '../application/services/deposit-monitor-service.js';
import { DepositMonitorWorker } from '../application/services/deposit-monitor-worker.js';
import { AlertService } from '../application/services/alert-service.js';
import { AlertWorker } from '../application/services/alert-worker.js';
import { MonitoringWorker } from '../application/services/monitoring-worker.js';
import type { LedgerRepository } from '../application/ports/ledger-repository.js';
import { SystemMonitoringService } from '../application/services/system-monitoring-service.js';
import { DepositService } from '../application/services/deposit-service.js';
import { OnchainService } from '../application/services/onchain-service.js';
import { SchedulerService } from '../application/services/scheduler-service.js';
import { OperationsService } from '../application/services/operations-service.js';
import { SweepBotService } from '../application/services/sweep-bot-service.js';
import { SweepBotWorker } from '../application/services/sweep-bot-worker.js';
import { WalletService } from '../application/services/wallet-service.js';
import { WithdrawService } from '../application/services/withdraw-service.js';

export interface AppDependencies {
  ledger: LedgerRepository;
  depositMonitorRepository: DepositMonitorRepository;
  eventPublisher: EventPublisher;
  alertService: AlertService;
  systemMonitoringService: SystemMonitoringService;
  onchainService: OnchainService;
  depositMonitorService: DepositMonitorService;
  depositMonitorWorker: DepositMonitorWorker;
  sweepBotService: SweepBotService;
  sweepBotWorker: SweepBotWorker;
  monitoringWorker: MonitoringWorker;
  alertWorker: AlertWorker;
  depositService: DepositService;
  walletService: WalletService;
  withdrawService: WithdrawService;
  schedulerService: SchedulerService;
  operationsService: OperationsService;
}
