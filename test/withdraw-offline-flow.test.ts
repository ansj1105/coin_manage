import { describe, expect, it, vi } from 'vitest';
import { AlertService } from '../src/application/services/alert-service.js';
import { WithdrawService } from '../src/application/services/withdraw-service.js';
import type { Withdrawal } from '../src/ledger/types.js';

const baseApprovedWithdrawal: Withdrawal = {
  withdrawalId: 'wd-1',
  userId: 'user-1',
  amount: 150_000_000n,
  toAddress: 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  status: 'ADMIN_APPROVED',
  idempotencyKey: 'idem-1',
  ledgerTxId: 'ledger-1',
  createdAt: '2026-03-19T00:00:00.000Z',
  riskLevel: 'high',
  riskScore: 90,
  riskFlags: ['large_amount'],
  requiredApprovals: 2,
  approvalCount: 2
};

describe('withdraw offline flow', () => {
  it('lists only approved withdrawals that require offline signing', async () => {
    const service = new WithdrawService(
      {
        listWithdrawalsByStatuses: vi.fn().mockResolvedValue([
          baseApprovedWithdrawal,
          {
            ...baseApprovedWithdrawal,
            withdrawalId: 'wd-2',
            amount: 5_000_000n
          }
        ])
      } as any,
      { publish: vi.fn() } as any,
      {} as any,
      new AlertService(),
      {} as any,
      undefined,
      {
        requiresOfflineSigning: (amount?: bigint) => (amount ?? 0n) >= 100_000_000n
      } as any
    );

    const result = await service.listOfflineSigningPending();

    expect(result).toHaveLength(1);
    expect(result[0]?.withdrawalId).toBe('wd-1');
  });

  it('accepts offline broadcast submission and records tx hash', async () => {
    const ledger = {
      getWithdrawal: vi.fn().mockResolvedValue(baseApprovedWithdrawal),
      broadcastWithdrawal: vi.fn().mockResolvedValue({
        ...baseApprovedWithdrawal,
        status: 'TX_BROADCASTED',
        txHash: 'offline-broadcast-tx-1'
      }),
      appendAuditLog: vi.fn()
    };
    const service = new WithdrawService(
      ledger as any,
      { publish: vi.fn() } as any,
      {} as any,
      new AlertService(),
      {} as any,
      undefined,
      {
        requiresOfflineSigning: () => true
      } as any
    );

    const result = await service.submitOfflineBroadcast('wd-1', {
      txHash: 'offline-broadcast-tx-1',
      note: 'submitted from cold signer',
      actorId: 'ops-admin-1'
    });

    expect(result?.txHash).toBe('offline-broadcast-tx-1');
    expect(ledger.broadcastWithdrawal).toHaveBeenCalledWith('wd-1', 'offline-broadcast-tx-1');
    expect(ledger.appendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'withdraw.broadcast.offline_submitted',
        actorId: 'ops-admin-1'
      })
    );
  });
});
