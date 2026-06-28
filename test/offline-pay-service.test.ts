import { describe, expect, it, vi } from 'vitest';
import { OfflinePayService } from '../src/application/services/offline-pay-service.js';
import { computeOfflinePayProofFingerprint } from '../src/application/services/offline-pay-proof-fingerprint.js';

describe('offline pay service', () => {
  it('reconciles stale foxya balance before locking offline pay collateral', async () => {
    const ledger = {
      getOfflinePayUserBalanceSnapshot: vi.fn().mockResolvedValue({
        userId: '1762',
        availableBalance: 0n,
        lockedBalance: 0n,
        liabilityBalance: 0n
      }),
      reconcileOfflinePayUserBalance: vi.fn().mockResolvedValue({
        userId: '1762',
        previousLiabilityBalance: 0n,
        targetLiabilityBalance: 300_000000n,
        deltaAmount: 300_000000n,
        adjusted: true
      }),
      hasOfflinePayLedgerFootprint: vi.fn().mockResolvedValue(false),
      lockOfflinePayCollateral: vi.fn().mockResolvedValue({
        lockId: 'topup:device-1:1',
        status: 'LOCKED',
        duplicated: false
      }),
      appendAuditLog: vi.fn().mockResolvedValue(undefined)
    };
    const walletSnapshotSource = {
      getCanonicalWalletSnapshot: vi.fn().mockResolvedValue({
        totalBalance: '300.000000',
        canonicalBasis: 'FOX_CLIENT_VISIBLE_TOTAL_KORI'
      })
    };
    const service = new OfflinePayService(ledger as any, walletSnapshotSource);

    await expect(service.lockCollateral({
      userId: '1762',
      deviceId: 'device-1',
      assetCode: 'KORI',
      amount: '1.000000',
      referenceId: 'topup:device-1:1',
      policyVersion: 1
    })).resolves.toEqual({
      lockId: 'topup:device-1:1',
      status: 'LOCKED'
    });

    expect(walletSnapshotSource.getCanonicalWalletSnapshot).toHaveBeenCalledWith({
      userId: '1762',
      currencyCode: 'KORI'
    });
    expect(ledger.reconcileOfflinePayUserBalance).toHaveBeenCalledWith(expect.objectContaining({
      userId: '1762',
      targetLiabilityBalance: 300_000000n,
      actorId: 'offline-pay-lock'
    }));
    expect(ledger.lockOfflinePayCollateral).toHaveBeenCalledWith(expect.objectContaining({
      userId: '1762',
      amount: 1_000000n
    }));
    expect(ledger.appendAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'offline_pay.user_balance.reconciled',
      actorId: 'offline-pay-lock'
    }));
  });

  it('does not credit available through lazy reconciliation for existing offline-pay ledger users', async () => {
    const ledger = {
      getOfflinePayUserBalanceSnapshot: vi.fn().mockResolvedValue({
        userId: '1761',
        availableBalance: 0n,
        lockedBalance: 85_000000n,
        liabilityBalance: 85_000000n
      }),
      hasOfflinePayLedgerFootprint: vi.fn().mockResolvedValue(true),
      reconcileOfflinePayUserBalance: vi.fn(),
      lockOfflinePayCollateral: vi.fn().mockRejectedValue(new Error('insufficient available')),
      appendAuditLog: vi.fn().mockResolvedValue(undefined)
    };
    const walletSnapshotSource = {
      getCanonicalWalletSnapshot: vi.fn().mockResolvedValue({
        totalBalance: '100.000000',
        canonicalBasis: 'FOX_CLIENT_VISIBLE_TOTAL_KORI'
      })
    };
    const service = new OfflinePayService(ledger as any, walletSnapshotSource);

    await expect(service.lockCollateral({
      userId: '1761',
      deviceId: 'device-1',
      assetCode: 'KORI',
      amount: '1.000000',
      referenceId: 'topup:device-1:existing',
      policyVersion: 1
    })).rejects.toThrow('insufficient available');

    expect(ledger.reconcileOfflinePayUserBalance).not.toHaveBeenCalled();
    expect(ledger.lockOfflinePayCollateral).toHaveBeenCalledOnce();
    expect(ledger.appendAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'offline_pay.user_balance.reconcile.skipped',
      actorId: 'offline-pay-lock',
      metadata: expect.objectContaining({
        userId: '1761',
        currentLiabilityBalance: '85.000000',
        targetLiabilityBalance: '100.000000',
        deltaAmount: '15.000000',
        reason: 'positive_delta_existing_offline_pay_ledger'
      })
    }));
  });

  it('does not reconcile before collateral lock when ledger available balance is sufficient', async () => {
    const ledger = {
      getOfflinePayUserBalanceSnapshot: vi.fn().mockResolvedValue({
        userId: '1761',
        availableBalance: 300_000000n,
        lockedBalance: 7_000000n,
        liabilityBalance: 307_000000n
      }),
      reconcileOfflinePayUserBalance: vi.fn(),
      lockOfflinePayCollateral: vi.fn().mockResolvedValue({
        lockId: 'topup:device-1:2',
        status: 'LOCKED',
        duplicated: false
      }),
      appendAuditLog: vi.fn().mockResolvedValue(undefined)
    };
    const walletSnapshotSource = {
      getCanonicalWalletSnapshot: vi.fn()
    };
    const service = new OfflinePayService(ledger as any, walletSnapshotSource);

    await service.lockCollateral({
      userId: '1761',
      deviceId: 'device-1',
      assetCode: 'KORI',
      amount: '1.000000',
      referenceId: 'topup:device-1:2',
      policyVersion: 1
    });

    expect(walletSnapshotSource.getCanonicalWalletSnapshot).not.toHaveBeenCalled();
    expect(ledger.reconcileOfflinePayUserBalance).not.toHaveBeenCalled();
    expect(ledger.lockOfflinePayCollateral).toHaveBeenCalledOnce();
  });

  it('returns the ledger available balance with the offline-pay pending balance snapshot', async () => {
    const ledger = {
      getOfflinePayUserBalanceSnapshot: vi.fn().mockResolvedValue({
        userId: '1761',
        availableBalance: 3_296700n,
        lockedBalance: 2_000000n,
        liabilityBalance: 5_296700n
      }),
      getOfflinePayPendingBalance: vi.fn().mockResolvedValue(2_000000n)
    };
    const service = new OfflinePayService(ledger as any);

    await expect(service.getPendingBalance({
      userId: '1761',
      assetCode: 'KORI'
    })).resolves.toEqual({
      status: 'OK',
      userId: '1761',
      assetCode: 'KORI',
      availableBalance: '3.296700',
      lockedBalance: '2.000000',
      offlinePayPendingBalance: '2.000000'
    });
  });

  it('ignores history sync compensation without touching ledger balances', async () => {
    const ledger = {
      getOfflinePayUserBalanceSnapshot: vi.fn().mockResolvedValue({
        userId: '1',
        availableBalance: 197_343487n,
        lockedBalance: 4_000000n,
        liabilityBalance: 201_343487n
      }),
      getOfflinePayPendingBalance: vi.fn().mockResolvedValue(4_000000n),
      compensateOfflinePaySettlement: vi.fn(),
      appendAuditLog: vi.fn()
    };
    const service = new OfflinePayService(ledger as any);

    await expect(service.compensateSettlement({
      settlementId: 'settlement-history-fail',
      batchId: 'batch-1',
      collateralId: 'collateral-1',
      proofId: 'proof-1',
      userId: '1',
      deviceId: 'device-1',
      assetCode: 'KORI',
      amount: '4.000000',
      releaseAction: 'ADJUST',
      proofFingerprint: 'f'.repeat(64),
      compensationReason: 'HISTORY_SYNC_FAIL'
    })).resolves.toEqual({
      status: 'OK',
      message: 'history sync compensation ignored',
      settlementId: 'settlement-history-fail',
      ledgerOutcome: 'COMPENSATED',
      releaseAction: 'ADJUST',
      duplicated: true,
      feeAmount: '0.000000',
      accountingSide: 'SENDER',
      receiverSettlementMode: 'EXTERNAL_HISTORY_SYNC',
      settlementModel: 'SENDER_LEDGER_PLUS_RECEIVER_HISTORY',
      reconciliationTrackingOwner: 'OFFLINE_PAY_SAGA',
      postAvailableBalance: '197.343487',
      postLockedBalance: '4.000000',
      postOfflinePayPendingBalance: '4.000000'
    });

    expect(ledger.compensateOfflinePaySettlement).not.toHaveBeenCalled();
    expect(ledger.appendAuditLog).not.toHaveBeenCalled();
  });

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
        assetCode: 'KORI',
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
        feeAmount: 600000n,
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
      receiverUserId: '39',
      receiverDeviceId: 'receiver-device-1',
      assetCode: 'KORI',
      amount: '150.000000',
      feeAmount: '0.600000',
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
      feeAmount: '0.600000',
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
        proofFingerprint,
        receiverUserId: '39',
        receiverDeviceId: 'receiver-device-1',
        feeAmount: 600000n
      })
    );
  });

  it('preserves omitted settlement fee so the ledger can compute it', async () => {
    const ledger = {
      finalizeOfflinePaySettlement: vi.fn().mockResolvedValue({
        settlementId: 'settlement-1',
        status: 'FINALIZED',
        ledgerOutcome: 'FINALIZED',
        releaseAction: 'RELEASE',
        duplicated: false,
        feeAmount: 600000n,
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

    await service.finalizeSettlement({
      settlementId: 'settlement-1',
      batchId: 'batch-1',
      collateralId: 'collateral-1',
      proofId: 'proof-1',
      userId: '77',
      deviceId: 'device-1',
      assetCode: 'KORI',
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

    expect(ledger.finalizeOfflinePaySettlement).toHaveBeenCalledWith(
      expect.not.objectContaining({
        feeAmount: expect.anything()
      })
    );
  });

  it('allows zero settlement fee for adjusted offline pay settlements', async () => {
    const ledger = {
      finalizeOfflinePaySettlement: vi.fn().mockResolvedValue({
        settlementId: 'settlement-adjust',
        status: 'FINALIZED',
        ledgerOutcome: 'FINALIZED',
        releaseAction: 'ADJUST',
        duplicated: false,
        feeAmount: 0n,
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
      settlementId: 'settlement-adjust',
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

    await service.finalizeSettlement({
      settlementId: 'settlement-adjust',
      batchId: 'batch-1',
      collateralId: 'collateral-1',
      proofId: 'proof-1',
      userId: '77',
      deviceId: 'device-1',
      assetCode: 'KORI',
      amount: '150.000000',
      feeAmount: '0.000000',
      settlementStatus: 'FAILED',
      releaseAction: 'ADJUST',
      conflictDetected: false,
      proofFingerprint,
      newStateHash: 'hash-1',
      previousHash: 'prev-1',
      monotonicCounter: 1,
      nonce: 'nonce-1',
      signature: 'signature-1'
    });

    expect(ledger.finalizeOfflinePaySettlement).toHaveBeenCalledWith(
      expect.objectContaining({
        settlementId: 'settlement-adjust',
        feeAmount: 0n
      })
    );
  });

  it('upserts offline pay device snapshots and writes an audit log', async () => {
    const ledger = {
      upsertOfflinePayDevice: vi.fn().mockResolvedValue(undefined),
      appendAuditLog: vi.fn().mockResolvedValue(undefined)
    };
    const service = new OfflinePayService(ledger as any);

    const result = await service.upsertDevice({
      userId: '39',
      deviceId: 'device-1',
      status: 'ACTIVE',
      keyVersion: 2,
      lastSeenAt: '2026-05-19T00:00:00.000Z'
    });

    expect(result).toEqual({
      status: 'OK',
      deviceId: 'device-1'
    });
    expect(ledger.upsertOfflinePayDevice).toHaveBeenCalledWith({
      userId: '39',
      deviceId: 'device-1',
      status: 'ACTIVE',
      keyVersion: 2,
      lastSeenAt: '2026-05-19T00:00:00.000Z'
    });
    expect(ledger.appendAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'offline_pay.device.synced',
      entityId: 'device-1'
    }));
  });
});
