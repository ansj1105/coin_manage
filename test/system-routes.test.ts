import { describe, expect, it, vi } from 'vitest';
import { createRequireWithdrawApiKey } from '../src/interfaces/http/middleware/withdraw-auth.js';
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
      listWithdrawalAddressPolicies: vi.fn().mockResolvedValue([]),
      upsertWithdrawalAddressPolicy: vi.fn().mockResolvedValue({
        address: 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        policyType: 'blacklist',
        reason: 'manual block',
        createdBy: 'system-ops',
        createdAt: '2026-03-19T00:00:00.000Z',
        updatedAt: '2026-03-19T00:00:00.000Z'
      }),
      deleteWithdrawalAddressPolicy: vi.fn().mockResolvedValue(true),
      listWithdrawalRiskEvents: vi.fn().mockResolvedValue({ items: [] }),
      recordWithdrawalRiskEvent: vi.fn().mockResolvedValue({
        eventId: 'risk-1',
        address: 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        signal: 'manual_blacklist',
        severity: 'high',
        reason: 'manual risk flag',
        createdAt: '2026-03-19T00:00:00.000Z',
        actorId: 'system-ops',
        blacklistPolicyType: 'blacklist'
      }),
      listWithdrawalExternalSyncFailures: vi.fn().mockResolvedValue({
        items: [],
        failedJobCount: 0
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
    } as any,
    {
      adminApiKey: 'admin-secret'
    }
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
    header: (name: string) => (name.toLowerCase() === 'x-admin-api-key' ? 'admin-secret' : undefined)
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
  it('blocks system ops without admin api key', () => {
    const middleware = createRequireWithdrawApiKey(
      'admin-secret',
      'WITHDRAW_ADMIN_UNAUTHORIZED',
      'withdraw admin api key is required'
    );
    const next = vi.fn();

    middleware(
      {
        header: () => undefined
      } as any,
      {} as any,
      next
    );

    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]?.[0]).toMatchObject({
      code: 'WITHDRAW_ADMIN_UNAUTHORIZED'
    });
  });

  it('lists external sync failures for ops tooling', async () => {
    const listWithdrawalExternalSyncFailures = vi.fn().mockResolvedValue({
      items: [
        {
          withdrawalId: '2f1ac758-2bce-47dd-8eaf-ffae13845657',
          createdAt: '2026-03-18T12:34:56.000Z',
          status: 'COMPLETED',
          error: 'timeout',
          occurredAt: '2026-03-18T12:34:55.000Z',
          txHash: 'tx-sync-1',
          failedJob: null
        }
      ],
      failedJobCount: 1
    });
    const router = buildRouter({ listWithdrawalExternalSyncFailures });
    const routeLayer = router.stack.find(
      (layer: any) =>
        layer.route?.path === '/withdraw-jobs/external-sync/failures' && layer.route.methods?.get
    );

    const req = {
      body: {},
      query: { limit: '25' },
      params: {},
      method: 'GET',
      originalUrl: '/withdraw-jobs/external-sync/failures',
      header: (name: string) => (name.toLowerCase() === 'x-admin-api-key' ? 'admin-secret' : undefined)
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

    expect(listWithdrawalExternalSyncFailures).toHaveBeenCalledWith(25);
    expect(jsonBody).toEqual({
      items: [
        {
          withdrawalId: '2f1ac758-2bce-47dd-8eaf-ffae13845657',
          createdAt: '2026-03-18T12:34:56.000Z',
          status: 'COMPLETED',
          error: 'timeout',
          occurredAt: '2026-03-18T12:34:55.000Z',
          txHash: 'tx-sync-1',
          failedJob: null
        }
      ],
      failedJobCount: 1
    });
  });

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
      header: (name: string) => (name.toLowerCase() === 'x-admin-api-key' ? 'admin-secret' : undefined)
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

  it('lists withdraw policies for ops tooling', async () => {
    const listWithdrawalAddressPolicies = vi.fn().mockResolvedValue([
      {
        address: 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        policyType: 'blacklist',
        reason: 'manual block',
        createdBy: 'ops-admin',
        createdAt: '2026-03-19T00:00:00.000Z',
        updatedAt: '2026-03-19T00:00:00.000Z'
      }
    ]);
    const router = buildRouter({ listWithdrawalAddressPolicies });
    const routeLayer = router.stack.find(
      (layer: any) =>
        layer.route?.path === '/withdraw-policies/addresses' && layer.route.methods?.get
    );

    const req = {
      body: {},
      query: { policyType: 'blacklist', limit: '10' },
      params: {},
      method: 'GET',
      originalUrl: '/withdraw-policies/addresses',
      header: (name: string) => (name.toLowerCase() === 'x-admin-api-key' ? 'admin-secret' : undefined)
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

    expect(listWithdrawalAddressPolicies).toHaveBeenCalledWith({ policyType: 'blacklist', limit: 10 });
    expect(jsonBody).toEqual({
      policies: [
        {
          address: 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          policyType: 'blacklist',
          reason: 'manual block',
          createdBy: 'ops-admin',
          createdAt: '2026-03-19T00:00:00.000Z',
          updatedAt: '2026-03-19T00:00:00.000Z'
        }
      ]
    });
  });

  it('records risk events and optional blacklist policy from system routes', async () => {
    const recordWithdrawalRiskEvent = vi.fn().mockResolvedValue({
      eventId: 'risk-1',
      address: 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      signal: 'manual_blacklist',
      severity: 'high',
      reason: 'manual risk flag',
      createdAt: '2026-03-19T00:00:00.000Z',
      actorId: 'ops-admin',
      blacklistPolicyType: 'blacklist'
    });
    const router = buildRouter({ recordWithdrawalRiskEvent });
    const routeLayer = router.stack.find(
      (layer: any) =>
        layer.route?.path === '/withdraw-risk-events' && layer.route.methods?.post
    );

    const req = {
      body: {
        address: 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        signal: 'manual_blacklist',
        severity: 'high',
        reason: 'manual risk flag',
        blacklistPolicyType: 'blacklist'
      },
      query: {},
      params: {},
      method: 'POST',
      originalUrl: '/withdraw-risk-events',
      header: (name: string) => {
        const normalized = name.toLowerCase();
        if (normalized === 'x-admin-id') {
          return 'ops-admin';
        }
        if (normalized === 'x-admin-api-key') {
          return 'admin-secret';
        }
        return undefined;
      }
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

    await Promise.resolve(routeLayer.route.stack[0].handle(req, res, () => undefined));

    expect(statusCode).toBe(201);
    expect(recordWithdrawalRiskEvent).toHaveBeenCalledWith({
      address: 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      signal: 'manual_blacklist',
      severity: 'high',
      reason: 'manual risk flag',
      blacklistPolicyType: 'blacklist',
      actorId: 'ops-admin'
    });
    expect(jsonBody).toEqual({
      event: {
        eventId: 'risk-1',
        address: 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        signal: 'manual_blacklist',
        severity: 'high',
        reason: 'manual risk flag',
        createdAt: '2026-03-19T00:00:00.000Z',
        actorId: 'ops-admin',
        blacklistPolicyType: 'blacklist'
      }
    });
  });
});
