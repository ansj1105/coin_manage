import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/interfaces/http/middleware/error-handler.js';
import { createSystemRoutes } from '../src/interfaces/http/routes/system-routes.js';

const buildRouter = (operationsServiceOverrides: Record<string, unknown> = {}) =>
  createSystemRoutes(
    {
      getStoredWallets: vi.fn().mockResolvedValue([]),
      getCollectorRuns: vi.fn().mockResolvedValue([])
    } as any,
    {
      retryExternalSyncWithdrawals: vi.fn().mockResolvedValue({
        queuedCount: 1,
        withdrawalIds: ['2f1ac758-2bce-47dd-8eaf-ffae13845657']
      }),
      ...operationsServiceOverrides
    } as any,
    {
      getStatus: vi.fn().mockResolvedValue({})
    } as any,
    {
      getStatus: vi.fn().mockReturnValue({})
    } as any,
    {
      enabled: false
    } as any,
    {
      getStatus: vi.fn().mockResolvedValue({})
    } as any,
    {
      getHotWalletReadiness: vi.fn().mockResolvedValue(null)
    } as any
  ) as any;

const invokeRetryRoute = async (body: unknown) => {
  const router = buildRouter();
  const routeLayer = router.stack.find(
    (layer: any) =>
      layer.route?.path === '/withdraw-jobs/external-sync/retry' && layer.route.methods?.post
  );
  if (!routeLayer) {
    throw new Error('route not found');
  }

  const req = {
    body,
    query: {},
    params: {},
    method: 'POST',
    originalUrl: '/withdraw-jobs/external-sync/retry',
    header: () => undefined
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

  return { statusCode, jsonBody };
};

describe('system routes', () => {
  it('rejects invalid external sync retry payloads', async () => {
    const response = await invokeRetryRoute({
      withdrawalIds: ['not-a-uuid']
    });

    expect(response.statusCode).toBe(400);
    expect(response.jsonBody).toMatchObject({
      error: {
        code: 'INVALID_REQUEST'
      }
    });
  });

  it('queues manual external sync retries', async () => {
    const retryExternalSyncWithdrawals = vi.fn().mockResolvedValue({
      queuedCount: 1,
      withdrawalIds: ['2f1ac758-2bce-47dd-8eaf-ffae13845657']
    });
    const router = buildRouter({ retryExternalSyncWithdrawals });
    const routeLayer = router.stack.find(
      (layer: any) =>
        layer.route?.path === '/withdraw-jobs/external-sync/retry' && layer.route.methods?.post
    );

    const req = {
      body: {
        withdrawalIds: ['2f1ac758-2bce-47dd-8eaf-ffae13845657']
      },
      query: {},
      params: {},
      method: 'POST',
      originalUrl: '/withdraw-jobs/external-sync/retry',
      header: () => undefined
    } as any;
    let jsonBody: unknown;
    const res = {
      status() {
        return this;
      },
      json(payload: unknown) {
        jsonBody = payload;
        return this;
      }
    } as any;

    await Promise.resolve(routeLayer.route.stack[0].handle(req, res, () => undefined));

    expect(retryExternalSyncWithdrawals).toHaveBeenCalledWith([
      '2f1ac758-2bce-47dd-8eaf-ffae13845657'
    ]);
    expect(jsonBody).toEqual({
      result: {
        queuedCount: 1,
        withdrawalIds: ['2f1ac758-2bce-47dd-8eaf-ffae13845657']
      }
    });
  });
});
