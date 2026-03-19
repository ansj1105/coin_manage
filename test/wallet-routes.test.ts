import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/interfaces/http/middleware/error-handler.js';
import { createWalletRoutes } from '../src/interfaces/http/routes/wallet-routes.js';

const invokeRoute = async (input: {
  path: string;
  query?: Record<string, unknown>;
  walletService?: Record<string, unknown>;
}) => {
  const router = createWalletRoutes(
    {
      bindWalletAddress: vi.fn(),
      getWalletBinding: vi.fn(),
      getBalance: vi.fn(),
      transfer: vi.fn(),
      getTimeline: vi.fn().mockResolvedValue([
        {
          timelineId: 'deposit:1',
          entryType: 'deposit',
          amount: 1000000n,
          status: 'CREDITED',
          createdAt: '2026-03-19T00:00:00.000Z',
          txHash: 'tx-1',
          blockNumber: 1,
          depositId: '1'
        }
      ]),
      ...(input.walletService ?? {})
    } as any,
    undefined
  ) as any;

  const routeLayer = router.stack.find((layer: any) => layer.route?.path === input.path && layer.route.methods?.get);
  if (!routeLayer) {
    throw new Error(`route not found: ${input.path}`);
  }

  const req = {
    body: {},
    query: input.query ?? {},
    params: {},
    method: 'GET',
    originalUrl: input.path,
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

describe('wallet routes', () => {
  it('validates wallet timeline query input', async () => {
    const response = await invokeRoute({
      path: '/timeline',
      query: {}
    });

    expect(response.statusCode).toBe(400);
    expect(response.jsonBody).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR'
      }
    });
  });

  it('serializes wallet timeline response amounts', async () => {
    const getTimeline = vi.fn().mockResolvedValue([
      {
        timelineId: 'deposit:1',
        entryType: 'deposit',
        amount: 1000000n,
        status: 'CREDITED',
        createdAt: '2026-03-19T00:00:00.000Z',
        txHash: 'tx-1',
        blockNumber: 1,
        depositId: '1'
      }
    ]);

    const response = await invokeRoute({
      path: '/timeline',
      query: { userId: 'user-1', limit: '10' },
      walletService: { getTimeline }
    });

    expect(getTimeline).toHaveBeenCalledWith({
      userId: 'user-1',
      walletAddress: undefined,
      limit: 10
    });
    expect(response.statusCode).toBe(200);
    expect(response.jsonBody).toEqual({
      items: [
        {
          timelineId: 'deposit:1',
          entryType: 'deposit',
          amount: '1.000000',
          status: 'CREDITED',
          createdAt: '2026-03-19T00:00:00.000Z',
          txHash: 'tx-1',
          blockNumber: 1,
          depositId: '1'
        }
      ]
    });
  });

  it('keeps withdrawal display status in wallet timeline responses', async () => {
    const getTimeline = vi.fn().mockResolvedValue([
      {
        timelineId: 'withdrawal:1',
        entryType: 'withdrawal',
        amount: 1000000n,
        status: 'ADMIN_APPROVED',
        displayStatus: 'approved',
        createdAt: '2026-03-19T00:00:00.000Z',
        toAddress: 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        withdrawalId: '1',
        ledgerTxId: 'ledger-1'
      }
    ]);

    const response = await invokeRoute({
      path: '/timeline',
      query: { userId: 'user-1' },
      walletService: { getTimeline }
    });

    expect(response.jsonBody).toEqual({
      items: [
        {
          timelineId: 'withdrawal:1',
          entryType: 'withdrawal',
          amount: '1.000000',
          status: 'ADMIN_APPROVED',
          displayStatus: 'approved',
          createdAt: '2026-03-19T00:00:00.000Z',
          toAddress: 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          withdrawalId: '1',
          ledgerTxId: 'ledger-1'
        }
      ]
    });
  });
});
