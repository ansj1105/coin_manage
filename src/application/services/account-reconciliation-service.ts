import { DomainError } from '../../domain/errors/domain-error.js';
import { formatKoriAmount } from '../../domain/value-objects/money.js';
import type { LedgerRepository } from '../ports/ledger-repository.js';
import { DepositMonitorService } from './deposit-monitor-service.js';
import { WithdrawService } from './withdraw-service.js';

export class AccountReconciliationService {
  constructor(
    private readonly ledger: LedgerRepository,
    private readonly depositMonitorService: DepositMonitorService,
    private readonly withdrawService: WithdrawService
  ) {}

  async reconcile(input: {
    userId?: string;
    walletAddress?: string;
    txHashes?: string[];
    lookbackMs?: number;
  }) {
    const binding = await this.ledger.getWalletBinding({
      userId: input.userId,
      walletAddress: input.walletAddress
    });
    const walletAddress = input.walletAddress ?? binding?.walletAddress;

    if (!walletAddress) {
      throw new DomainError(404, 'WALLET_NOT_FOUND', 'wallet binding not found');
    }

    const [depositResult, withdrawalResult, account] = await Promise.all([
      this.depositMonitorService.reconcile({
        lookbackMs: input.lookbackMs,
        addresses: [walletAddress],
        txHashes: input.txHashes
      }),
      this.withdrawService.reconcileBroadcasted(),
      this.ledger.getAccountByWalletAddress(walletAddress)
    ]);

    return {
      userId: account.userId,
      walletAddress,
      balance: formatKoriAmount(account.balance),
      lockedBalance: formatKoriAmount(account.lockedBalance),
      updatedAt: account.updatedAt,
      depositMonitor: depositResult,
      withdrawals: withdrawalResult
    };
  }
}
