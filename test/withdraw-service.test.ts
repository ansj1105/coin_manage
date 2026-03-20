import { beforeEach, describe, expect, it } from 'vitest';
import { createAppDependencies } from '../src/container/create-app-dependencies.js';
import { setRuntimeContractProfile } from '../src/config/runtime-settings.js';
import { isValidTronAddress } from '../src/domain/value-objects/tron-address.js';
import { MockTronGateway } from '../src/infrastructure/blockchain/mock-tron-gateway.js';
import { InMemoryFoxyaUserFlagRepository } from '../src/infrastructure/integration/foxya-user-flag-repository.js';
import { InMemoryWithdrawJobQueue } from '../src/infrastructure/queue/in-memory-withdraw-job-queue.js';

const VALID_TRON_ADDRESS = 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const TRACKED_DEPOSIT_ADDRESS = 'TSM7ocJQHigW9jhk5yFQKrUmBAXz2FFapa';

describe('withdraw flow (service-level)', () => {
  let deps: ReturnType<typeof createAppDependencies>;

  beforeEach(async () => {
    setRuntimeContractProfile('runtime');
    deps = createAppDependencies({
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
    expect(first.withdrawal.status).toBe('LEDGER_RESERVED');
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

  it('keeps completed withdrawals in daily limit accounting', async () => {
    for (let i = 0; i < 25; i += 1) {
      const request = await deps.withdrawService.request({
        userId: 'user-1',
        amountKori: 2000,
        toAddress: VALID_TRON_ADDRESS,
        idempotencyKey: `wd-daily-completed-${i}`,
        clientIp: '127.0.0.1',
        deviceId: `device-${i}`
      });

      await deps.withdrawService.confirmExternalAuth(request.withdrawal.withdrawalId, {
        provider: 'coin_cloud_system',
        requestId: `cloud-daily-completed-${i}`
      });
      await deps.withdrawService.approve(request.withdrawal.withdrawalId, {
        adminId: `admin-${i}`,
        note: 'complete for daily limit accounting'
      });
      await (deps.withdrawJobQueue as InMemoryWithdrawJobQueue).drain();

      const completed = await deps.withdrawService.get(request.withdrawal.withdrawalId);
      expect(completed?.status).toBe('COMPLETED');
    }

    await expect(
      deps.withdrawService.request({
        userId: 'user-1',
        amountKori: 1,
        toAddress: VALID_TRON_ADDRESS,
        idempotencyKey: 'wd-daily-completed-overflow'
      })
    ).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED'
    });
  });

  it('validates tron address format', () => {
    expect(isValidTronAddress(VALID_TRON_ADDRESS)).toBe(true);
    expect(isValidTronAddress('invalid-address')).toBe(false);
  });

  it('supports wallet-address based balance and transfer resolution', async () => {
    const account = await deps.walletService.getBalance({
      walletAddress: 'TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
    });

    expect(account.userId).toBe('user-1');
    expect(account.walletAddress).toBe('TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');

    const transfer = await deps.walletService.transfer({
      fromWalletAddress: 'TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      toWalletAddress: 'TCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
      amountKori: 123,
      idempotencyKey: 'wallet-address-transfer-1'
    });

    expect(transfer.duplicated).toBe(false);
    expect(transfer.fromTx.userId).toBe('user-1');
    expect(transfer.toTx.userId).toBe('user-2');
  });

  it('supports wallet-address based deposit attribution and withdrawal source resolution', async () => {
    const deposit = await deps.depositService.processDeposit({
      walletAddress: 'TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      txHash: `wallet-address-deposit-${Date.now()}`,
      toAddress: TRACKED_DEPOSIT_ADDRESS,
      amountKori: 10,
      blockNumber: 10
    });

    expect(deposit.accepted).toBe(true);
    expect(deposit.deposit?.userId).toBe('user-1');

    const withdrawal = await deps.withdrawService.request({
      walletAddress: 'TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      amountKori: 1,
      toAddress: VALID_TRON_ADDRESS,
      idempotencyKey: 'wallet-address-withdraw-1'
    });

    expect(withdrawal.duplicated).toBe(false);
    expect(withdrawal.withdrawal.userId).toBe('user-1');
  });

  it('requires external auth confirmation before admin approval flow begins', async () => {
    const request = await deps.withdrawService.request({
      userId: 'user-1',
      amountKori: 100,
      toAddress: VALID_TRON_ADDRESS,
      idempotencyKey: 'wd-external-auth-1'
    });

    expect(request.withdrawal.status).toBe('LEDGER_RESERVED');
    expect(await deps.withdrawService.listPendingApprovals()).toHaveLength(0);

    const confirmed = await deps.withdrawService.confirmExternalAuth(request.withdrawal.withdrawalId, {
      provider: 'coin_cloud_system',
      requestId: 'cloud-auth-1'
    });

    expect(confirmed.status).toBe('PENDING_ADMIN');
    expect(confirmed.externalAuthProvider).toBe('coin_cloud_system');
    expect(confirmed.externalAuthRequestId).toBe('cloud-auth-1');
    expect(await deps.withdrawService.listPendingApprovals()).toHaveLength(1);
  });

  it('rejects withdrawal requests to managed system wallets', async () => {
    await expect(
      deps.withdrawService.request({
        userId: 'user-1',
        amountKori: 1,
        toAddress: TRACKED_DEPOSIT_ADDRESS,
        idempotencyKey: 'wd-managed-destination-1'
      })
    ).rejects.toMatchObject({
      code: 'WITHDRAW_DESTINATION_RESTRICTED'
    });
  });

  it('rejects withdrawal requests to blocked policy addresses', async () => {
    await deps.withdrawService.upsertAddressPolicy({
      address: VALID_TRON_ADDRESS,
      policyType: 'blacklist',
      reason: 'fraud-review',
      createdBy: 'ops-admin-1'
    });

    await expect(
      deps.withdrawService.request({
        userId: 'user-1',
        amountKori: 1,
        toAddress: VALID_TRON_ADDRESS,
        idempotencyKey: 'wd-policy-blocked-1'
      })
    ).rejects.toMatchObject({
      code: 'WITHDRAW_DESTINATION_BLOCKED'
    });
  });

  it('blocks test users from requesting withdrawal on mainnet profile', async () => {
    const foxyaUserFlagRepository = new InMemoryFoxyaUserFlagRepository();
    foxyaUserFlagRepository.setTestUser('user-1', true);
    setRuntimeContractProfile('mainnet');

    const guardedDeps = createAppDependencies({
      tronGateway: new MockTronGateway(),
      foxyaUserFlagRepository
    });

    await guardedDeps.walletService.bindWalletAddress({
      userId: 'user-1',
      walletAddress: 'TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
    });
    await guardedDeps.depositService.processDeposit({
      userId: 'user-1',
      txHash: `test-user-deposit-${Date.now()}`,
      toAddress: TRACKED_DEPOSIT_ADDRESS,
      amountKori: 1000,
      blockNumber: 1
    });

    await expect(
      guardedDeps.withdrawService.request({
        userId: 'user-1',
        amountKori: 10,
        toAddress: VALID_TRON_ADDRESS,
        idempotencyKey: 'wd-test-user-mainnet-1'
      })
    ).rejects.toMatchObject({
      code: 'TEST_USER_MAINNET_WITHDRAW_FORBIDDEN'
    });
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

    await deps.ledger.confirmWithdrawalExternalAuth(
      requestResult.withdrawal.withdrawalId,
      { provider: 'coin_cloud_system', requestId: 'cloud-timeout-1' },
      oldTime
    );
    await deps.ledger.approveWithdrawal(requestResult.withdrawal.withdrawalId, {
      adminId: 'system-queue',
      actorType: 'system'
    }, oldTime);
    await deps.ledger.broadcastWithdrawal(requestResult.withdrawal.withdrawalId, 'pending-timeout-case', oldTime);

    const result = await deps.schedulerService.retryPending(60);
    expect(result.stuckCount).toBeGreaterThanOrEqual(1);
    expect(result.reconcile.pending).toContain(requestResult.withdrawal.withdrawalId);
  });
});
