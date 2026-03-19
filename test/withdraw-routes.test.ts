import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/interfaces/http/middleware/error-handler.js';
import { createWithdrawRoutes } from '../src/interfaces/http/routes/withdraw-routes.js';

describe('withdraw routes', () => {
  it('serializes displayStatus on withdrawal detail responses', async () => {
    const router = createWithdrawRoutes(
      {
        request: vi.fn(),
        listPendingApprovals: vi.fn(),
        reconcileBroadcasted: vi.fn(),
        approve: vi.fn(),
        confirmExternalAuth: vi.fn(),
        broadcast: vi.fn(),
        confirm: vi.fn(),
        listOfflineSigningPending: vi.fn(),
        submitOfflineBroadcast: vi.fn(),
        listAddressPolicies: vi.fn().mockResolvedValue([]),
        upsertAddressPolicy: vi.fn(),
        deleteAddressPolicy: vi.fn(),
        listApprovals: vi.fn(),
        get: vi.fn().mockResolvedValue({
          withdrawalId: 'wd-1',
          userId: 'user-1',
          amount: 1000000n,
          toAddress: 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          status: 'ADMIN_APPROVED',
          idempotencyKey: 'idem-1',
          ledgerTxId: 'ledger-1',
          createdAt: '2026-03-19T00:00:00.000Z',
          riskLevel: 'medium',
          riskScore: 50,
          riskFlags: ['medium_amount'],
          requiredApprovals: 2,
          approvalCount: 2
        })
      } as any,
      {
        adminApiKey: 'admin-secret'
      }
    ) as any;

    const routeLayer = router.stack.find((layer: any) => layer.route?.path === '/:withdrawalId' && layer.route.methods?.get);
    const req = {
      body: {},
      query: {},
      params: { withdrawalId: 'wd-1' },
      method: 'GET',
      originalUrl: '/wd-1',
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

    expect(statusCode).toBe(200);
    expect(jsonBody).toEqual({
      withdrawal: {
        withdrawalId: 'wd-1',
        userId: 'user-1',
        amount: '1.000000',
        toAddress: 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        status: 'ADMIN_APPROVED',
        displayStatus: 'approved',
        idempotencyKey: 'idem-1',
        ledgerTxId: 'ledger-1',
        createdAt: '2026-03-19T00:00:00.000Z',
        riskLevel: 'medium',
        riskScore: 50,
        riskFlags: ['medium_amount'],
        requiredApprovals: 2,
        approvalCount: 2
      }
    });
  });

  it('serializes offline-submit responses with displayStatus', async () => {
    const router = createWithdrawRoutes(
      {
        request: vi.fn(),
        listPendingApprovals: vi.fn(),
        reconcileBroadcasted: vi.fn(),
        approve: vi.fn(),
        confirmExternalAuth: vi.fn(),
        broadcast: vi.fn(),
        confirm: vi.fn(),
        listOfflineSigningPending: vi.fn(),
        submitOfflineBroadcast: vi.fn().mockResolvedValue({
          withdrawalId: 'wd-2',
          userId: 'user-2',
          amount: 2000000n,
          toAddress: 'TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
          status: 'TX_BROADCASTED',
          txHash: 'offline-tx-hash-1',
          idempotencyKey: 'idem-2',
          ledgerTxId: 'ledger-2',
          createdAt: '2026-03-19T00:00:00.000Z',
          riskLevel: 'high',
          riskScore: 80,
          riskFlags: ['large_amount'],
          requiredApprovals: 2,
          approvalCount: 2
        }),
        listAddressPolicies: vi.fn().mockResolvedValue([]),
        upsertAddressPolicy: vi.fn(),
        deleteAddressPolicy: vi.fn(),
        listApprovals: vi.fn(),
        get: vi.fn()
      } as any,
      {
        adminApiKey: 'admin-secret'
      }
    ) as any;

    const routeLayer = router.stack.find(
      (layer: any) => layer.route?.path === '/:withdrawalId/offline-submit' && layer.route.methods?.post
    );
    const req = {
      body: { txHash: 'offline-tx-hash-1', note: 'cold wallet signed' },
      query: {},
      params: { withdrawalId: 'wd-2' },
      method: 'POST',
      originalUrl: '/wd-2/offline-submit',
      header: (name: string) => {
        const normalized = name.toLowerCase();
        if (normalized === 'x-admin-api-key') {
          return 'admin-secret';
        }
        if (normalized === 'x-admin-id') {
          return 'ops-admin-1';
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
    expect(jsonBody).toEqual({
      withdrawal: {
        withdrawalId: 'wd-2',
        userId: 'user-2',
        amount: '2.000000',
        toAddress: 'TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        status: 'TX_BROADCASTED',
        displayStatus: 'sending',
        txHash: 'offline-tx-hash-1',
        idempotencyKey: 'idem-2',
        ledgerTxId: 'ledger-2',
        createdAt: '2026-03-19T00:00:00.000Z',
        riskLevel: 'high',
        riskScore: 80,
        riskFlags: ['large_amount'],
        requiredApprovals: 2,
        approvalCount: 2
      }
    });
  });

  it('passes approval reasonCode through approve route', async () => {
    const approve = vi.fn().mockResolvedValue({
      approval: {
        approvalId: 'approval-1',
        withdrawalId: 'wd-approve-1',
        adminId: 'ops-admin-1',
        actorType: 'admin',
        reasonCode: 'high_value_verified',
        note: 'verified source of funds',
        createdAt: '2026-03-19T00:00:00.000Z'
      },
      withdrawal: {
        withdrawalId: 'wd-approve-1',
        userId: 'user-1',
        amount: 1000000n,
        toAddress: 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        status: 'ADMIN_APPROVED',
        idempotencyKey: 'idem-approve-1',
        ledgerTxId: 'ledger-approve-1',
        createdAt: '2026-03-19T00:00:00.000Z',
        approvedAt: '2026-03-19T00:01:00.000Z',
        riskLevel: 'high',
        riskScore: 80,
        riskFlags: ['large_amount'],
        requiredApprovals: 2,
        approvalCount: 2
      },
      finalized: true
    });
    const router = createWithdrawRoutes(
      {
        request: vi.fn(),
        listPendingApprovals: vi.fn(),
        reconcileBroadcasted: vi.fn(),
        approve,
        confirmExternalAuth: vi.fn(),
        broadcast: vi.fn(),
        confirm: vi.fn(),
        listOfflineSigningPending: vi.fn(),
        submitOfflineBroadcast: vi.fn(),
        listAddressPolicies: vi.fn().mockResolvedValue([]),
        upsertAddressPolicy: vi.fn(),
        deleteAddressPolicy: vi.fn(),
        listApprovals: vi.fn(),
        get: vi.fn()
      } as any,
      {
        adminApiKey: 'admin-secret'
      }
    ) as any;

    const routeLayer = router.stack.find(
      (layer: any) => layer.route?.path === '/:withdrawalId/approve' && layer.route.methods?.post
    );
    const req = {
      body: { reasonCode: 'high_value_verified', note: 'verified source of funds' },
      query: {},
      params: { withdrawalId: 'wd-approve-1' },
      method: 'POST',
      originalUrl: '/wd-approve-1/approve',
      header: (name: string) => {
        const normalized = name.toLowerCase();
        if (normalized === 'x-admin-api-key') {
          return 'admin-secret';
        }
        if (normalized === 'x-admin-id') {
          return 'ops-admin-1';
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
    expect(approve).toHaveBeenCalledWith('wd-approve-1', {
      adminId: 'ops-admin-1',
      reasonCode: 'high_value_verified',
      note: 'verified source of funds'
    });
    expect(jsonBody).toMatchObject({
      approval: {
        reasonCode: 'high_value_verified'
      }
    });
  });
});
