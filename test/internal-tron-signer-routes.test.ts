import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/interfaces/http/middleware/error-handler.js';
import { createInternalTronSignerRoutes } from '../src/interfaces/http/routes/internal-tron-signer-routes.js';

describe('internal tron signer routes', () => {
  it('delegates hot-wallet transfer broadcast to the injected tron gateway', async () => {
    const tronGateway = {
      broadcastTransfer: vi.fn().mockResolvedValue({ txHash: 'tx-hot-1' })
    };
    const router = createInternalTronSignerRoutes(tronGateway as any, {
      internalApiKey: 'signer-secret',
      signerBackend: 'local'
    });
    const routeLayer = router.stack.find(
      (layer: any) => layer.route?.path === '/tron/broadcast-transfer' && layer.route.methods?.post
    );

    const req = {
      body: {
        schemaVersion: '2026-03-19.tron-signer.v1',
        toAddress: 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        amountSun: '150000000',
        network: 'mainnet'
      },
      method: 'POST',
      originalUrl: '/tron/broadcast-transfer',
      header: (name: string) => (name.toLowerCase() === 'x-internal-api-key' ? 'signer-secret' : undefined)
    } as any;

    let statusCode = 200;
    let jsonBody: unknown;
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: unknown) {
        jsonBody = payload;
        return this;
      }
    } as any;

    for (const layer of routeLayer.route.stack) {
      let forwardedError: unknown;
      let nextCalled = false;
      await Promise.resolve(
        layer.handle(req, res, (error?: unknown) => {
          nextCalled = true;
          forwardedError = error;
        })
      );

      if (forwardedError) {
        errorHandler(forwardedError, req, res, (() => undefined) as any);
        break;
      }

      if (!nextCalled) {
        break;
      }
    }

    expect(statusCode).toBe(200);
    expect(tronGateway.broadcastTransfer).toHaveBeenCalledWith({
      toAddress: 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      amount: 150_000_000n,
      network: 'mainnet',
      apiUrl: undefined,
      contractAddress: undefined,
      fromAddress: undefined
    });
    expect(jsonBody).toMatchObject({
      schemaVersion: '2026-03-19.tron-signer.v1',
      txHash: 'tx-hot-1',
      signerBackend: 'local'
    });
  });
});
