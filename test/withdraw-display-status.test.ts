import { describe, expect, it } from 'vitest';
import { mapWithdrawalDisplayStatus } from '../src/domain/ledger/withdraw-display-status.js';

describe('withdraw display status', () => {
  it('maps internal withdrawal states to user-facing display states', () => {
    expect(mapWithdrawalDisplayStatus({ status: 'LEDGER_RESERVED', approvalCount: 0 })).toBe('submitted');
    expect(mapWithdrawalDisplayStatus({ status: 'PENDING_ADMIN', approvalCount: 0 })).toBe('submitted');
    expect(mapWithdrawalDisplayStatus({ status: 'PENDING_ADMIN', approvalCount: 1 })).toBe('under_review');
    expect(mapWithdrawalDisplayStatus({ status: 'ADMIN_APPROVED', approvalCount: 2 })).toBe('approved');
    expect(mapWithdrawalDisplayStatus({ status: 'TX_BROADCASTED', approvalCount: 2 })).toBe('sending');
    expect(mapWithdrawalDisplayStatus({ status: 'COMPLETED', approvalCount: 2 })).toBe('completed');
    expect(mapWithdrawalDisplayStatus({ status: 'FAILED', approvalCount: 0 })).toBe('failed');
    expect(mapWithdrawalDisplayStatus({ status: 'REJECTED', approvalCount: 0 })).toBe('rejected');
  });
});
