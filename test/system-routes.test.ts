import { describe, expect, it, vi } from 'vitest';
import { createRequireWithdrawApiKey } from '../src/interfaces/http/middleware/withdraw-auth.js';
import { errorHandler } from '../src/interfaces/http/middleware/error-handler.js';
import { createSystemRoutes } from '../src/interfaces/http/routes/system-routes.js';

const buildRouter = (operationsServiceOverrides: Record<string, unknown> = {}) =>
  createSystemRoutes(
    {
      getStoredWallets: vi.fn().mockResolvedValue([]),
      getCollectorRuns: vi.fn().mockResolvedValue([]),
      getWalletHistory: vi.fn().mockResolvedValue([])
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
      listNetworkFeeReceipts: vi.fn().mockResolvedValue({
        items: [],
        summary: {
          currencyCode: 'TRX',
          totalFeeSun: '0',
          totalFeeAmount: '0.000000',
          byReferenceType: {
            withdrawal: '0.000000',
            sweep: '0.000000'
          }
        }
      }),
      listNetworkFeeDailySnapshots: vi.fn().mockResolvedValue({
        items: [],
        summary: {
          currencyCode: 'TRX',
          totalLedgerFeeSun: '0',
          totalLedgerFeeAmount: '0.000000',
          totalActualFeeSun: '0',
          totalActualFeeAmount: '0.000000',
          totalGapFeeSun: '0',
          totalGapFeeAmount: '0.000000'
        }
      }),
      getWithdrawalOverview: vi.fn().mockResolvedValue({
        pendingApprovalCount: 0,
        broadcastPendingCount: 0,
        offlineSigningPendingCount: 0,
        onchainPendingCount: 0,
        failedJobCount: 0
      }),
      getOutboxStatus: vi.fn().mockResolvedValue({
        summary: {
          pendingCount: 0,
          processingCount: 0,
          publishedCount: 0,
          deadLetteredCount: 0,
          deadLetterAcknowledgedCount: 0,
          deadLetterUnacknowledgedCount: 0,
          oldestPendingCreatedAt: null,
          oldestDeadLetteredAt: null
        },
        items: []
      }),
      replayDeadLetterOutboxEvents: vi.fn().mockResolvedValue({ replayedCount: 1 }),
      recoverStaleOutboxProcessing: vi.fn().mockResolvedValue({ recoveredCount: 1, timeoutSec: 300 }),
      acknowledgeDeadLetterOutboxEvents: vi.fn().mockResolvedValue({ acknowledgedCount: 1 }),
      getEventConsumerStatus: vi.fn().mockResolvedValue({
        summary: {
          attemptCount: 0,
          failureCount: 0,
          deadLetterCount: 0
        },
        attempts: [],
        deadLetters: []
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

  it('passes audit log filters through validated query params', async () => {
    const listAuditLogs = vi.fn().mockResolvedValue([]);
    const router = buildRouter({ listAuditLogs });
    const routeLayer = router.stack.find(
      (layer: any) => layer.route?.path === '/audit-logs' && layer.route.methods?.get
    );

    const req = {
      body: {},
      query: {
        entityType: 'withdrawal',
        entityId: 'wd-1',
        actorId: 'ops-admin-1',
        action: 'withdraw.external_sync.failed',
        createdFrom: '2026-03-19T00:00:00.000Z',
        createdTo: '2026-03-19T23:59:59.000Z',
        limit: '25'
      },
      params: {},
      method: 'GET',
      originalUrl: '/audit-logs',
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
        throw forwardedError;
      }

      if (!nextCalled) {
        break;
      }
    }

    expect(listAuditLogs).toHaveBeenCalledWith({
      entityType: 'withdrawal',
      entityId: 'wd-1',
      actorId: 'ops-admin-1',
      action: 'withdraw.external_sync.failed',
      createdFrom: '2026-03-19T00:00:00.000Z',
      createdTo: '2026-03-19T23:59:59.000Z',
      limit: 25
    });
    expect(jsonBody).toEqual({ logs: [] });
  });

  it('exports audit logs as csv with validated filters', async () => {
    const listAuditLogs = vi.fn().mockResolvedValue([
      {
        auditId: 'audit-1',
        entityType: 'withdrawal',
        entityId: 'wd-1',
        action: 'withdraw.approved.finalized',
        actorType: 'admin',
        actorId: 'ops-admin-1',
        metadata: {
          reasonCode: 'high_value_verified',
          note: 'verified source'
        },
        createdAt: '2026-03-19T00:00:00.000Z'
      }
    ]);
    const router = buildRouter({ listAuditLogs });
    const routeLayer = router.stack.find(
      (layer: any) => layer.route?.path === '/audit-logs/export' && layer.route.methods?.get
    );

    const req = {
      body: {},
      query: {
        actorId: 'ops-admin-1',
        action: 'withdraw.approved.finalized',
        limit: '10'
      },
      params: {},
      method: 'GET',
      originalUrl: '/audit-logs/export',
      header: (name: string) => (name.toLowerCase() === 'x-admin-api-key' ? 'admin-secret' : undefined)
    } as any;
    const headers = new Map<string, string>();
    let responseType: string | undefined;
    let sendBody: unknown;
    const res = {
      status() {
        return this;
      },
      setHeader(name: string, value: string) {
        headers.set(name, value);
        return this;
      },
      type(value: string) {
        responseType = value;
        return this;
      },
      send(payload: unknown) {
        sendBody = payload;
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
        throw forwardedError;
      }

      if (!nextCalled) {
        break;
      }
    }

    expect(listAuditLogs).toHaveBeenCalledWith({
      actorId: 'ops-admin-1',
      action: 'withdraw.approved.finalized',
      limit: 10
    });
    expect(headers.get('Content-Disposition')).toBe('attachment; filename="audit-logs.csv"');
    expect(responseType).toBe('text/csv; charset=utf-8');
    expect(sendBody).toBe(
      '"auditId","entityType","entityId","action","actorType","actorId","createdAt","metadata"\n' +
        '"audit-1","withdrawal","wd-1","withdraw.approved.finalized","admin","ops-admin-1","2026-03-19T00:00:00.000Z","{""reasonCode"":""high_value_verified"",""note"":""verified source""}"'
    );
  });

  it('returns outbox status for ops tooling', async () => {
    const getOutboxStatus = vi.fn().mockResolvedValue({
      summary: {
        pendingCount: 1,
        processingCount: 0,
        publishedCount: 5,
        deadLetteredCount: 1,
        deadLetterAcknowledgedCount: 0,
        deadLetterUnacknowledgedCount: 1,
        oldestPendingCreatedAt: '2026-03-19T00:00:00.000Z',
        oldestDeadLetteredAt: '2026-03-19T00:05:00.000Z'
      },
      items: [
        {
          outboxEventId: 'outbox-1',
          eventType: 'withdrawal.state.changed',
          aggregateType: 'withdrawal',
          aggregateId: 'wd-1',
          status: 'dead_lettered',
          attempts: 10,
          availableAt: '2026-03-19T00:00:00.000Z',
          createdAt: '2026-03-19T00:00:00.000Z',
          publishedAt: null,
          deadLetteredAt: '2026-03-19T00:05:00.000Z',
          deadLetterAcknowledgedAt: null,
          deadLetterAcknowledgedBy: null,
          deadLetterNote: null,
          deadLetterCategory: null,
          incidentRef: null,
          lastError: 'callback unavailable'
        }
      ]
    });
    const router = buildRouter({ getOutboxStatus });
    const routeLayer = router.stack.find(
      (layer: any) => layer.route?.path === '/outbox' && layer.route.methods?.get
    );

    const req = {
      body: {},
      query: { limit: '25' },
      params: {},
      method: 'GET',
      originalUrl: '/outbox',
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

    expect(getOutboxStatus).toHaveBeenCalledWith(25);
    expect(jsonBody).toMatchObject({
      summary: {
        deadLetteredCount: 1,
        deadLetterUnacknowledgedCount: 1
      },
      items: [
        {
          status: 'dead_lettered',
          attempts: 10
        }
      ]
    });
  });

  it('replays dead-letter outbox events for ops tooling', async () => {
    const replayDeadLetterOutboxEvents = vi.fn().mockResolvedValue({ replayedCount: 2 });
    const router = buildRouter({ replayDeadLetterOutboxEvents });
    const routeLayer = router.stack.find(
      (layer: any) => layer.route?.path === '/outbox/replay' && layer.route.methods?.post
    );

    const req = {
      body: { limit: 2, actorId: 'ops-admin-1' },
      query: {},
      params: {},
      method: 'POST',
      originalUrl: '/outbox/replay',
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

    expect(replayDeadLetterOutboxEvents).toHaveBeenCalledWith({
      outboxEventIds: undefined,
      limit: 2,
      actorId: 'ops-admin-1'
    });
    expect(jsonBody).toEqual({ replayedCount: 2 });
  });

  it('recovers stale processing outbox events for ops tooling', async () => {
    const recoverStaleOutboxProcessing = vi.fn().mockResolvedValue({ recoveredCount: 3, timeoutSec: 600 });
    const router = buildRouter({ recoverStaleOutboxProcessing });
    const routeLayer = router.stack.find(
      (layer: any) => layer.route?.path === '/outbox/recover-processing' && layer.route.methods?.post
    );

    const req = {
      body: { timeoutSec: 600, actorId: 'ops-admin-1' },
      query: {},
      params: {},
      method: 'POST',
      originalUrl: '/outbox/recover-processing',
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

    expect(recoverStaleOutboxProcessing).toHaveBeenCalledWith({
      timeoutSec: 600,
      actorId: 'ops-admin-1'
    });
    expect(jsonBody).toEqual({ recoveredCount: 3, timeoutSec: 600 });
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

  it('acknowledges dead-letter outbox events for ops tooling', async () => {
    const acknowledgeDeadLetterOutboxEvents = vi.fn().mockResolvedValue({ acknowledgedCount: 2 });
    const router = buildRouter({ acknowledgeDeadLetterOutboxEvents });
    const routeLayer = router.stack.find(
      (layer: any) => layer.route?.path === '/outbox/dead-letter/ack' && layer.route.methods?.post
    );

    const req = {
      body: {
        limit: 2,
        actorId: 'ops-admin-1',
        note: 'triaged and linked to incident',
        category: 'external_dependency',
        incidentRef: 'INC-2026-0319'
      },
      query: {},
      params: {},
      method: 'POST',
      originalUrl: '/outbox/dead-letter/ack',
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

    expect(acknowledgeDeadLetterOutboxEvents).toHaveBeenCalledWith({
      outboxEventIds: undefined,
      limit: 2,
      actorId: 'ops-admin-1',
      note: 'triaged and linked to incident',
      category: 'external_dependency',
      incidentRef: 'INC-2026-0319'
    });
    expect(jsonBody).toEqual({ acknowledgedCount: 2 });
  });

  it('returns wallet monitoring history for time-series tooling', async () => {
    const getWalletHistory = vi.fn().mockResolvedValue([
      {
        snapshotId: 'snapshot-1',
        collectorName: 'wallet_balances',
        walletCode: 'hot',
        address: 'THOT123',
        tokenSymbol: 'KORI',
        tokenContractAddress: 'TCONTRACT',
        tokenBalance: '100.000000',
        tokenRawBalance: '100000000',
        tokenDecimals: 6,
        trxBalance: '50.000000',
        trxRawBalance: '50000000',
        fetchedAt: '2026-03-19T00:00:00.000Z',
        status: 'ok',
        createdAt: '2026-03-19T00:00:05.000Z'
      }
    ]);
    const router = createSystemRoutes(
      {
        getStoredWallets: vi.fn().mockResolvedValue([]),
        getCollectorRuns: vi.fn().mockResolvedValue([]),
        getWalletHistory
      } as any,
      buildRouter() as any,
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
    const routeLayer = router.stack.find(
      (layer: any) => layer.route?.path === '/monitoring/history' && layer.route.methods?.get
    );

    const req = {
      body: {},
      query: {
        walletCodes: 'hot,treasury',
        createdFrom: '2026-03-19T00:00:00.000Z',
        createdTo: '2026-03-19T01:00:00.000Z',
        limit: '100'
      },
      params: {},
      method: 'GET',
      originalUrl: '/monitoring/history',
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

    expect(getWalletHistory).toHaveBeenCalledWith({
      walletCodes: ['hot', 'treasury'],
      createdFrom: '2026-03-19T00:00:00.000Z',
      createdTo: '2026-03-19T01:00:00.000Z',
      limit: 100
    });
    expect(jsonBody).toMatchObject({
      items: [
        {
          snapshotId: 'snapshot-1',
          walletCode: 'hot',
          tokenBalance: '100.000000',
          trxBalance: '50.000000'
        }
      ]
    });
  });

  it('returns event consumer observability for ops tooling', async () => {
    const getEventConsumerStatus = vi.fn().mockResolvedValue({
      summary: {
        attemptCount: 2,
        failureCount: 1,
        deadLetterCount: 1
      },
      attempts: [
        {
          attemptId: 'attempt-1',
          eventKey: 'event-key-1',
          eventType: 'withdrawal.state.changed',
          consumerName: 'foxya_withdrawal_sync',
          status: 'failed',
          attemptNumber: 1,
          aggregateId: 'wd-1',
          errorMessage: 'timeout',
          durationMs: 120,
          createdAt: '2026-03-19T00:00:00.000Z'
        }
      ],
      deadLetters: [
        {
          deadLetterId: 'dlq-1',
          eventKey: 'event-key-1',
          eventType: 'withdrawal.state.changed',
          consumerName: 'foxya_withdrawal_sync',
          aggregateId: 'wd-1',
          payload: { withdrawalId: 'wd-1' },
          errorMessage: 'timeout',
          failedAt: '2026-03-19T00:00:01.000Z'
        }
      ]
    });
    const router = buildRouter({ getEventConsumerStatus });
    const routeLayer = router.stack.find(
      (layer: any) => layer.route?.path === '/event-consumers' && layer.route.methods?.get
    );

    const req = {
      body: {},
      query: {
        consumerName: 'foxya_withdrawal_sync',
        eventType: 'withdrawal.state.changed',
        limit: '20'
      },
      params: {},
      method: 'GET',
      originalUrl: '/event-consumers',
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

    expect(getEventConsumerStatus).toHaveBeenCalledWith({
      consumerName: 'foxya_withdrawal_sync',
      eventType: 'withdrawal.state.changed',
      limit: 20
    });
    expect(jsonBody).toMatchObject({
      summary: {
        deadLetterCount: 1
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

  it('lists daily network fee reconciliation snapshots for ops tooling', async () => {
    const listNetworkFeeDailySnapshots = vi.fn().mockResolvedValue({
      items: [
        {
          snapshotDate: '2026-03-19',
          currencyCode: 'TRX',
          ledgerFeeSun: '1500000',
          ledgerFeeAmount: '1.500000',
          actualFeeSun: '1500000',
          actualFeeAmount: '1.500000',
          gapFeeSun: '0',
          gapFeeAmount: '0.000000',
          ledgerFeeCount: 1,
          actualFeeCount: 1,
          status: 'balanced',
          byReferenceType: {
            withdrawal: {
              ledgerFeeSun: '1500000',
              ledgerFeeAmount: '1.500000',
              actualFeeSun: '1500000',
              actualFeeAmount: '1.500000',
              ledgerFeeCount: 1,
              actualFeeCount: 1
            },
            sweep: {
              ledgerFeeSun: '0',
              ledgerFeeAmount: '0.000000',
              actualFeeSun: '0',
              actualFeeAmount: '0.000000',
              ledgerFeeCount: 0,
              actualFeeCount: 0
            }
          }
        }
      ],
      summary: {
        currencyCode: 'TRX',
        totalLedgerFeeSun: '1500000',
        totalLedgerFeeAmount: '1.500000',
        totalActualFeeSun: '1500000',
        totalActualFeeAmount: '1.500000',
        totalGapFeeSun: '0',
        totalGapFeeAmount: '0.000000'
      }
    });
    const router = buildRouter({ listNetworkFeeDailySnapshots });
    const routeLayer = router.stack.find(
      (layer: any) => layer.route?.path === '/network-fees/daily-snapshots' && layer.route.methods?.get
    );

    const req = {
      body: {},
      query: { days: '14' },
      params: {},
      method: 'GET',
      originalUrl: '/network-fees/daily-snapshots',
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

    expect(listNetworkFeeDailySnapshots).toHaveBeenCalledWith({ days: 14 });
    expect(jsonBody).toMatchObject({
      summary: {
        totalGapFeeSun: '0'
      }
    });
  });

  it('returns offline pay operation overview for ops widgets', async () => {
    const getOfflinePayOperationOverview = vi.fn().mockResolvedValue({
      summary: {
        completedCount: 3,
        pendingCount: 2,
        failedCount: 1,
        settlementCount: 2,
        collateralTopupCount: 1,
        collateralReleaseCount: 1
      },
      items: []
    });
    const router = buildRouter({ getOfflinePayOperationOverview });
    const routeLayer = router.stack.find(
      (layer: any) => layer.route?.path === '/offline-pay/operations/overview' && layer.route.methods?.get
    );

    const req = {
      body: {},
      query: { limit: '20', assetCode: 'KORI' },
      params: {},
      method: 'GET',
      originalUrl: '/offline-pay/operations/overview',
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

    expect(getOfflinePayOperationOverview).toHaveBeenCalledWith({ limit: 20, assetCode: 'KORI' });
    expect(jsonBody).toMatchObject({
      summary: {
        completedCount: 3,
        pendingCount: 2,
        failedCount: 1
      }
    });
  });

  it('lists offline pay operations for ops tooling', async () => {
    const listOfflinePayOperations = vi.fn().mockResolvedValue([
      {
        id: 'evt-1',
        operationType: 'COLLATERAL_TOPUP',
        status: 'pending',
        assetCode: 'KORI',
        amount: '100.000000',
        userId: '77',
        deviceId: 'device-1',
        referenceId: 'ref-1',
        source: 'outbox',
        createdAt: '2026-03-21T00:00:00.000Z',
        lastError: null
      }
    ]);
    const router = buildRouter({ listOfflinePayOperations });
    const routeLayer = router.stack.find(
      (layer: any) => layer.route?.path === '/offline-pay/operations' && layer.route.methods?.get
    );

    const req = {
      body: {},
      query: { limit: '10', operationType: 'COLLATERAL_TOPUP', status: 'pending', assetCode: 'KORI' },
      params: {},
      method: 'GET',
      originalUrl: '/offline-pay/operations',
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

    expect(listOfflinePayOperations).toHaveBeenCalledWith({
      limit: 10,
      operationType: 'COLLATERAL_TOPUP',
      status: 'pending',
      assetCode: 'KORI'
    });
    expect(jsonBody).toEqual({
      items: [
        expect.objectContaining({
          operationType: 'COLLATERAL_TOPUP',
          status: 'pending'
        })
      ]
    });
  });

  it('returns withdrawal overview counts for dashboard widgets', async () => {
    const getWithdrawalOverview = vi.fn().mockResolvedValue({
      pendingApprovalCount: 2,
      broadcastPendingCount: 3,
      offlineSigningPendingCount: 1,
      onchainPendingCount: 4,
      failedJobCount: 1
    });
    const router = buildRouter({ getWithdrawalOverview });
    const routeLayer = router.stack.find(
      (layer: any) => layer.route?.path === '/withdrawals/overview' && layer.route.methods?.get
    );

    const req = {
      body: {},
      query: {},
      params: {},
      method: 'GET',
      originalUrl: '/withdrawals/overview',
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

    expect(jsonBody).toEqual({
      pendingApprovalCount: 2,
      broadcastPendingCount: 3,
      offlineSigningPendingCount: 1,
      onchainPendingCount: 4,
      failedJobCount: 1
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

  it('lists recorded network fee receipts for ops tooling', async () => {
    const listNetworkFeeReceipts = vi.fn().mockResolvedValue({
      items: [
        {
          feeReceiptId: 'fee-1',
          referenceType: 'withdrawal',
          referenceId: 'wd-1',
          txHash: 'tx-1',
          currencyCode: 'TRX',
          feeSun: '1500000',
          feeAmount: '1.500000',
          energyUsed: 5000,
          bandwidthUsed: 350,
          confirmedAt: '2026-03-19T00:00:00.000Z',
          createdAt: '2026-03-19T00:00:00.000Z'
        }
      ],
      summary: {
        currencyCode: 'TRX',
        totalFeeSun: '1500000',
        totalFeeAmount: '1.500000',
        byReferenceType: {
          withdrawal: '1.500000',
          sweep: '0.000000'
        }
      }
    });
    const router = buildRouter({ listNetworkFeeReceipts });
    const routeLayer = router.stack.find(
      (layer: any) => layer.route?.path === '/network-fees' && layer.route.methods?.get
    );

    const req = {
      body: {},
      query: { referenceType: 'withdrawal', limit: '10' },
      params: {},
      method: 'GET',
      originalUrl: '/network-fees',
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

    expect(listNetworkFeeReceipts).toHaveBeenCalledWith({
      referenceType: 'withdrawal',
      limit: 10
    });
    expect(jsonBody).toMatchObject({
      items: [
        {
          feeReceiptId: 'fee-1',
          referenceType: 'withdrawal',
          feeAmount: '1.500000'
        }
      ],
      summary: {
        currencyCode: 'TRX',
        totalFeeAmount: '1.500000'
      }
    });
  });
});
