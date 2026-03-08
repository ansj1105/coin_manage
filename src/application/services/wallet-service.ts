import { parseKoriAmount } from '../../domain/value-objects/money.js';
import type { EventPublisher } from '../ports/event-publisher.js';
import type { LedgerRepository } from '../ports/ledger-repository.js';

export class WalletService {
  constructor(
    private readonly ledger: LedgerRepository,
    private readonly eventPublisher: EventPublisher
  ) {}

  async getBalance(userId: string) {
    return this.ledger.getAccount(userId);
  }

  async transfer(input: {
    fromUserId: string;
    toUserId: string;
    amountKori: number;
    idempotencyKey: string;
  }) {
    const result = await this.ledger.transfer({
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      amount: parseKoriAmount(input.amountKori),
      idempotencyKey: input.idempotencyKey
    });

    if (!result.duplicated) {
      this.eventPublisher.publish('wallet.transfered', {
        fromUserId: input.fromUserId,
        toUserId: input.toUserId,
        amountKori: input.amountKori,
        idempotencyKey: input.idempotencyKey
      });
    }

    return result;
  }
}
