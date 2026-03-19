import { describe, expect, it } from 'vitest';
import { mapWithdrawalToSyncStatus } from '../src/domain/ledger/withdraw-sync-status.js';

const baseWithdrawal = {
  withdrawalId: 'wd-1',
  userId: 'user-1',
  amount: 1_000_000n,
  toAddress: 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  idempotencyKey: 'idem-1',
  ledgerTxId: 'ledger-1',
  createdAt: '2026-03-19T00:00:00.000Z',
  riskLevel: 'low',
  riskScore: 10,
  riskFlags: [],
  requiredApprovals: 1,
  approvalCount: 0
} as const;

describe('withdraw sync status', () => {
  it('maps internal withdrawal states to foxya polling states', () => {
    expect(mapWithdrawalToSyncStatus({ ...baseWithdrawal, status: 'LEDGER_RESERVED' })).toBe('PROCESSING');
    expect(mapWithdrawalToSyncStatus({ ...baseWithdrawal, status: 'PENDING_ADMIN' })).toBe('PROCESSING');
    expect(mapWithdrawalToSyncStatus({ ...baseWithdrawal, status: 'ADMIN_APPROVED' })).toBe('PROCESSING');
    expect(mapWithdrawalToSyncStatus({ ...baseWithdrawal, status: 'TX_BROADCASTED' })).toBe('SENT');
    expect(mapWithdrawalToSyncStatus({ ...baseWithdrawal, status: 'COMPLETED' })).toBe('COMPLETED');
    expect(mapWithdrawalToSyncStatus({ ...baseWithdrawal, status: 'FAILED' })).toBe('FAILED');
    expect(mapWithdrawalToSyncStatus({ ...baseWithdrawal, status: 'REJECTED', failReason: 'policy denied' })).toBe(
      'FAILED'
    );
  });
});
