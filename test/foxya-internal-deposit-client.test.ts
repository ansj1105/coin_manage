import { afterEach, describe, expect, it, vi } from 'vitest';
import { FoxyaInternalDepositClient } from '../src/infrastructure/integration/foxya-internal-deposit-client.js';

describe('FoxyaInternalDepositClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('unwraps Java ApiResponse data payloads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [{ userId: '77', currencyId: 101, address: 'TYteNy9PWTg9U68dnjwNnosQC9FP1Hgs1Z', network: 'TRON' }]
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      )
    );

    const client = new FoxyaInternalDepositClient('http://foxya-api:8080/api/v1/internal/deposits', 'internal-key');
    const addresses = await client.listWatchAddresses();

    expect(addresses).toEqual([
      { userId: '77', currencyId: 101, address: 'TYteNy9PWTg9U68dnjwNnosQC9FP1Hgs1Z', network: 'TRON' }
    ]);
  });

  it('casts userId to number when registering deposits for the Java internal API', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: { depositId: 'dep-1', status: 'PENDING' }
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new FoxyaInternalDepositClient('http://foxya-api:8080/api/v1/internal/deposits', 'internal-key');
    await client.registerDeposit({
      depositId: 'dep-1',
      userId: '1',
      currencyId: 3,
      amount: '13.000000',
      network: 'TRON',
      senderAddress: 'TTTkHYt8Jmw4k51TkWWrgV5PePWeA9Ekuv',
      toAddress: 'TYteNy9PWTg9U68dnjwNnosQC9FP1Hgs1Z',
      logIndex: 0,
      blockNumber: 80900485,
      txHash: 'e2c308c8e4b2d25d1d67652f59c50600916659f1cf35f5c07d6ca418f5228e61'
    });

    const [, options] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(options?.body))).toMatchObject({
      depositId: 'dep-1',
      userId: 1,
      currencyId: 3
    });
  });

  it('retries once when the internal API fetch fails before succeeding', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ userId: '77', currencyId: 101, address: 'TYteNy9PWTg9U68dnjwNnosQC9FP1Hgs1Z', network: 'TRON' }]
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = new FoxyaInternalDepositClient('http://foxya-api:8080/api/v1/internal/deposits', 'internal-key');
    const addresses = await client.listWatchAddresses();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(addresses).toEqual([
      { userId: '77', currencyId: 101, address: 'TYteNy9PWTg9U68dnjwNnosQC9FP1Hgs1Z', network: 'TRON' }
    ]);
  });
});
