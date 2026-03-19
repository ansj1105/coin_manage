import { describe, expect, it, vi } from 'vitest';
import { AlertService } from '../src/application/services/alert-service.js';
import { WithdrawService } from '../src/application/services/withdraw-service.js';
import type { Withdrawal } from '../src/ledger/types.js';

const baseWithdrawal: Withdrawal = {
  withdrawalId: 'wd-1',
  userId: 'user-1',
  amount: 50_000_000n,
  toAddress: 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  status: 'ADMIN_APPROVED',
  idempotencyKey: 'idem-1',
  ledgerTxId: 'ledger-1',
  createdAt: '2026-03-19T00:00:00.000Z',
  riskLevel: 'low',
  riskScore: 10,
  riskFlags: [],
  requiredApprovals: 1,
  approvalCount: 1
};

describe('withdraw service offline signing', () => {
  it('uses the injected withdrawal signer during broadcast', async () => {
    const ledger = {
      getWithdrawal: vi.fn().mockResolvedValue(baseWithdrawal),
      broadcastWithdrawal: vi.fn().mockResolvedValue({
        ...baseWithdrawal,
        status: 'TX_BROADCASTED',
        txHash: 'tx-hash-1'
      }),
      appendAuditLog: vi.fn()
    };
    const withdrawalSigner = {
      broadcastWithdrawal: vi.fn().mockResolvedValue({ txHash: 'tx-hash-1' })
    };
    const service = new WithdrawService(
      ledger as any,
      { publish: vi.fn() } as any,
      {} as any,
      new AlertService(),
      {} as any,
      undefined,
      {
        assertBroadcastAllowed: vi.fn().mockResolvedValue(undefined)
      } as any,
      undefined,
      undefined,
      withdrawalSigner as any
    );

    const result = await service.broadcast('wd-1');

    expect(withdrawalSigner.broadcastWithdrawal).toHaveBeenCalledWith({
      withdrawalId: 'wd-1',
      toAddress: 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      amount: 50_000_000n
    });
    expect(result?.txHash).toBe('tx-hash-1');
  });
});
