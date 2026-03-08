import { parseKoriAmount } from '../../domain/value-objects/money.js';
import { DomainError } from '../../domain/errors/domain-error.js';
import type { EventPublisher } from '../ports/event-publisher.js';
import type { LedgerRepository } from '../ports/ledger-repository.js';

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
