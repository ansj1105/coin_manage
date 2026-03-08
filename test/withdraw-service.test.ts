import { beforeEach, describe, expect, it } from 'vitest';
import { buildDependencies } from '../src/app.js';
import { isValidTronAddress } from '../src/domain/value-objects/tron-address.js';

const VALID_TRON_ADDRESS = 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const TRACKED_DEPOSIT_ADDRESS = 'TSM7ocJQHigW9jhk5yFQKrUmBAXz2FFapa';

describe('withdraw flow (service-level)', () => {
  let deps: ReturnType<typeof buildDependencies>;

  beforeEach(async () => {
    deps = buildDependencies();
    await deps.depositService.processDeposit({
      userId: 'user-1',
      txHash: `mock-deposit-${Date.now()}`,
      toAddress: TRACKED_DEPOSIT_ADDRESS,
      amountKori: 60000,
      blockNumber: 1
    });
  });

  it('handles success and idempotent duplicate', async () => {
    const first = await deps.withdrawService.request({
      userId: 'user-1',
      amountKori: 5000,
      toAddress: VALID_TRON_ADDRESS,
      idempotencyKey: 'wd-success-1'
    });

    const second = await deps.withdrawService.request({
      userId: 'user-1',
      amountKori: 5000,
      toAddress: VALID_TRON_ADDRESS,
      idempotencyKey: 'wd-success-1'
    });

    expect(first.duplicated).toBe(false);
    expect(second.duplicated).toBe(true);
    expect(second.withdrawal.withdrawalId).toBe(first.withdrawal.withdrawalId);
  });

  it('rejects single and daily limit overflow', async () => {
    await expect(
      deps.withdrawService.request({
        userId: 'user-1',
        amountKori: 10000.000001,
        toAddress: VALID_TRON_ADDRESS,
        idempotencyKey: 'wd-single-over-1'
      })
    ).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED'
    });

    for (let i = 0; i < 5; i += 1) {
      const result = await deps.withdrawService.request({
        userId: 'user-1',
        amountKori: 10000,
        toAddress: VALID_TRON_ADDRESS,
        idempotencyKey: `wd-daily-${i}`
      });
      expect(result.duplicated).toBe(false);
    }

    await expect(
      deps.withdrawService.request({
        userId: 'user-1',
        amountKori: 1,
        toAddress: VALID_TRON_ADDRESS,
        idempotencyKey: 'wd-daily-overflow'
      })
    ).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED'
    });
  });

  it('validates tron address format', () => {
    expect(isValidTronAddress(VALID_TRON_ADDRESS)).toBe(true);
    expect(isValidTronAddress('invalid-address')).toBe(false);
  });

  it('reconciles pending broadcast in scheduler timeout path', async () => {
    const oldTime = new Date(Date.now() - 120_000).toISOString();
    const requestResult = await deps.ledger.requestWithdrawal({
      userId: 'user-1',
      amount: 1_000_000n,
      toAddress: VALID_TRON_ADDRESS,
      idempotencyKey: 'wd-timeout-path-1',
      nowIso: oldTime
    });

    await deps.ledger.approveWithdrawal(requestResult.withdrawal.withdrawalId, oldTime);
    await deps.ledger.broadcastWithdrawal(requestResult.withdrawal.withdrawalId, 'pending-timeout-case', oldTime);

    const result = await deps.schedulerService.retryPending(60);
    expect(result.stuckCount).toBeGreaterThanOrEqual(1);
    expect(result.reconcile.pending).toContain(requestResult.withdrawal.withdrawalId);
  });
});
