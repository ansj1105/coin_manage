import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCurrentBlockMock = vi.fn();
const getEventResultMock = vi.fn();
const fromHexMock = vi.fn((value: string) => value);

vi.mock('tronweb', () => ({
  TronWeb: class MockTronWeb {
    static address = {
      fromHex: fromHexMock
    };

    trx = {
      getCurrentBlock: getCurrentBlockMock
    };

    constructor(_options: unknown) {}

    getEventResult = getEventResultMock;
  }
}));

describe('TronTrc20EventReader', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.TRON_API_KEY = 'bad-key';
    process.env.MAINNET_TRON_API_URL = 'https://api.trongrid.io';
  });

  it('retries read-only requests without api key when the configured key is unauthorized', async () => {
    getCurrentBlockMock
      .mockRejectedValueOnce({ response: { status: 401 } })
      .mockResolvedValueOnce({ block_header: { raw_data: { number: 321 } } });

    const { TronTrc20EventReader } = await import('../src/infrastructure/blockchain/tron-trc20-event-reader.js');
    const reader = new TronTrc20EventReader();

    await expect(reader.getCurrentBlockNumber('mainnet')).resolves.toBe(321);
    expect(getCurrentBlockMock).toHaveBeenCalledTimes(2);
  });

  it('normalizes 0x TRON addresses by adding the 41 prefix before conversion', async () => {
    getEventResultMock.mockResolvedValueOnce({
      data: [
        {
          transaction_id: 'tx-1',
          event_index: 0,
          block_number: 100,
          block_timestamp: 1_700_000_000_000,
          _unconfirmed: false,
          result: {
            from: '0x196a864120a1e6fc1d2b2b2abfa58b5b78883bf0',
            to: '0xfb6dff5c42923d7315622125f7a63350c065988f',
            value: '13000000'
          }
        }
      ]
    });

    const { TronTrc20EventReader } = await import('../src/infrastructure/blockchain/tron-trc20-event-reader.js');
    const reader = new TronTrc20EventReader();
    await reader.listTransfers({
      network: 'mainnet',
      contractAddress: 'TBJZD8RwQ1JcQvEP9BTbPbgBCGxUjxSXnn',
      minBlockTimestamp: 1_699_000_000_000,
      limit: 10
    });

    expect(fromHexMock).toHaveBeenCalledWith('41196a864120a1e6fc1d2b2b2abfa58b5b78883bf0');
    expect(fromHexMock).toHaveBeenCalledWith('41fb6dff5c42923d7315622125f7a63350c065988f');
  });
});
