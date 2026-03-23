import { describe, expect, it, vi } from 'vitest';
import { OfflinePaySettlementConsumerService } from '../src/application/services/offline-pay-settlement-consumer-service.js';
import { computeOfflinePayProofFingerprint } from '../src/application/services/offline-pay-proof-fingerprint.js';
import { SimpleCircuitBreaker } from '../src/application/services/simple-circuit-breaker.js';

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
      notifyOfflinePayExecutionFailure: vi.fn().mockResolvedValue(undefined),
      notifyOfflinePayCircuitOpened: vi.fn().mockResolvedValue(undefined)
    };
    const withdrawService = {
      request: vi.fn().mockRejectedValue(new Error('withdraw request failed')),
      confirmExternalAuth: vi.fn(),
      approve: vi.fn()
    };
    const circuit = new SimpleCircuitBreaker('offline_pay_withdrawal_execution', 1, 60_000);
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

    expect(alertService.notifyOfflinePayExecutionFailure).toHaveBeenCalledOnce();
    expect(alertService.notifyOfflinePayCircuitOpened).toHaveBeenCalledOnce();
    expect(circuit.state).toBe('OPEN');
  });
});
