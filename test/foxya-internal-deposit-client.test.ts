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
});
