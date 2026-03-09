import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('sweep bot service', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    Object.assign(process.env, originalEnv, {
      NODE_ENV: 'test',
      SWEEP_BOT_ENABLED: 'true',
      HOT_WALLET_ADDRESS: 'TYKL8DPoR99bccujHXxcyBewCV1NimdRc8',
      HOT_WALLET_PRIVATE_KEY: 'test-hot-wallet-private-key'
    });
  });

  afterEach(() => {
    Object.keys(process.env).forEach((key) => {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    });
    Object.assign(process.env, originalEnv);
  });

  it('broadcasts and then confirms foxya deposit sweeps across cycles', async () => {
    const { InMemoryDepositMonitorRepository } = await import(
      '../src/infrastructure/persistence/in-memory-deposit-monitor-repository.js'
    );
    const { InMemoryLedgerRepository } = await import('../src/infrastructure/persistence/in-memory-ledger-repository.js');
    const { AlertService } = await import('../src/application/services/alert-service.js');
    const { SweepBotService } = await import('../src/application/services/sweep-bot-service.js');

    const depositMonitorRepository = new InMemoryDepositMonitorRepository();
    await depositMonitorRepository.recordDiscoveredEvent({
      eventKey: 'mainnet:3:deposit-1:0',
      depositId: 'deposit-1',
      userId: 'user-1',
      currencyId: 3,
      network: 'TRON',
      fromAddress: 'T1111111111111111111111111111111111',
      toAddress: 'TWbuSkkRid1st9gSMy1NhpK1KwJMebHNwh',
      txHash: 'deposit-tx-1',
      eventIndex: 0,
      blockNumber: 100,
      blockTimestampMs: Date.now(),
      amountRaw: '1500000',
      amountDecimal: '1.500000',
      status: 'completed',
      foxyaRegisteredAt: new Date().toISOString(),
      foxyaCompletedAt: new Date().toISOString()
    });

    const foxyaClient = {
      listWatchAddresses: vi.fn(),
      registerDeposit: vi.fn(),
      completeDeposit: vi.fn(),
      getDeposit: vi.fn(async () => ({
        depositId: 'deposit-1',
        status: 'COMPLETED'
      })),
      submitSweep: vi.fn(async (_depositId: string, txHash: string) => ({
        depositId: 'deposit-1',
        status: 'COMPLETED',
        sweepStatus: 'SUBMITTED',
        sweepTxHash: txHash
      })),
      failSweep: vi.fn()
    };
    const foxyaWalletRepository = {
      getWalletSignerByAddress: vi.fn(async () => ({
        userId: 'user-1',
        currencyId: 3,
        address: 'TWbuSkkRid1st9gSMy1NhpK1KwJMebHNwh',
        privateKey: 'test-deposit-wallet-private-key'
      }))
    };
    const tronGateway = {
      broadcastTransfer: vi.fn(async () => ({ txHash: 'mock-sweep-tx-1' })),
      getTransactionReceipt: vi.fn(async () => 'confirmed' as const)
    };
    const ledger = new InMemoryLedgerRepository({
      singleLimit: 1_000_000n,
      dailyLimit: 10_000_000n
    });

    const service = new SweepBotService(
      depositMonitorRepository,
      foxyaClient as any,
      foxyaWalletRepository as any,
      ledger,
      tronGateway as any,
      new AlertService(),
      true
    );

    const firstRun = await service.runCycle();
    expect((firstRun as any).broadcasted).toBe(1);
    expect(foxyaClient.submitSweep).toHaveBeenCalledOnce();

    const secondRun = await service.runCycle();
    expect((secondRun as any).confirmed).toBe(1);

    const stored = await ledger.findSweepByExternalRef('foxya-deposit:deposit-1');
    expect(stored?.status).toBe('confirmed');
    expect(stored?.txHash).toBe('mock-sweep-tx-1');
  });
});
