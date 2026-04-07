import { describe, expect, it, vi } from 'vitest';
import { OfflinePayService } from '../src/application/services/offline-pay-service.js';
import { computeOfflinePayProofFingerprint } from '../src/application/services/offline-pay-proof-fingerprint.js';

describe('offline pay service', () => {
  it('releases collateral through ledger and returns release metadata', async () => {
    const ledger = {
      releaseOfflinePayCollateral: vi.fn().mockResolvedValue({
        releaseId: 'release:collateral-1',
        status: 'RELEASED',
        duplicated: false
      }),
      appendAuditLog: vi.fn().mockResolvedValue(undefined)
    };
    const service = new OfflinePayService(ledger as any);

    const result = await service.releaseCollateral({
      userId: '77',
      deviceId: 'device-1',
      collateralId: 'collateral-1',
      assetCode: 'KORI',
      amount: '150.000000',
      referenceId: 'release:collateral-1'
    });

    expect(result).toEqual({
      releaseId: 'release:collateral-1',
      status: 'RELEASED'
    });
    expect(ledger.releaseOfflinePayCollateral).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: '77',
        deviceId: 'device-1',
        collateralId: 'collateral-1',
        assetCode: 'KORI',
        referenceId: 'release:collateral-1'
      })
    );
  });

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
        ledgerOutcome: 'FINALIZED',
        releaseAction: 'RELEASE',
        duplicated: false,
        accountingSide: 'SENDER',
        receiverSettlementMode: 'EXTERNAL_HISTORY_SYNC',
        settlementModel: 'SENDER_LEDGER_PLUS_RECEIVER_HISTORY',
        reconciliationTrackingOwner: 'OFFLINE_PAY_SAGA',
        postAvailableBalance: 10_000000n,
        postLockedBalance: 140_000000n,
        postOfflinePayPendingBalance: 140_000000n
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
      message: 'settlement finalized',
      settlementId: 'settlement-1',
      ledgerOutcome: 'FINALIZED',
      releaseAction: 'RELEASE',
      duplicated: false,
      accountingSide: 'SENDER',
      receiverSettlementMode: 'EXTERNAL_HISTORY_SYNC',
      settlementModel: 'SENDER_LEDGER_PLUS_RECEIVER_HISTORY',
      reconciliationTrackingOwner: 'OFFLINE_PAY_SAGA',
      postAvailableBalance: '10.000000',
      postLockedBalance: '140.000000',
      postOfflinePayPendingBalance: '140.000000'
    });
    expect(ledger.finalizeOfflinePaySettlement).toHaveBeenCalledOnce();
    expect(ledger.finalizeOfflinePaySettlement).toHaveBeenCalledWith(
      expect.objectContaining({
        settlementId: 'settlement-1',
        proofId: 'proof-1',
        proofFingerprint
      })
    );
  });
});
