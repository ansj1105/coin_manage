import { describe, expect, it, vi } from 'vitest';
import {
  createRequireWithdrawApiKey,
  readWithdrawActorId,
  readWithdrawAdminActorId
} from '../src/interfaces/http/middleware/withdraw-auth.js';
import { errorHandler } from '../src/interfaces/http/middleware/error-handler.js';
import { createWithdrawRoutes } from '../src/interfaces/http/routes/withdraw-routes.js';

const buildReq = (headers: Record<string, string> = {}) =>
  ({
    header: (name: string) => headers[name.toLowerCase()]
  }) as any;

const createTestRouter = () =>
  createWithdrawRoutes(
    {
      request: vi.fn(),
      listPendingApprovals: vi.fn(),
      reconcileBroadcasted: vi.fn(),
      approve: vi.fn(),
      confirmExternalAuth: vi.fn(),
      broadcast: vi.fn(),
      confirm: vi.fn(),
      listOfflineSigningPending: vi.fn().mockResolvedValue([]),
      submitOfflineBroadcast: vi.fn(),
      listAddressPolicies: vi.fn().mockResolvedValue([]),
      upsertAddressPolicy: vi.fn(),
      deleteAddressPolicy: vi.fn(),
      listApprovals: vi.fn(),
      get: vi.fn()
    } as any,
    {
      requestApiKey: 'request-secret',
      adminApiKey: 'admin-secret'
    }
  );

const invokeRoute = async (input: {
  method: 'get' | 'post';
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, unknown>;
  params?: Record<string, string>;
}) => {
  const router = createTestRouter() as any;
  const routeLayer = router.stack.find((layer: any) => layer.route?.path === input.path && layer.route.methods?.[input.method]);
  if (!routeLayer) {
    throw new Error(`route not found: ${input.method.toUpperCase()} ${input.path}`);
  }

  const headers = Object.fromEntries(
    Object.entries(input.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value])
  );
  const req = {
    body: input.body ?? {},
    query: input.query ?? {},
    params: input.params ?? {},
    method: input.method.toUpperCase(),
    originalUrl: input.path,
    header: (name: string) => headers[name.toLowerCase()]
  } as any;

  let statusCode = 200;
  let jsonBody: unknown;

  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      jsonBody = body;
      return this;
    }
  } as any;

  const handlers = routeLayer.route.stack.map((layer: any) => layer.handle);

  for (const handler of handlers) {
    let forwardedError: unknown;
    let nextCalled = false;
    await Promise.resolve(
      handler(req, res, (error?: unknown) => {
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
    status: statusCode,
    body: jsonBody
  };
};

describe('withdraw route auth', () => {
  it('blocks request creation without request api key', () => {
    const middleware = createRequireWithdrawApiKey(
      'request-secret',
      'WITHDRAW_REQUEST_UNAUTHORIZED',
      'withdraw request api key is required'
    );
    const next = vi.fn();

    middleware(buildReq(), {} as any, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]?.[0]).toMatchObject({
      code: 'WITHDRAW_REQUEST_UNAUTHORIZED'
    });
  });

  it('accepts admin requests when the api key matches', () => {
    const middleware = createRequireWithdrawApiKey(
      'admin-secret',
      'WITHDRAW_ADMIN_UNAUTHORIZED',
      'withdraw admin api key is required'
    );
    const next = vi.fn();

    middleware(buildReq({ 'x-admin-api-key': 'admin-secret' }), {} as any, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('prefers authenticated admin id headers for approval actors', () => {
    const req = buildReq({ 'x-admin-id': 'ops-admin-1', 'x-actor-id': 'ignored-actor' });

    expect(readWithdrawAdminActorId(req)).toBe('ops-admin-1');
  });

  it('reads generic actor headers for external auth actors', () => {
    const req = buildReq({ 'x-actor-id': 'ops-bot-1' });

    expect(readWithdrawActorId(req)).toBe('ops-bot-1');
  });

  it('protects address policy routes with admin api key', async () => {
    const response = await invokeRoute({
      method: 'get',
      path: '/policies/addresses'
    });

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      error: {
        code: 'WITHDRAW_ADMIN_UNAUTHORIZED'
      }
    });
  });

  it('validates address policy payloads through extracted schemas', async () => {
    const response = await invokeRoute({
      method: 'post',
      path: '/policies/addresses',
      headers: {
        'x-internal-api-key': 'admin-secret'
      },
      body: {
        address: 'not-a-tron-address',
        policyType: 'blacklist'
      }
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR'
      }
    });
  });
});
