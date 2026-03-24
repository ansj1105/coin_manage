import { describe, expect, it, vi } from 'vitest';
import { OfflinePaySettlementConsumerService } from '../src/application/services/offline-pay-settlement-consumer-service.js';
import { OfflinePaySettlementCircuitBreaker } from '../src/application/services/offline-pay-settlement-circuit-breaker.js';
import { computeOfflinePayProofFingerprint } from '../src/application/services/offline-pay-proof-fingerprint.js';

const baseEvent = () => {
  const event = {
    settlementId: 'settlement-1',
    batchId: 'batch-1',
    collateralId: 'collateral-1',
    proofId: 'proof-1',
    userId: '77',
    deviceId: 'device-1',
    assetCode: 'USDT',
    amount: '150.000000',
    settlementStatus: 'SETTLED',
    releaseAction: 'RELEASE' as const,
    conflictDetected: false,
    newStateHash: 'hash-1',
    previousHash: 'prev-1',
    monotonicCounter: 1,
    nonce: 'nonce-1',
    signature: 'signature-1'
  };
  return {
    ...event,
    proofFingerprint: computeOfflinePayProofFingerprint(event)
  };
};

describe('offline pay settlement consumer service', () => {
  it('rejects execution when proof fingerprint mismatches', async () => {
    const ledger = { appendAuditLog: vi.fn() };
    const service = new OfflinePaySettlementConsumerService(ledger as any);

    await expect(
      service.handle({
        ...baseEvent(),
        proofFingerprint: '0'.repeat(64)
      })
    ).rejects.toMatchObject({
      code: 'OFFLINE_PAY_EXECUTION_FINGERPRINT_MISMATCH'
    });
  });

  it('keeps settlement internal-only when withdraw target is missing', async () => {
    const ledger = { appendAuditLog: vi.fn().mockResolvedValue(undefined) };
    const service = new OfflinePaySettlementConsumerService(ledger as any);

    const result = await service.handle(baseEvent());

    expect(result).toEqual({
      status: 'INTERNAL_ONLY',
      mode: 'missing_withdraw_target'
    });
    expect(ledger.appendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'offline_pay.execution.internal_only'
      })
    );
  });

  it('opens the circuit after repeated downstream failures and short-circuits subsequent attempts', async () => {
    const ledger = { appendAuditLog: vi.fn().mockResolvedValue(undefined) };
    const alertService = {
      notifyOfflinePaySettlementConsumerFailure: vi.fn().mockResolvedValue(undefined),
      notifyOfflinePaySettlementCircuitOpened: vi.fn().mockResolvedValue(undefined),
      notifyOfflinePaySettlementCircuitRecovered: vi.fn().mockResolvedValue(undefined),
      notifyOfflinePaySettlementDeadLetter: vi.fn().mockResolvedValue(undefined)
    };
    const withdrawService = {
      request: vi.fn().mockRejectedValue(new Error('temporary downstream failure')),
      confirmExternalAuth: vi.fn(),
      approve: vi.fn()
    };
    const circuitBreaker = new OfflinePaySettlementCircuitBreaker({
      failureThreshold: 2,
      openCooldownMs: 60_000
    });
    const service = new OfflinePaySettlementConsumerService(
      ledger as any,
      withdrawService as any,
      alertService as any,
      circuitBreaker
    );

    await expect(service.handle({ ...baseEvent(), toAddress: 'TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' })).rejects.toThrow(
      'temporary downstream failure'
    );
    await expect(service.handle({ ...baseEvent(), toAddress: 'TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' })).rejects.toThrow(
      'temporary downstream failure'
    );
    await expect(service.handle({ ...baseEvent(), toAddress: 'TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' })).rejects.toMatchObject({
      code: 'OFFLINE_PAY_CONSUMER_CIRCUIT_OPEN'
    });

    expect(withdrawService.request).toHaveBeenCalledTimes(2);
    expect(alertService.notifyOfflinePaySettlementConsumerFailure).toHaveBeenCalledTimes(2);
    expect(alertService.notifyOfflinePaySettlementCircuitOpened).toHaveBeenCalledTimes(1);
    expect(alertService.notifyOfflinePaySettlementDeadLetter).not.toHaveBeenCalled();
  });

  it('emits a recovery alert after the circuit cools down and the chain succeeds again', async () => {
    const ledger = { appendAuditLog: vi.fn().mockResolvedValue(undefined) };
    const alertService = {
      notifyOfflinePaySettlementConsumerFailure: vi.fn().mockResolvedValue(undefined),
      notifyOfflinePaySettlementCircuitOpened: vi.fn().mockResolvedValue(undefined),
      notifyOfflinePaySettlementCircuitRecovered: vi.fn().mockResolvedValue(undefined),
      notifyOfflinePaySettlementDeadLetter: vi.fn().mockResolvedValue(undefined)
    };
    const withdrawService = {
      request: vi
        .fn()
        .mockRejectedValueOnce(new Error('temporary downstream failure'))
        .mockResolvedValueOnce({
          withdrawal: {
            withdrawalId: 'withdraw-1'
          }
        }),
      confirmExternalAuth: vi.fn().mockResolvedValue(undefined),
      approve: vi.fn().mockResolvedValue(undefined)
    };
    const circuitBreaker = new OfflinePaySettlementCircuitBreaker({
      failureThreshold: 1,
      openCooldownMs: 1_000
    });
    const service = new OfflinePaySettlementConsumerService(
      ledger as any,
      withdrawService as any,
      alertService as any,
      circuitBreaker
    );
    const now = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, 'now');
    try {
      nowSpy.mockReturnValue(now);

      await expect(service.handle({ ...baseEvent(), toAddress: 'TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' })).rejects.toThrow(
        'temporary downstream failure'
      );

      nowSpy.mockReturnValue(now + 2_000);
      const result = await service.handle({ ...baseEvent(), toAddress: 'TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' });

      expect(result).toEqual({
        status: 'WITHDRAW_REQUESTED',
        withdrawalId: 'withdraw-1'
      });
      expect(alertService.notifyOfflinePaySettlementCircuitOpened).toHaveBeenCalledTimes(1);
      expect(alertService.notifyOfflinePaySettlementCircuitRecovered).toHaveBeenCalledWith({
        consecutiveFailures: 1
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('routes to existing withdraw entry when target address is present', async () => {
    const ledger = { appendAuditLog: vi.fn().mockResolvedValue(undefined) };
    const withdrawService = {
      request: vi.fn().mockResolvedValue({
        withdrawal: {
          withdrawalId: 'withdraw-1'
        }
      }),
      confirmExternalAuth: vi.fn().mockResolvedValue(undefined),
      approve: vi.fn().mockResolvedValue(undefined)
    };
    const service = new OfflinePaySettlementConsumerService(ledger as any, withdrawService as any);

    const result = await service.handle({
      ...baseEvent(),
      toAddress: 'TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
    });

    expect(result).toEqual({
      status: 'WITHDRAW_REQUESTED',
      withdrawalId: 'withdraw-1'
    });
    expect(withdrawService.request).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: '77',
        amountKori: 150,
        toAddress: 'TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        idempotencyKey: 'offline-pay:settlement-1',
        deviceId: 'device-1'
      })
    );
    expect(withdrawService.confirmExternalAuth).toHaveBeenCalledWith('withdraw-1', {
      provider: 'offline_pay',
      requestId: baseEvent().proofFingerprint,
      actorId: 'offline_pay_consumer'
    });
    expect(withdrawService.approve).toHaveBeenCalledWith('withdraw-1', {
      adminId: 'offline_pay_consumer',
      actorType: 'system',
      reasonCode: 'ops_override',
      note: 'offline pay settlement settlement-1'
    });
  });

  it('opens circuit and alerts when withdraw execution keeps failing', async () => {
    const ledger = { appendAuditLog: vi.fn().mockResolvedValue(undefined) };
    const alertService = {
      notifyOfflinePaySettlementConsumerFailure: vi.fn().mockResolvedValue(undefined),
      notifyOfflinePaySettlementCircuitOpened: vi.fn().mockResolvedValue(undefined),
      notifyOfflinePaySettlementCircuitRecovered: vi.fn().mockResolvedValue(undefined),
      notifyOfflinePaySettlementDeadLetter: vi.fn().mockResolvedValue(undefined)
    };
    const withdrawService = {
      request: vi.fn().mockRejectedValue(new Error('withdraw request failed')),
      confirmExternalAuth: vi.fn(),
      approve: vi.fn()
    };
    const circuit = new OfflinePaySettlementCircuitBreaker({
      failureThreshold: 1,
      openCooldownMs: 60_000
    });
    const service = new OfflinePaySettlementConsumerService(
      ledger as any,
      withdrawService as any,
      alertService as any,
      circuit
    );

    await expect(
      service.handle({
        ...baseEvent(),
        toAddress: 'TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
      })
    ).rejects.toThrow('withdraw request failed');

    expect(alertService.notifyOfflinePaySettlementConsumerFailure).toHaveBeenCalledOnce();
    expect(alertService.notifyOfflinePaySettlementCircuitOpened).toHaveBeenCalledOnce();
    expect(circuit.snapshot().open).toBe(true);
  });

  it('records blocked execution when circuit is already open', async () => {
    const ledger = { appendAuditLog: vi.fn().mockResolvedValue(undefined) };
    const alertService = {
      notifyOfflinePaySettlementConsumerFailure: vi.fn().mockResolvedValue(undefined),
      notifyOfflinePaySettlementCircuitOpened: vi.fn().mockResolvedValue(undefined),
      notifyOfflinePaySettlementCircuitRecovered: vi.fn().mockResolvedValue(undefined),
      notifyOfflinePaySettlementDeadLetter: vi.fn().mockResolvedValue(undefined)
    };
    const withdrawService = {
      request: vi.fn(),
      confirmExternalAuth: vi.fn(),
      approve: vi.fn()
    };
    const circuit = {
      canExecute: vi.fn(() => false),
      recordFailure: vi.fn(() => ({
        opened: false,
        state: {
          open: true,
          consecutiveFailures: 1,
          cooldownRemainingMs: 60_000
        }
      })),
      recordSuccess: vi.fn(),
      snapshot: vi.fn(() => ({
        open: true,
        consecutiveFailures: 1,
        cooldownRemainingMs: 60_000
      }))
    };
    const service = new OfflinePaySettlementConsumerService(
      ledger as any,
      withdrawService as any,
      alertService as any,
      circuit as any
    );

    await expect(
      service.handle({
        ...baseEvent(),
        toAddress: 'TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
      })
    ).rejects.toMatchObject({
      code: 'OFFLINE_PAY_CONSUMER_CIRCUIT_OPEN'
    });

    expect(ledger.appendAuditLog).not.toHaveBeenCalled();
    expect(alertService.notifyOfflinePaySettlementConsumerFailure).not.toHaveBeenCalled();
    expect(withdrawService.request).not.toHaveBeenCalled();
  });
});
