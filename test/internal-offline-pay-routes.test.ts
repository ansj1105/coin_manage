import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/interfaces/http/middleware/error-handler.js';
import { createInternalOfflinePayRoutes } from '../src/interfaces/http/routes/internal-offline-pay-routes.js';
import { computeOfflinePayProofFingerprint } from '../src/application/services/offline-pay-proof-fingerprint.js';

const invokeRoute = async (
  input: {
    method: 'get' | 'post';
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
  },
  offlinePayService: {
    lockCollateral?: ReturnType<typeof vi.fn>;
    finalizeSettlement?: ReturnType<typeof vi.fn>;
  }
) => {
  const router = createInternalOfflinePayRoutes(offlinePayService as any, {
    internalApiKey: 'internal-secret'
  }) as any;

  const headers = Object.fromEntries(
    Object.entries(input.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value])
  );
  const req = {
    body: input.body ?? {},
    query: {},
    params: {},
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
    json(payload: unknown) {
      jsonBody = payload;
      return this;
    }
  } as any;

  for (const layer of router.stack) {
    if (layer.route) {
      if (layer.route.path !== input.path || !layer.route.methods?.[input.method]) {
        continue;
      }

      for (const routeLayer of layer.route.stack) {
        let forwardedError: unknown;
        let nextCalled = false;
        await Promise.resolve(
          routeLayer.handle(req, res, (error?: unknown) => {
            nextCalled = true;
            forwardedError = error;
          })
        );

        if (forwardedError) {
          errorHandler(forwardedError, req, res, (() => undefined) as any);
          return {
            statusCode,
            jsonBody
          };
        }

        if (!nextCalled) {
          return {
            statusCode,
            jsonBody
          };
        }
      }
      return {
        statusCode,
        jsonBody
      };
    }

    if (typeof layer.handle === 'function') {
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
        return {
          statusCode,
          jsonBody
        };
      }

      if (!nextCalled) {
        return {
          statusCode,
          jsonBody
        };
      }
    }
  }

  return {
    statusCode,
    jsonBody
  };
};

describe('internal offline-pay routes', () => {
  it('locks collateral through the injected service and returns lock metadata', async () => {
    const lockCollateral = vi.fn().mockResolvedValue({
      lockId: 'lock-1',
      status: 'LOCKED'
    });

    const response = await invokeRoute(
      {
        method: 'post',
        path: '/collateral/lock',
        headers: {
          'x-internal-api-key': 'internal-secret'
        },
        body: {
          userId: '77',
          deviceId: 'device-1',
          assetCode: 'USDT',
          amount: '150.000000',
          referenceId: 'ref-1',
          policyVersion: 2
        }
      },
      { lockCollateral }
    );

    expect(response.statusCode).toBe(200);
    expect(lockCollateral).toHaveBeenCalledWith({
      userId: '77',
      deviceId: 'device-1',
      assetCode: 'USDT',
      amount: '150.000000',
      referenceId: 'ref-1',
      policyVersion: 2
    });
    expect(response.jsonBody).toEqual({
      lockId: 'lock-1',
      status: 'LOCKED'
    });
  });

  it('finalizes settlement through the injected service and returns ack response', async () => {
    const finalizeSettlement = vi.fn().mockResolvedValue({
      status: 'OK',
      message: 'settlement finalized'
    });

    const response = await invokeRoute(
      {
        method: 'post',
        path: '/settlements/finalize',
        headers: {
          'x-internal-api-key': 'internal-secret'
        },
        body: {
          settlementId: 'settlement-1',
          batchId: 'batch-1',
          collateralId: 'collateral-1',
          proofId: 'proof-1',
          userId: '77',
          deviceId: 'device-1',
          assetCode: 'USDT',
          amount: '150.000000',
          settlementStatus: 'SETTLED',
          releaseAction: 'RELEASE',
          conflictDetected: false,
          proofFingerprint: computeOfflinePayProofFingerprint({
            settlementId: 'settlement-1',
            batchId: 'batch-1',
            collateralId: 'collateral-1',
            proofId: 'proof-1',
            deviceId: 'device-1',
            newStateHash: 'hash-1',
            previousHash: 'prev-1',
            monotonicCounter: 1,
            nonce: 'nonce-1',
            signature: 'signature-1'
          }),
          newStateHash: 'hash-1',
          previousHash: 'prev-1',
          monotonicCounter: 1,
          nonce: 'nonce-1',
          signature: 'signature-1'
        }
      },
      { finalizeSettlement }
    );

    expect(response.statusCode).toBe(200);
    expect(finalizeSettlement).toHaveBeenCalledWith({
      settlementId: 'settlement-1',
      batchId: 'batch-1',
      collateralId: 'collateral-1',
      proofId: 'proof-1',
      userId: '77',
      deviceId: 'device-1',
      assetCode: 'USDT',
      amount: '150.000000',
      settlementStatus: 'SETTLED',
      releaseAction: 'RELEASE',
      conflictDetected: false,
      proofFingerprint: computeOfflinePayProofFingerprint({
        settlementId: 'settlement-1',
        batchId: 'batch-1',
        collateralId: 'collateral-1',
        proofId: 'proof-1',
        deviceId: 'device-1',
        newStateHash: 'hash-1',
        previousHash: 'prev-1',
        monotonicCounter: 1,
        nonce: 'nonce-1',
        signature: 'signature-1'
      }),
      newStateHash: 'hash-1',
      previousHash: 'prev-1',
      monotonicCounter: 1,
      nonce: 'nonce-1',
      signature: 'signature-1'
    });
    expect(response.jsonBody).toEqual({
      status: 'OK',
      message: 'settlement finalized'
    });
  });

  it('blocks requests without internal api key', async () => {
    const response = await invokeRoute(
      {
        method: 'post',
        path: '/collateral/lock',
        body: {
          userId: '77',
          deviceId: 'device-1',
          assetCode: 'USDT',
          amount: '150.000000',
          referenceId: 'ref-1',
          policyVersion: 2
        }
      },
      { lockCollateral: vi.fn() }
    );

    expect(response.statusCode).toBe(401);
    expect(response.jsonBody).toMatchObject({
      error: {
        code: 'OFFLINE_PAY_INTERNAL_UNAUTHORIZED'
      }
    });
  });
});
