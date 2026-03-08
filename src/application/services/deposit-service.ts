import { parseKoriAmount } from '../../domain/value-objects/money.js';
import type { DepositApplyResult } from '../../domain/ledger/types.js';
import type { EventPublisher } from '../ports/event-publisher.js';
import type { LedgerRepository } from '../ports/ledger-repository.js';

export interface DepositProcessResult {
  accepted: boolean;
  duplicated: boolean;
  deposit?: DepositApplyResult['deposit'];
  reason?: 'UNTRACKED_ADDRESS';
}

export class DepositService {
  private readonly trackedAddresses: Set<string>;

  constructor(
    private readonly ledger: LedgerRepository,
    private readonly eventPublisher: EventPublisher,
    trackedWalletAddresses: string[]
  ) {
    this.trackedAddresses = new Set(trackedWalletAddresses.map((item) => item.trim()).filter(Boolean));
  }

  async processDeposit(input: {
    userId: string;
    amountKori: number;
    txHash: string;
    toAddress: string;
    blockNumber: number;
  }): Promise<DepositProcessResult> {
    const normalizedToAddress = input.toAddress.trim();
    if (!this.trackedAddresses.has(normalizedToAddress)) {
      return {
        accepted: false,
        duplicated: false,
        reason: 'UNTRACKED_ADDRESS'
      };
    }

    const result = await this.ledger.applyDeposit({
      userId: input.userId,
      amount: parseKoriAmount(input.amountKori),
      txHash: input.txHash,
      blockNumber: input.blockNumber
    });

    if (!result.duplicated) {
      this.eventPublisher.publish('deposit.detected', {
        depositId: result.deposit.depositId,
        userId: result.deposit.userId,
        txHash: result.deposit.txHash,
        toAddress: normalizedToAddress
      });
    }

    return {
      accepted: true,
      duplicated: result.duplicated,
      deposit: result.deposit
    };
  }
}
