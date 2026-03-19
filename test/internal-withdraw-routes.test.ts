import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/interfaces/http/middleware/error-handler.js';
import { createInternalWithdrawRoutes } from '../src/interfaces/http/routes/internal-withdraw-routes.js';

const invokeRoute = async (headers: Record<string, string>, getFoxyaPollingState: ReturnType<typeof vi.fn>) => {
  const router = createInternalWithdrawRoutes(
    {
      getFoxyaPollingState
    } as any,
    {
      internalApiKey: 'internal-secret'
    }
  ) as any;

  const routeLayer = router.stack.find(
    (layer: any) => layer.route?.path === '/coin-manage/:withdrawalId/state' && layer.route.methods?.get
  );

  const lowerHeaders = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  const req = {
    body: {},
    query: {},
    params: { withdrawalId: 'wd-1' },
    method: 'GET',
    originalUrl: '/coin-manage/wd-1/state',
    header: (name: string) => lowerHeaders[name.toLowerCase()]
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

  return {
    statusCode,
    jsonBody
  };
};

describe('internal withdraw routes', () => {
  it('returns foxya polling state with internal schema version', async () => {
    const response = await invokeRoute(
      {
        'x-internal-api-key': 'internal-secret'
      },
      vi.fn().mockResolvedValue({
        withdrawalId: 'wd-1',
        externalTransferId: null,
        status: 'SENT',
        txHash: 'tx-1-hash',
        failedReason: null,
        updatedAt: '2026-03-19T00:00:00.000Z'
      })
    );

    expect(response.statusCode).toBe(200);
    expect(response.jsonBody).toEqual({
      schemaVersion: '1.0.0',
      withdrawalId: 'wd-1',
      externalTransferId: null,
      status: 'SENT',
      txHash: 'tx-1-hash',
      failedReason: null,
      updatedAt: '2026-03-19T00:00:00.000Z'
    });
  });

  it('blocks requests without internal api key', async () => {
    const response = await invokeRoute({}, vi.fn());

    expect(response.statusCode).toBe(401);
    expect(response.jsonBody).toMatchObject({
      error: {
        code: 'WITHDRAW_INTERNAL_UNAUTHORIZED'
      }
    });
  });
});
