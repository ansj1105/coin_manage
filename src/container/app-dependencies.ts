import type { EventPublisher } from '../application/ports/event-publisher.js';
import { BlockchainMonitorService } from '../application/services/blockchain-monitor-service.js';
import type { LedgerRepository } from '../application/ports/ledger-repository.js';
import { DepositService } from '../application/services/deposit-service.js';
import { SchedulerService } from '../application/services/scheduler-service.js';
import { WalletService } from '../application/services/wallet-service.js';
import { WithdrawService } from '../application/services/withdraw-service.js';

export interface AppDependencies {
  ledger: LedgerRepository;
  eventPublisher: EventPublisher;
  blockchainMonitorService: BlockchainMonitorService;
  depositService: DepositService;
  walletService: WalletService;
  withdrawService: WithdrawService;
  schedulerService: SchedulerService;
}
