import { parseKoriAmount } from '../core/money.js';
import { EventBus } from '../events/event-bus.js';
import { InMemoryLedger } from '../ledger/in-memory-ledger.js';

export class DepositService {
  constructor(
    private readonly ledger: InMemoryLedger,
    private readonly eventBus: EventBus
  ) {}

  async processDeposit(input: {
    userId: string;
    amountKori: number;
    txHash: string;
    blockNumber: number;
  }) {
    const result = await this.ledger.applyDeposit({
      userId: input.userId,
      amount: parseKoriAmount(input.amountKori),
      txHash: input.txHash,
      blockNumber: input.blockNumber
    });

    if (!result.duplicated) {
      this.eventBus.publish('deposit.detected', {
        depositId: result.deposit.depositId,
        userId: result.deposit.userId,
        txHash: result.deposit.txHash
      });
    }

    return result;
  }
}
