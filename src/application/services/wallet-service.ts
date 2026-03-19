import { parseKoriAmount } from '../../domain/value-objects/money.js';
import { DomainError } from '../../domain/errors/domain-error.js';
import { mapWithdrawalDisplayStatus, type WithdrawalDisplayStatus } from '../../domain/ledger/withdraw-display-status.js';
import type { EventPublisher } from '../ports/event-publisher.js';
import type { LedgerRepository } from '../ports/ledger-repository.js';

export type WalletTimelineEntryType = 'deposit' | 'withdrawal' | 'internal_transfer_in' | 'internal_transfer_out';

export type WalletTimelineEntry = {
  timelineId: string;
  entryType: WalletTimelineEntryType;
  amount: bigint;
  status: string;
  createdAt: string;
  txHash?: string;
  blockNumber?: number;
  counterpartyUserId?: string;
  toAddress?: string;
  depositId?: string;
  withdrawalId?: string;
  ledgerTxId?: string;
  displayStatus?: WithdrawalDisplayStatus;
};

export class WalletService {
  constructor(
    private readonly ledger: LedgerRepository,
    private readonly eventPublisher: EventPublisher
  ) {}

  async getBalance(input: { userId?: string; walletAddress?: string }) {
    if (input.walletAddress) {
      return this.ledger.getAccountByWalletAddress(input.walletAddress);
    }

    if (input.userId) {
      return this.ledger.getAccount(input.userId);
    }

    throw new DomainError(400, 'VALIDATION_ERROR', 'userId or walletAddress is required');
  }

  async bindWalletAddress(input: { userId: string; walletAddress: string }) {
    return this.ledger.bindWalletAddress(input);
  }

  async getWalletBinding(input: { userId?: string; walletAddress?: string }) {
    return this.ledger.getWalletBinding(input);
  }

  async getTimeline(input: { userId?: string; walletAddress?: string; limit?: number }): Promise<WalletTimelineEntry[]> {
    const userId = await this.ledger.resolveUserId({
      userId: input.userId,
      walletAddress: input.walletAddress
    });
    const limit = input.limit ?? 50;
    const fetchLimit = Math.min(limit * 2, 200);
    const [deposits, withdrawals, internalTransfers] = await Promise.all([
      this.ledger.listDepositsByUser(userId, fetchLimit),
      this.ledger.listWithdrawalsByUser(userId, fetchLimit),
      this.ledger.listTransactionsByUser(userId, {
        types: ['internal_transfer_in', 'internal_transfer_out'],
        limit: fetchLimit
      })
    ]);

    return [
      ...deposits.map(
        (deposit) =>
          ({
            timelineId: `deposit:${deposit.depositId}`,
            entryType: 'deposit',
            amount: deposit.amount,
            status: deposit.status,
            createdAt: deposit.createdAt,
            txHash: deposit.txHash,
            blockNumber: deposit.blockNumber,
            depositId: deposit.depositId
          }) satisfies WalletTimelineEntry
      ),
      ...withdrawals.map(
        (withdrawal) =>
          ({
            timelineId: `withdrawal:${withdrawal.withdrawalId}`,
            entryType: 'withdrawal',
            amount: withdrawal.amount,
            status: withdrawal.status,
            createdAt: withdrawal.createdAt,
            txHash: withdrawal.txHash,
            toAddress: withdrawal.toAddress,
            withdrawalId: withdrawal.withdrawalId,
            ledgerTxId: withdrawal.ledgerTxId,
            displayStatus: mapWithdrawalDisplayStatus(withdrawal)
          }) satisfies WalletTimelineEntry
      ),
      ...internalTransfers.map((transaction) => {
        const entryType =
          transaction.type === 'internal_transfer_in' ? 'internal_transfer_in' : 'internal_transfer_out';
        return {
          timelineId: `transaction:${transaction.txId}`,
          entryType,
          amount: transaction.amount,
          status: transaction.status,
          createdAt: transaction.createdAt,
          txHash: transaction.blockTx,
          counterpartyUserId: transaction.relatedUserId,
          ledgerTxId: transaction.txId
        } satisfies WalletTimelineEntry;
      })
    ]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  async transfer(input: {
    fromUserId?: string;
    fromWalletAddress?: string;
    toUserId?: string;
    toWalletAddress?: string;
    amountKori: number;
    idempotencyKey: string;
  }) {
    const fromUserId = await this.ledger.resolveUserId({
      userId: input.fromUserId,
      walletAddress: input.fromWalletAddress
    });
    const toUserId = await this.ledger.resolveUserId({
      userId: input.toUserId,
      walletAddress: input.toWalletAddress
    });

    const result = await this.ledger.transfer({
      fromUserId,
      toUserId,
      amount: parseKoriAmount(input.amountKori),
      idempotencyKey: input.idempotencyKey
    });

    if (!result.duplicated) {
      this.eventPublisher.publish('wallet.transfered', {
        fromUserId,
        fromWalletAddress: input.fromWalletAddress,
        toUserId,
        toWalletAddress: input.toWalletAddress,
        amountKori: input.amountKori,
        idempotencyKey: input.idempotencyKey
      });
    }

    return result;
  }
}
