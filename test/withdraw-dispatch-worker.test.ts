import { beforeEach, describe, expect, it } from 'vitest';
import { createAppDependencies } from '../src/container/create-app-dependencies.js';
import { MockTronGateway } from '../src/infrastructure/blockchain/mock-tron-gateway.js';
import { InMemoryWithdrawJobQueue } from '../src/infrastructure/queue/in-memory-withdraw-job-queue.js';

const VALID_TRON_ADDRESS = 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const TRACKED_DEPOSIT_ADDRESS = 'TSM7ocJQHigW9jhk5yFQKrUmBAXz2FFapa';

class LowResourceTronGateway extends MockTronGateway {
  override async getAccountResources() {
    return {
      trxBalanceSun: 1_000_000n,
      energyLimit: 100,
      energyUsed: 0,
      bandwidthLimit: 100,
      bandwidthUsed: 0
    };
  }
}

describe('withdraw dispatch worker', () => {
  let deps: ReturnType<typeof createAppDependencies>;

  beforeEach(async () => {
    process.env.WITHDRAW_SIGNER_MODE = 'hot';
    process.env.COLD_WITHDRAW_MIN_KORI = '100000';
    deps = createAppDependencies({
      tronGateway: new MockTronGateway()
    });

    await deps.walletService.bindWalletAddress({
      userId: 'user-1',
      walletAddress: 'TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
    });

    await deps.depositService.processDeposit({
      userId: 'user-1',
      txHash: `seed-${Date.now()}`,
      toAddress: TRACKED_DEPOSIT_ADDRESS,
      amountKori: 60000,
      blockNumber: 1
    });
  });

  it('broadcasts approved withdrawals and reconciles them to completion', async () => {
    const request = await deps.withdrawService.request({
      userId: 'user-1',
      amountKori: 150,
      toAddress: VALID_TRON_ADDRESS,
      idempotencyKey: 'dispatch-worker-1',
      clientIp: '127.0.0.1',
      deviceId: 'device-1'
    });

    await deps.withdrawService.confirmExternalAuth(request.withdrawal.withdrawalId, {
      provider: 'coin_cloud_system',
      requestId: 'dispatch-worker-auth-1'
    });
    await deps.withdrawService.approve(request.withdrawal.withdrawalId, {
      adminId: 'admin-1',
      note: 'manual approval'
    });

    await (deps.withdrawJobQueue as InMemoryWithdrawJobQueue).drain();

    const completed = await deps.withdrawService.get(request.withdrawal.withdrawalId);
    expect(completed?.status).toBe('COMPLETED');
    expect(completed?.txHash).toBeTruthy();
  });

  it('retries dispatch jobs when hot wallet resources are below threshold', async () => {
    const lowResourceDeps = createAppDependencies({
      tronGateway: new LowResourceTronGateway()
    });

    await lowResourceDeps.walletService.bindWalletAddress({
      userId: 'user-1',
      walletAddress: 'TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
    });

    await lowResourceDeps.depositService.processDeposit({
      userId: 'user-1',
      txHash: `low-resource-${Date.now()}`,
      toAddress: TRACKED_DEPOSIT_ADDRESS,
      amountKori: 60000,
      blockNumber: 1
    });

    const request = await lowResourceDeps.ledger.requestWithdrawal({
      userId: 'user-1',
      amount: 150_000_000n,
      toAddress: VALID_TRON_ADDRESS,
      idempotencyKey: 'dispatch-worker-2'
    });

    await lowResourceDeps.ledger.confirmWithdrawalExternalAuth(request.withdrawal.withdrawalId, {
      provider: 'coin_cloud_system',
      requestId: 'dispatch-worker-auth-2'
    });
    await lowResourceDeps.ledger.approveWithdrawal(request.withdrawal.withdrawalId, {
      adminId: 'admin-1',
      actorType: 'admin',
      note: 'manual approval'
    });
    await (lowResourceDeps.withdrawJobQueue as InMemoryWithdrawJobQueue).enqueueDispatch(request.withdrawal.withdrawalId);

    await expect((lowResourceDeps.withdrawJobQueue as InMemoryWithdrawJobQueue).drain()).rejects.toThrow(
      'hot wallet is not ready:'
    );

    const stored = await lowResourceDeps.withdrawService.get(request.withdrawal.withdrawalId);
    expect(stored?.status).toBe('ADMIN_APPROVED');
    const failedJobs = await lowResourceDeps.withdrawJobQueue.listFailed(10);
    expect(failedJobs).toHaveLength(1);
    expect(failedJobs[0]?.name).toBe('dispatch');
    expect(failedJobs[0]?.withdrawalId).toBe(request.withdrawal.withdrawalId);
  });

  it('leaves approved withdrawals waiting when offline signing mode is enabled', async () => {
    const offlineDeps = createAppDependencies({
      tronGateway: new MockTronGateway()
    });

    await offlineDeps.walletService.bindWalletAddress({
      userId: 'user-1',
      walletAddress: 'TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
    });

    await offlineDeps.depositService.processDeposit({
      userId: 'user-1',
      txHash: `offline-mode-${Date.now()}`,
      toAddress: TRACKED_DEPOSIT_ADDRESS,
      amountKori: 60000,
      blockNumber: 1
    });

    const request = await offlineDeps.withdrawService.request({
      userId: 'user-1',
      amountKori: 150,
      toAddress: VALID_TRON_ADDRESS,
      idempotencyKey: 'dispatch-worker-offline-1',
      clientIp: '127.0.0.1',
      deviceId: 'device-1'
    });

    await offlineDeps.withdrawService.confirmExternalAuth(request.withdrawal.withdrawalId, {
      provider: 'coin_cloud_system',
      requestId: 'dispatch-worker-auth-offline-1'
    });
    await offlineDeps.withdrawService.approve(request.withdrawal.withdrawalId, {
      adminId: 'admin-1',
      note: 'manual approval'
    });

    offlineDeps.withdrawGuardService.getHotWalletReadiness = async () => ({
      ready: false,
      signerMode: 'offline_stub',
      hotSigningEnabled: false,
      signerHealthy: false,
      signerAddress: TRACKED_DEPOSIT_ADDRESS,
      coldWithdrawMinKori: '100000.000000',
      trxBalanceSun: '0',
      availableBandwidth: 0,
      availableEnergy: 0,
      minTrxSun: '5000000',
      minBandwidth: 500,
      minEnergy: 10000,
      failures: ['offline_signing_required']
    });

    await expect((offlineDeps.withdrawJobQueue as InMemoryWithdrawJobQueue).drain()).rejects.toThrow(
      'withdrawal requires offline signing'
    );

    const stored = await offlineDeps.withdrawService.get(request.withdrawal.withdrawalId);
    expect(stored?.status).toBe('ADMIN_APPROVED');
    expect(stored?.txHash).toBeUndefined();
  });
});
