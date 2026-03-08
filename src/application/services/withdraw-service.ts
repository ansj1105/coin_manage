import { parseKoriAmount } from '../../domain/value-objects/money.js';
import type { EventPublisher } from '../ports/event-publisher.js';
import type { LedgerRepository } from '../ports/ledger-repository.js';
import type { TronGateway } from '../ports/tron-gateway.js';

export class WithdrawService {
  constructor(
    private readonly ledger: LedgerRepository,
    private readonly eventPublisher: EventPublisher,
    private readonly tronGateway: TronGateway
  ) {}

  async request(input: {
    userId?: string;
    walletAddress?: string;
    amountKori: number;
    toAddress: string;
    idempotencyKey: string;
  }) {
    const userId = await this.ledger.resolveUserId({
      userId: input.userId,
      walletAddress: input.walletAddress
    });
    const result = await this.ledger.requestWithdrawal({
      userId,
      amount: parseKoriAmount(input.amountKori),
      toAddress: input.toAddress,
      idempotencyKey: input.idempotencyKey
    });

    if (!result.duplicated) {
      this.eventPublisher.publish('withdraw.requested', {
        withdrawalId: result.withdrawal.withdrawalId,
        userId,
        walletAddress: input.walletAddress,
        amountKori: input.amountKori
      });
    }

    return result;
  }

  async approve(withdrawalId: string) {
    const withdrawal = await this.ledger.approveWithdrawal(withdrawalId);
    this.eventPublisher.publish('withdraw.approved', {
      withdrawalId,
      userId: withdrawal.userId
    });
    return withdrawal;
  }

  async broadcast(withdrawalId: string) {
    const current = await this.ledger.getWithdrawal(withdrawalId);
    if (!current) {
      return undefined;
    }

    const { txHash } = await this.tronGateway.broadcastTransfer({
      toAddress: current.toAddress,
      amount: current.amount
    });

    const updated = await this.ledger.broadcastWithdrawal(withdrawalId, txHash);
    this.eventPublisher.publish('withdraw.broadcast', {
      withdrawalId,
      txHash
    });
    return updated;
  }

  async confirm(withdrawalId: string) {
    const updated = await this.ledger.confirmWithdrawal(withdrawalId);
    this.eventPublisher.publish('withdraw.confirmed', {
      withdrawalId,
      txHash: updated.txHash
    });
    return updated;
  }

  async fail(withdrawalId: string, reason: string) {
    const updated = await this.ledger.failWithdrawal(withdrawalId, reason);
    this.eventPublisher.publish('withdraw.failed', {
      withdrawalId,
      reason
    });
    return updated;
  }

  async get(withdrawalId: string) {
    return this.ledger.getWithdrawal(withdrawalId);
  }

  async reconcileBroadcasted(): Promise<{ confirmed: string[]; failed: string[]; pending: string[] }> {
    const broadcasted = await this.ledger.listWithdrawalsByStatuses(['broadcasted']);

    const confirmed: string[] = [];
    const failed: string[] = [];
    const pending: string[] = [];

    for (const withdrawal of broadcasted) {
      if (!withdrawal.txHash) {
        continue;
      }

      const receipt = await this.tronGateway.getTransactionReceipt(withdrawal.txHash);
      if (receipt === 'confirmed') {
        await this.confirm(withdrawal.withdrawalId);
        confirmed.push(withdrawal.withdrawalId);
        continue;
      }
      if (receipt === 'failed') {
        await this.fail(withdrawal.withdrawalId, 'on-chain receipt reported failure');
        failed.push(withdrawal.withdrawalId);
        continue;
      }
      pending.push(withdrawal.withdrawalId);
    }

    return { confirmed, failed, pending };
  }
}
