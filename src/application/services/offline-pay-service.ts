import { formatKoriAmount, parseKoriAmount } from '../../domain/value-objects/money.js';
import { DomainError } from '../../core/domain-error.js';
import type { LedgerRepository } from '../ports/ledger-repository.js';
import { computeOfflinePayProofFingerprint } from './offline-pay-proof-fingerprint.js';

export class OfflinePayService {
  constructor(private readonly ledger: LedgerRepository) {}

  async lockCollateral(input: {
    userId: string;
    deviceId: string;
    assetCode: string;
    amount: string;
    referenceId: string;
    policyVersion: number;
  }) {
    const amount = parseKoriAmount(Number(input.amount));
    const result = await this.ledger.lockOfflinePayCollateral({
      userId: input.userId,
      deviceId: input.deviceId,
      assetCode: input.assetCode,
      amount,
      referenceId: input.referenceId,
      policyVersion: input.policyVersion
    });

    if (!result.duplicated) {
      await this.ledger.appendAuditLog({
        entityType: 'system',
        entityId: result.lockId,
        action: 'offline_pay.collateral.locked',
        actorType: 'system',
        actorId: 'offline_pay',
        metadata: {
          userId: input.userId,
          deviceId: input.deviceId,
          assetCode: input.assetCode,
          amount: formatKoriAmount(amount),
          policyVersion: String(input.policyVersion),
          referenceId: input.referenceId
        }
      });
    }

    return {
      lockId: result.lockId,
      status: result.status
    };
  }

  async releaseCollateral(input: {
    userId: string;
    deviceId: string;
    collateralId: string;
    assetCode: string;
    amount: string;
    referenceId: string;
  }) {
    const amount = parseKoriAmount(Number(input.amount));
    const result = await this.ledger.releaseOfflinePayCollateral({
      userId: input.userId,
      deviceId: input.deviceId,
      collateralId: input.collateralId,
      assetCode: input.assetCode,
      amount,
      referenceId: input.referenceId
    });

    if (!result.duplicated) {
      await this.ledger.appendAuditLog({
        entityType: 'system',
        entityId: result.releaseId,
        action: 'offline_pay.collateral.released',
        actorType: 'system',
        actorId: 'offline_pay',
        metadata: {
          userId: input.userId,
          deviceId: input.deviceId,
          collateralId: input.collateralId,
          assetCode: input.assetCode,
          amount: formatKoriAmount(amount),
          referenceId: input.referenceId
        }
      });
    }

    return {
      releaseId: result.releaseId,
      status: result.status
    };
  }

  async finalizeSettlement(input: {
    settlementId: string;
    batchId: string;
    collateralId: string;
    proofId: string;
    userId: string;
    deviceId: string;
    assetCode: string;
    amount: string;
    settlementStatus: string;
    releaseAction: 'RELEASE' | 'ADJUST';
    conflictDetected: boolean;
    proofFingerprint: string;
    newStateHash: string;
    previousHash: string;
    monotonicCounter: number;
    nonce: string;
    signature: string;
  }) {
    // This step finalizes an internal-ledger transfer request only.
    // Real chain execution must later enter the existing online withdraw flow.
    const computedFingerprint = computeOfflinePayProofFingerprint({
      settlementId: input.settlementId,
      batchId: input.batchId,
      collateralId: input.collateralId,
      proofId: input.proofId,
      deviceId: input.deviceId,
      newStateHash: input.newStateHash,
      previousHash: input.previousHash,
      monotonicCounter: input.monotonicCounter,
      nonce: input.nonce,
      signature: input.signature
    });
    if (computedFingerprint !== input.proofFingerprint) {
      throw new DomainError(
        409,
        'OFFLINE_PAY_PROOF_FINGERPRINT_MISMATCH',
        'offline pay proof fingerprint mismatch'
      );
    }

    const amount = parseKoriAmount(Number(input.amount));
    const result = await this.ledger.finalizeOfflinePaySettlement({
      ...input,
      amount
    });

    if (!result.duplicated) {
      await this.ledger.appendAuditLog({
        entityType: 'system',
        entityId: input.settlementId,
        action: 'offline_pay.settlement.finalized',
        actorType: 'system',
        actorId: 'offline_pay',
        metadata: {
          batchId: input.batchId,
          collateralId: input.collateralId,
          proofId: input.proofId,
          userId: input.userId,
          deviceId: input.deviceId,
          assetCode: input.assetCode,
          amount: formatKoriAmount(amount),
          settlementStatus: input.settlementStatus,
          releaseAction: input.releaseAction,
          conflictDetected: String(input.conflictDetected),
          proofFingerprint: input.proofFingerprint,
          newStateHash: input.newStateHash,
          previousHash: input.previousHash,
          monotonicCounter: String(input.monotonicCounter)
        }
      });
    }

    return {
      status: 'OK' as const,
      message: result.releaseAction === 'RELEASE' ? 'settlement finalized' : 'settlement adjusted',
      settlementId: result.settlementId,
      ledgerOutcome: result.ledgerOutcome,
      releaseAction: result.releaseAction,
      duplicated: result.duplicated,
      accountingSide: result.accountingSide,
      receiverSettlementMode: result.receiverSettlementMode,
      postAvailableBalance: formatKoriAmount(result.postAvailableBalance),
      postLockedBalance: formatKoriAmount(result.postLockedBalance),
      postOfflinePayPendingBalance: formatKoriAmount(result.postOfflinePayPendingBalance)
    };
  }

  async compensateSettlement(input: {
    settlementId: string;
    batchId: string;
    collateralId: string;
    proofId: string;
    userId: string;
    deviceId: string;
    assetCode: string;
    amount: string;
    releaseAction: 'RELEASE' | 'ADJUST';
    proofFingerprint: string;
    compensationReason: string;
  }) {
    const amount = parseKoriAmount(Number(input.amount));
    const result = await this.ledger.compensateOfflinePaySettlement({
      ...input,
      amount
    });

    if (!result.duplicated) {
      await this.ledger.appendAuditLog({
        entityType: 'system',
        entityId: input.settlementId,
        action: 'offline_pay.settlement.compensated',
        actorType: 'system',
        actorId: 'offline_pay',
        metadata: {
          batchId: input.batchId,
          collateralId: input.collateralId,
          proofId: input.proofId,
          userId: input.userId,
          deviceId: input.deviceId,
          assetCode: input.assetCode,
          amount: formatKoriAmount(amount),
          releaseAction: input.releaseAction,
          proofFingerprint: input.proofFingerprint,
          compensationReason: input.compensationReason
        }
      });
    }

    return {
      status: 'OK' as const,
      message: 'settlement compensated',
      settlementId: result.settlementId,
      ledgerOutcome: result.ledgerOutcome,
      releaseAction: result.releaseAction,
      duplicated: result.duplicated,
      accountingSide: result.accountingSide,
      receiverSettlementMode: result.receiverSettlementMode,
      postAvailableBalance: formatKoriAmount(result.postAvailableBalance),
      postLockedBalance: formatKoriAmount(result.postLockedBalance),
      postOfflinePayPendingBalance: formatKoriAmount(result.postOfflinePayPendingBalance)
    };
  }
}
