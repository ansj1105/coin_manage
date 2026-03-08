import { parseKoriAmount } from '../core/money.js';
import { EventBus } from '../events/event-bus.js';
import { InMemoryLedger } from '../ledger/in-memory-ledger.js';
import type { TronClient } from '../infra/tron-client.js';

export class WithdrawService {
  constructor(
    private readonly ledger: InMemoryLedger,
    private readonly eventBus: EventBus,
    private readonly tronClient: TronClient
  ) {}

  async request(input: {
    userId: string;
    amountKori: number;
    toAddress: string;
    idempotencyKey: string;
  }) {
    const result = await this.ledger.requestWithdrawal({
      userId: input.userId,
      amount: parseKoriAmount(input.amountKori),
      toAddress: input.toAddress,
      idempotencyKey: input.idempotencyKey
    });

    if (!result.duplicated) {
      this.eventBus.publish('withdraw.requested', {
        withdrawalId: result.withdrawal.withdrawalId,
        userId: result.withdrawal.userId,
        amountKori: input.amountKori
      });
    }

    return result;
  }

  async approve(withdrawalId: string) {
    const withdrawal = await this.ledger.approveWithdrawal(withdrawalId);
    this.eventBus.publish('withdraw.approved', {
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

    const { txHash } = await this.tronClient.broadcastTransfer({
      toAddress: current.toAddress,
      amount: current.amount
    });

    const updated = await this.ledger.broadcastWithdrawal(withdrawalId, txHash);
    this.eventBus.publish('withdraw.broadcast', {
      withdrawalId,
      txHash
    });
    return updated;
  }

  async confirm(withdrawalId: string) {
    const updated = await this.ledger.confirmWithdrawal(withdrawalId);
    this.eventBus.publish('withdraw.confirmed', {
      withdrawalId,
      txHash: updated.txHash
    });
    return updated;
  }

  async fail(withdrawalId: string, reason: string) {
    const updated = await this.ledger.failWithdrawal(withdrawalId, reason);
    this.eventBus.publish('withdraw.failed', {
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

      const receipt = await this.tronClient.getTransactionReceipt(withdrawal.txHash);
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
