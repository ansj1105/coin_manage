import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('sweep bot service', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    Object.assign(process.env, originalEnv, {
      NODE_ENV: 'test',
      SWEEP_BOT_ENABLED: 'true',
      HOT_WALLET_ADDRESS: 'TWb6JbQCATPepWeziLhyegXoKLBmmAqdEx',
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
      toAddress: 'TXnrtSwBizyb4R3AqZpVN5DkiFxFJk7U9i',
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
    const tronGateway = {
      getTransactionReceipt: vi.fn(async () => 'confirmed' as const),
      getTransactionReceiptDetails: vi.fn(async () => ({
        status: 'confirmed' as const,
        feeSun: 1000n,
        energyUsed: 0,
        bandwidthUsed: 0
      })),
      getAccountResources: vi.fn(async () => ({
        trxBalanceSun: 100_000_000n,
        energyLimit: 100_000,
        energyUsed: 0,
        bandwidthLimit: 10_000,
        bandwidthUsed: 0
      }))
    };
    const ledger = new InMemoryLedgerRepository({
      singleLimit: 1_000_000n,
      dailyLimit: 10_000_000n
    });

    const service = new SweepBotService(
      depositMonitorRepository,
      foxyaClient as any,
      {
        broadcastActivationReclaim: vi.fn(),
        broadcastFoxyaSweep: vi.fn(async () => ({ txHash: 'mock-sweep-tx-1' }))
      } as any,
      ledger,
      tronGateway as any,
      new AlertService(),
      true
    );

    const firstRun = await service.runCycle();
    expect((firstRun as any).planned).toBe(1);
    expect((firstRun as any).queued).toBe(1);
    expect((firstRun as any).broadcasted).toBe(1);
    expect((firstRun as any).confirmed).toBe(1);
    expect(foxyaClient.submitSweep).toHaveBeenCalledOnce();

    const secondRun = await service.runCycle();
    expect((secondRun as any).confirmed).toBe(0);

    const stored = await ledger.findSweepByExternalRef('foxya-deposit:deposit-1');
    expect(stored?.status).toBe('confirmed');
    expect(stored?.txHash).toBe('mock-sweep-tx-1');
  });

  it('keeps sweep queued when source wallet lacks trx or energy', async () => {
    const { InMemoryDepositMonitorRepository } = await import(
      '../src/infrastructure/persistence/in-memory-deposit-monitor-repository.js'
    );
    const { InMemoryLedgerRepository } = await import('../src/infrastructure/persistence/in-memory-ledger-repository.js');
    const { AlertService } = await import('../src/application/services/alert-service.js');
    const { SweepBotService } = await import('../src/application/services/sweep-bot-service.js');

    const depositMonitorRepository = new InMemoryDepositMonitorRepository();
    await depositMonitorRepository.recordDiscoveredEvent({
      eventKey: 'mainnet:3:deposit-2:0',
      depositId: 'deposit-2',
      userId: 'user-2',
      currencyId: 3,
      network: 'TRON',
      fromAddress: 'T1111111111111111111111111111111112',
      toAddress: 'TXnrtSwBizyb4R3AqZpVN5DkiFxFJk7U9j',
      txHash: 'deposit-tx-2',
      eventIndex: 0,
      blockNumber: 101,
      blockTimestampMs: Date.now(),
      amountRaw: '1500000',
      amountDecimal: '1.500000',
      status: 'completed',
      foxyaRegisteredAt: new Date().toISOString(),
      foxyaCompletedAt: new Date().toISOString()
    });

    const foxyaClient = {
      getDeposit: vi.fn(async () => ({
        depositId: 'deposit-2',
        status: 'COMPLETED'
      })),
      submitSweep: vi.fn(),
      failSweep: vi.fn(),
      listWatchAddresses: vi.fn(),
      registerDeposit: vi.fn(),
      completeDeposit: vi.fn()
    };
    const tronGateway = {
      getTransactionReceipt: vi.fn(async () => 'pending' as const),
      getTransactionReceiptDetails: vi.fn(async () => ({
        status: 'pending' as const,
        feeSun: 0n,
        energyUsed: 0,
        bandwidthUsed: 0
      })),
      getAccountResources: vi.fn(async () => ({
        trxBalanceSun: 1_000_000n,
        energyLimit: 1000,
        energyUsed: 500,
        bandwidthLimit: 1000,
        bandwidthUsed: 0
      }))
    };
    const ledger = new InMemoryLedgerRepository({
      singleLimit: 1_000_000n,
      dailyLimit: 10_000_000n
    });

    const service = new SweepBotService(
      depositMonitorRepository,
      foxyaClient as any,
      {
        broadcastActivationReclaim: vi.fn(),
        broadcastFoxyaSweep: vi.fn(async () => ({ txHash: 'should-not-broadcast' }))
      } as any,
      ledger,
      tronGateway as any,
      new AlertService(),
      true
    );

    const run = await service.runCycle();
    expect((run as any).planned).toBe(1);
    expect((run as any).queued).toBe(1);
    expect((run as any).broadcasted).toBe(0);
    expect(foxyaClient.submitSweep).not.toHaveBeenCalled();

    const stored = await ledger.findSweepByExternalRef('foxya-deposit:deposit-2');
    expect(stored?.status).toBe('queued');
  });
});
