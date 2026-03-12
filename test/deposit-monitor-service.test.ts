import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryDepositMonitorRepository } from '../src/infrastructure/persistence/in-memory-deposit-monitor-repository.js';

const ORIGINAL_ENV = { ...process.env };

describe('DepositMonitorService', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.DEPOSIT_MONITOR_ENABLED = 'true';
    process.env.DEPOSIT_MONITOR_NETWORK = 'mainnet';
    process.env.DEPOSIT_MONITOR_CONFIRMATIONS = '5';
    process.env.DEPOSIT_MONITOR_LOOKBACK_MS = '1000';
    process.env.DEPOSIT_MONITOR_PAGE_LIMIT = '200';
    process.env.DEPOSIT_MONITOR_CURRENCY_IDS = '101';
    process.env.KORI_TOKEN_CONTRACT_ADDRESS = 'TBJZD8RwQ1JcQvEP9BTbPbgBCGxUjxSXnn';
    process.env.FOXYA_INTERNAL_API_URL = 'http://foxya-coin-api:8080/api/v1/internal/deposits';
    process.env.FOXYA_INTERNAL_API_KEY = 'internal-key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL_ENV)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, ORIGINAL_ENV);
  });

  it('registers and completes matching TRON deposits through foxya integration', async () => {
    const { DepositMonitorService } = await import('../src/application/services/deposit-monitor-service.js');

    const repository = new InMemoryDepositMonitorRepository();
    const foxyaClient = {
      listWatchAddresses: vi.fn(async () => [
        { userId: '77', currencyId: 101, address: 'TSM7ocJQHigW9jhk5yFQKrUmBAXz2FFapa', network: 'TRON' },
        { userId: '77', currencyId: 202, address: 'TSM7ocJQHigW9jhk5yFQKrUmBAXz2FFapa', network: 'TRON' },
        { userId: '88', currencyId: 101, address: '0x-not-used', network: 'ETH' }
      ]),
      registerDeposit: vi.fn(async ({ depositId }) => ({ depositId, status: 'PENDING' })),
      completeDeposit: vi.fn(async (depositId: string) => ({ depositId, status: 'COMPLETED' })),
      getDeposit: vi.fn(async () => undefined)
    };
    const eventReader = {
      getCurrentBlockNumber: vi.fn(async () => 120),
      listTransfers: vi
        .fn()
        .mockResolvedValueOnce({
          events: [
            {
              txHash: 'tx-1',
              eventIndex: 0,
              blockNumber: 100,
              blockTimestampMs: 1_710_000_000_000,
              fromAddress: 'TXfrom',
              toAddress: 'TSM7ocJQHigW9jhk5yFQKrUmBAXz2FFapa',
              amountRaw: '1500000',
              confirmed: true
            }
          ]
        })
        .mockResolvedValueOnce({ events: [] })
    };
    const ledger = {
      applyDeposit: vi.fn(async () => ({
        deposit: {
          depositId: 'ledger-dep-1',
          userId: '77',
          txHash: 'tx-1',
          amount: 1_500_000n,
          status: 'CREDITED',
          blockNumber: 100,
          createdAt: new Date().toISOString()
        },
        duplicated: false
      })),
      completeDeposit: vi.fn(async () => ({
        depositId: 'ledger-dep-1',
        userId: '77',
        txHash: 'tx-1',
        amount: 1_500_000n,
        status: 'COMPLETED',
        blockNumber: 100,
        createdAt: new Date().toISOString()
      }))
    };

    const service = new DepositMonitorService(repository, foxyaClient as any, eventReader as any, ledger as any);
    const result = await service.runCycle();
    const status = await service.getStatus();

    expect('skipped' in result).toBe(false);
    if ('skipped' in result) {
      return;
    }
    expect(result.watchedAddresses).toBe(1);
    expect(result.registeredCount).toBe(1);
    expect(result.completedCount).toBe(1);
    expect(foxyaClient.registerDeposit).toHaveBeenCalledOnce();
    expect(foxyaClient.completeDeposit).toHaveBeenCalledOnce();
    expect(ledger.applyDeposit).toHaveBeenCalledOnce();
    expect(ledger.completeDeposit).toHaveBeenCalledOnce();
    expect(status.counts.completed).toBe(1);
    expect(status.recentEvents[0]?.amountDecimal).toBe('1.5');
  });

  it('does not re-register the same chain event on subsequent cycles', async () => {
    const { DepositMonitorService } = await import('../src/application/services/deposit-monitor-service.js');

    const repository = new InMemoryDepositMonitorRepository();
    const foxyaClient = {
      listWatchAddresses: vi.fn(async () => [
        { userId: '77', currencyId: 101, address: 'TSM7ocJQHigW9jhk5yFQKrUmBAXz2FFapa', network: 'TRON' }
      ]),
      registerDeposit: vi.fn(async ({ depositId }) => ({ depositId, status: 'PENDING' })),
      completeDeposit: vi.fn(async (depositId: string) => ({ depositId, status: 'COMPLETED' })),
      getDeposit: vi.fn(async () => undefined)
    };
    const eventReader = {
      getCurrentBlockNumber: vi.fn(async () => 120),
      listTransfers: vi
        .fn()
        .mockResolvedValueOnce({
          events: [
            {
              txHash: 'tx-repeat',
              eventIndex: 0,
              blockNumber: 100,
              blockTimestampMs: 1_710_000_000_000,
              fromAddress: 'TXfrom',
              toAddress: 'TSM7ocJQHigW9jhk5yFQKrUmBAXz2FFapa',
              amountRaw: '2000000',
              confirmed: true
            }
          ]
        })
        .mockResolvedValueOnce({ events: [] })
        .mockResolvedValueOnce({
          events: [
            {
              txHash: 'tx-repeat',
              eventIndex: 0,
              blockNumber: 100,
              blockTimestampMs: 1_710_000_000_000,
              fromAddress: 'TXfrom',
              toAddress: 'TSM7ocJQHigW9jhk5yFQKrUmBAXz2FFapa',
              amountRaw: '2000000',
              confirmed: true
            }
          ]
        })
        .mockResolvedValueOnce({ events: [] })
    };
    const ledger = {
      applyDeposit: vi.fn(async () => ({
        deposit: {
          depositId: 'ledger-dep-repeat',
          userId: '77',
          txHash: 'tx-repeat',
          amount: 2_000_000n,
          status: 'CREDITED',
          blockNumber: 100,
          createdAt: new Date().toISOString()
        },
        duplicated: false
      })),
      completeDeposit: vi.fn(async () => ({
        depositId: 'ledger-dep-repeat',
        userId: '77',
        txHash: 'tx-repeat',
        amount: 2_000_000n,
        status: 'COMPLETED',
        blockNumber: 100,
        createdAt: new Date().toISOString()
      }))
    };

    const service = new DepositMonitorService(repository, foxyaClient as any, eventReader as any, ledger as any);
    await service.runCycle();
    await service.runCycle();

    expect(foxyaClient.registerDeposit).toHaveBeenCalledTimes(1);
    expect(foxyaClient.completeDeposit).toHaveBeenCalledTimes(1);
    expect(ledger.applyDeposit).toHaveBeenCalledTimes(1);
    expect(ledger.completeDeposit).toHaveBeenCalledTimes(1);
  });
});
