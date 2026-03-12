import { describe, expect, it } from 'vitest';
import {
  buildDepositStateChangedContract,
  buildJournalEntryContract,
  buildWithdrawalStateChangedContract,
  verifyLedgerContractSignature
} from '../src/contracts/ledger-contracts.js';

describe('ledger contracts', () => {
  it('builds deposit state changed contract', () => {
    const payload = buildDepositStateChangedContract({
      depositId: 'dep-1',
      userId: 'user-1',
      walletAddress: 'TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      txHash: 'mock-deposit-tx-1',
      toAddress: 'TSM7ocJQHigW9jhk5yFQKrUmBAXz2FFapa',
      status: 'CREDITED',
      amount: 1_000_000n,
      blockNumber: 123,
      occurredAt: '2026-03-12T12:00:00.000Z'
    });

    expect(payload.eventType).toBe('deposit.state.changed');
    expect(payload.status).toBe('CREDITED');
    expect(payload.amount).toBe('1.000000');
    expect(payload.issuer).toBeTruthy();
    expect(verifyLedgerContractSignature(payload)).toBe(true);
  });

  it('builds journal entry contract', () => {
    const payload = buildJournalEntryContract({
      journalType: 'withdraw_reserved',
      referenceType: 'withdrawal',
      referenceId: 'wd-1',
      occurredAt: '2026-03-12T12:00:00.000Z',
      postings: [
        {
          accountCode: 'user:user-1:available',
          accountType: 'liability',
          side: 'debit',
          amount: '1.000000'
        },
        {
          accountCode: 'user:user-1:withdraw_pending',
          accountType: 'liability',
          side: 'credit',
          amount: '1.000000'
        }
      ]
    });

    expect(payload.postings).toHaveLength(2);
    expect(verifyLedgerContractSignature(payload)).toBe(true);
  });

  it('maps withdrawal states to shared contract status', () => {
    const payload = buildWithdrawalStateChangedContract(
      {
        withdrawalId: 'wd-1',
        userId: 'user-1',
        amount: 1_000_000n,
        toAddress: 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        status: 'LEDGER_RESERVED',
        idempotencyKey: 'key-1',
        ledgerTxId: 'ledger-1',
        createdAt: '2026-03-12T12:00:00.000Z',
        riskLevel: 'low',
        riskScore: 0,
        riskFlags: [],
        requiredApprovals: 2,
        approvalCount: 0
      },
      '2026-03-12T12:00:00.000Z'
    );

    expect(payload.status).toBe('LEDGER_RESERVED');
    expect(payload.requiredApprovals).toBe(2);
    expect(verifyLedgerContractSignature(payload)).toBe(true);
  });
});
