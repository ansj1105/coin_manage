import { describe, expect, it } from 'vitest';
import { createAppDependencies } from '../src/container/create-app-dependencies.js';
import { MockTronGateway } from '../src/infrastructure/blockchain/mock-tron-gateway.js';

describe('wallet timeline', () => {
  it('returns deposits, withdrawals, and internal transfers in reverse chronological order', async () => {
    const deps = createAppDependencies({
      tronGateway: new MockTronGateway()
    });

    await deps.walletService.bindWalletAddress({
      userId: 'user-1',
      walletAddress: 'TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
    });
    await deps.walletService.bindWalletAddress({
      userId: 'user-2',
      walletAddress: 'TCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'
    });

    await deps.depositService.processDeposit({
      userId: 'user-1',
      txHash: 'timeline-deposit-1',
      toAddress: 'TSM7ocJQHigW9jhk5yFQKrUmBAXz2FFapa',
      amountKori: 100,
      blockNumber: 1
    });

    await deps.walletService.transfer({
      fromUserId: 'user-1',
      toUserId: 'user-2',
      amountKori: 5,
      idempotencyKey: 'timeline-transfer-1'
    });

    await deps.withdrawService.request({
      userId: 'user-1',
      amountKori: 10,
      toAddress: 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      idempotencyKey: 'timeline-withdraw-1'
    });

    const timeline = await deps.walletService.getTimeline({
      userId: 'user-1'
    });

    expect(timeline).toHaveLength(3);
    expect(timeline.map((item) => item.entryType)).toEqual([
      'withdrawal',
      'internal_transfer_out',
      'deposit'
    ]);
    expect(timeline[0]).toMatchObject({
      status: 'LEDGER_RESERVED',
      displayStatus: 'submitted'
    });
    expect(timeline[1]).toMatchObject({
      status: 'confirmed',
      counterpartyUserId: 'user-2'
    });
    expect(timeline[2]).toMatchObject({
      status: 'CREDITED',
      txHash: 'timeline-deposit-1',
      blockNumber: 1
    });
  });
});
