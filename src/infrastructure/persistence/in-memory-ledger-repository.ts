import { InMemoryLedger, type WithdrawalLimitConfig } from '../../ledger/in-memory-ledger.js';
import type { LedgerRepository } from '../../application/ports/ledger-repository.js';

export class InMemoryLedgerRepository extends InMemoryLedger implements LedgerRepository {
  constructor(limits: WithdrawalLimitConfig) {
    super(limits);
  }

  async lockOfflinePayCollateral(): Promise<import('../../ledger/types.js').OfflinePayLockResult> {
    throw new Error('offline pay lock is not implemented for in-memory ledger');
  }

  async releaseOfflinePayCollateral(): Promise<import('../../ledger/types.js').OfflinePayReleaseResult> {
    throw new Error('offline pay release is not implemented for in-memory ledger');
  }

  async finalizeOfflinePaySettlement(): Promise<import('../../ledger/types.js').OfflinePaySettlementFinalizeResult> {
    throw new Error('offline pay finalize is not implemented for in-memory ledger');
  }

  async compensateOfflinePaySettlement(): Promise<import('../../ledger/types.js').OfflinePaySettlementFinalizeResult> {
    throw new Error('offline pay compensation is not implemented for in-memory ledger');
  }
}
