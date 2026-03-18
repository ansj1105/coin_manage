import { afterEach, describe, expect, it, vi } from 'vitest';
import { FoxyaInternalWithdrawalClient } from '../src/infrastructure/integration/foxya-internal-withdrawal-client.js';
import { buildWithdrawalStateChangedContract } from '../src/contracts/ledger-contracts.js';
import type { Withdrawal } from '../src/ledger/types.js';

const baseWithdrawal: Withdrawal = {
  withdrawalId: 'wd-1',
  userId: 'user-1',
  amount: 10_000_000n,
  toAddress: 'TYteNy9PWTg9U68dnjwNnosQC9FP1Hgs1Z',
  status: 'TX_BROADCASTED',
  txHash: '3ff909facdb543d2446fe02de2a69cbb28443314fc702eee276328b19dc23e06',
  idempotencyKey: 'transfer-1',
  ledgerTxId: 'ledger-1',
  createdAt: '2026-03-18T00:00:00.000Z',
  riskLevel: 'low',
  riskScore: 0,
  riskFlags: [],
  requiredApprovals: 2,
  approvalCount: 2
};

describe('foxya internal withdrawal client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts withdrawal state to the coin-manage callback route', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new FoxyaInternalWithdrawalClient('http://foxya/api/v1/internal/withdrawals', 'internal-secret');
    const contract = buildWithdrawalStateChangedContract(baseWithdrawal, '2026-03-18T00:00:01.000Z');

    await client.syncWithdrawalState(contract);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://foxya/api/v1/internal/withdrawals/coin-manage/wd-1/state',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Internal-Api-Key': 'internal-secret'
        })
      })
    );
  });
});
