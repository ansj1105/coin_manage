import { describe, expect, it } from 'vitest';
import { PostgresLedgerRepository } from '../src/infrastructure/persistence/postgres/postgres-ledger-repository.js';

describe('postgres ledger repository', () => {
  it('uses the KORION PAY 0.1% included-fee policy for offline settlements', () => {
    const repository = new PostgresLedgerRepository({} as any, {
      singleLimit: 0n,
      dailyLimit: 0n
    });
    const calculateFee = (repository as any).calculateOfflinePaySettlementFee.bind(repository);

    expect(calculateFee('KORI', 10_000000n)).toBe(10_000n);
    expect(calculateFee('KORI', 150_000000n)).toBe(150_000n);
  });
});
