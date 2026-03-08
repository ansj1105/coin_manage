import { InMemoryLedger, type WithdrawalLimitConfig } from '../../ledger/in-memory-ledger.js';
import type { LedgerRepository } from '../../application/ports/ledger-repository.js';

export class InMemoryLedgerRepository extends InMemoryLedger implements LedgerRepository {
  constructor(limits: WithdrawalLimitConfig) {
    super(limits);
  }
}
