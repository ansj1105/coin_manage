import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/interfaces/http/middleware/error-handler.js';
import { createInternalSignerRoutes } from '../src/interfaces/http/routes/internal-signer-routes.js';

describe('internal signer routes', () => {
  it('broadcasts through the injected signer and returns signer metadata', async () => {
    const withdrawalSigner = {
      broadcastWithdrawal: vi.fn().mockResolvedValue({ txHash: 'tx-signer-1' })
    };
    const router = createInternalSignerRoutes(withdrawalSigner as any, {
      internalApiKey: 'signer-secret',
      signerBackend: 'local'
    });
    const routeLayer = router.stack.find(
      (layer: any) => layer.route?.path === '/withdrawals/:withdrawalId/broadcast' && layer.route.methods?.post
    );

    const req = {
      body: {
        schemaVersion: '2026-03-19.withdraw-signer.v1',
        toAddress: 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        amountSun: '150000000'
      },
      params: {
        withdrawalId: 'wd-1'
      },
      method: 'POST',
      originalUrl: '/withdrawals/wd-1/broadcast',
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
    expect(withdrawalSigner.broadcastWithdrawal).toHaveBeenCalledWith({
      withdrawalId: 'wd-1',
      toAddress: 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      amount: 150_000_000n
    });
    expect(jsonBody).toMatchObject({
      schemaVersion: '2026-03-19.withdraw-signer.v1',
      withdrawalId: 'wd-1',
      txHash: 'tx-signer-1',
      signerBackend: 'local'
    });
  });
});
