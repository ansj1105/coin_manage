import { describe, expect, it, vi } from 'vitest';
import { OfflinePayService } from '../src/application/services/offline-pay-service.js';
import { computeOfflinePayProofFingerprint } from '../src/application/services/offline-pay-proof-fingerprint.js';

describe('offline pay service', () => {
  it('rejects settlement finalization when proof fingerprint mismatches', async () => {
    const ledger = {
      finalizeOfflinePaySettlement: vi.fn(),
      appendAuditLog: vi.fn()
    };
    const service = new OfflinePayService(ledger as any);

    await expect(
      service.finalizeSettlement({
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
        proofFingerprint: '0'.repeat(64),
        newStateHash: 'hash-1',
        previousHash: 'prev-1',
        monotonicCounter: 1,
        nonce: 'nonce-1',
        signature: 'signature-1'
      })
    ).rejects.toMatchObject({
      code: 'OFFLINE_PAY_PROOF_FINGERPRINT_MISMATCH'
    });

    expect(ledger.finalizeOfflinePaySettlement).not.toHaveBeenCalled();
  });

  it('passes settlement finalization when proof fingerprint matches', async () => {
    const ledger = {
      finalizeOfflinePaySettlement: vi.fn().mockResolvedValue({
        settlementId: 'settlement-1',
        status: 'FINALIZED',
        releaseAction: 'RELEASE',
        duplicated: false
      }),
      appendAuditLog: vi.fn().mockResolvedValue(undefined)
    };
    const service = new OfflinePayService(ledger as any);

    const proofFingerprint = computeOfflinePayProofFingerprint({
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
    });

    const result = await service.finalizeSettlement({
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
      proofFingerprint,
      newStateHash: 'hash-1',
      previousHash: 'prev-1',
      monotonicCounter: 1,
      nonce: 'nonce-1',
      signature: 'signature-1'
    });

    expect(result).toEqual({
      status: 'OK',
      message: 'settlement finalized'
    });
    expect(ledger.finalizeOfflinePaySettlement).toHaveBeenCalledOnce();
  });
});
