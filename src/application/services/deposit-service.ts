import { parseKoriAmount } from '../../domain/value-objects/money.js';
import { buildDepositStateChangedContract } from '../../contracts/ledger-contracts.js';
import { DomainError } from '../../domain/errors/domain-error.js';
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
    userId?: string;
    walletAddress?: string;
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

    const userId = await this.ledger.resolveUserId({
      userId: input.userId,
      walletAddress: input.walletAddress
    });
    if (!userId) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'userId or walletAddress is required');
    }

    const result = await this.ledger.applyDeposit({
      userId,
      amount: parseKoriAmount(input.amountKori),
      txHash: input.txHash,
      blockNumber: input.blockNumber
    });

    if (!result.duplicated) {
      this.eventPublisher.publish(
        'deposit.state.changed',
        buildDepositStateChangedContract({
          depositId: result.deposit.depositId,
          userId: result.deposit.userId,
          walletAddress: input.walletAddress ?? normalizedToAddress,
          txHash: result.deposit.txHash,
          toAddress: normalizedToAddress,
          status: result.deposit.status,
          amount: result.deposit.amount,
          blockNumber: result.deposit.blockNumber,
          occurredAt: result.deposit.createdAt
        })
      );
    }

    return {
      accepted: true,
      duplicated: result.duplicated,
      deposit: result.deposit
    };
  }
}
