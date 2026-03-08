import { parseKoriAmount } from '../core/money.js';
import { EventBus } from '../events/event-bus.js';
import { InMemoryLedger } from '../ledger/in-memory-ledger.js';

export class WalletService {
  constructor(
    private readonly ledger: InMemoryLedger,
    private readonly eventBus: EventBus
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
      this.eventBus.publish('wallet.transfered', {
        fromUserId: input.fromUserId,
        toUserId: input.toUserId,
        amountKori: input.amountKori,
        idempotencyKey: input.idempotencyKey
      });
    }

    return result;
  }
}
