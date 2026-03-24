import { DomainError } from '../../core/domain-error.js';
import type { LedgerRepository } from '../ports/ledger-repository.js';
import type { AlertService } from './alert-service.js';
import type { WithdrawService } from './withdraw-service.js';
import { computeOfflinePayProofFingerprint } from './offline-pay-proof-fingerprint.js';
import { SimpleCircuitBreaker } from './simple-circuit-breaker.js';

export interface OfflinePaySettlementFinalizedEvent {
  settlementId: string;
  batchId: string;
  collateralId: string;
  proofId: string;
  proofFingerprint: string;
  userId: string;
  deviceId: string;
  assetCode: string;
  amount: string;
  settlementStatus: string;
  releaseAction: 'RELEASE' | 'ADJUST';
  conflictDetected: boolean;
  newStateHash: string;
  previousHash: string;
  monotonicCounter: number;
  nonce: string;
  signature: string;
  occurredAt?: string;
  toAddress?: string;
  clientIp?: string;
  network?: string;
  networkMode?: string;
}

export class OfflinePaySettlementConsumerService {
  private readonly withdrawalCircuit: SimpleCircuitBreaker;

  constructor(
    private readonly ledger: Pick<LedgerRepository, 'appendAuditLog'>,
    private readonly withdrawService?: Pick<WithdrawService, 'request' | 'confirmExternalAuth' | 'approve'>,
    private readonly alertService?: Pick<
      AlertService,
      'notifyOfflinePayCircuitOpened' | 'notifyOfflinePayCircuitRecovered' | 'notifyOfflinePayExecutionFailure'
    >,
    withdrawalCircuit?: SimpleCircuitBreaker
  ) {
    this.withdrawalCircuit = withdrawalCircuit ?? new SimpleCircuitBreaker('offline_pay_withdrawal_execution');
  }

  async handle(input: OfflinePaySettlementFinalizedEvent) {
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
        'OFFLINE_PAY_EXECUTION_FINGERPRINT_MISMATCH',
        'offline pay settlement execution fingerprint mismatch'
      );
    }

    if (input.settlementStatus !== 'SETTLED' || input.releaseAction !== 'RELEASE' || input.conflictDetected) {
      await this.appendAudit(input, 'offline_pay.execution.skipped', {
        reason: 'non_dispatchable_settlement'
      });
      return { status: 'SKIPPED' as const, mode: 'non_dispatchable_settlement' as const };
    }

    if (!input.toAddress) {
      await this.appendAudit(input, 'offline_pay.execution.internal_only', {
        reason: 'missing_withdraw_target'
      });
      return { status: 'INTERNAL_ONLY' as const, mode: 'missing_withdraw_target' as const };
    }

    if (!this.withdrawService) {
      await this.appendAudit(input, 'offline_pay.execution.internal_only', {
        reason: 'withdraw_service_unavailable'
      });
      return { status: 'INTERNAL_ONLY' as const, mode: 'withdraw_service_unavailable' as const };
    }

    try {
      this.withdrawalCircuit.assertCallable();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'offline pay execution circuit is open';
      await this.appendAudit(input, 'offline_pay.execution.blocked', {
        reason: message
      });
      await this.alertService?.notifyOfflinePayExecutionFailure({
        settlementId: input.settlementId,
        proofId: input.proofId,
        message
      });
      throw error;
    }

    try {
      const amountKori = Number(input.amount);
      const request = await this.withdrawService.request({
        userId: input.userId,
        amountKori,
        toAddress: input.toAddress,
        idempotencyKey: `offline-pay:${input.settlementId}`,
        clientIp: input.clientIp,
        deviceId: input.deviceId
      });
      await this.withdrawService.confirmExternalAuth(request.withdrawal.withdrawalId, {
        provider: 'offline_pay',
        requestId: input.proofFingerprint,
        actorId: 'offline_pay_consumer'
      });
      await this.withdrawService.approve(request.withdrawal.withdrawalId, {
        adminId: 'offline_pay_consumer',
        actorType: 'system',
        reasonCode: 'ops_override',
        note: `offline pay settlement ${input.settlementId}`
      });

      const recovered = this.withdrawalCircuit.onSuccess();
      await this.appendAudit(input, 'offline_pay.execution.withdraw_requested', {
        withdrawalId: request.withdrawal.withdrawalId,
        toAddress: input.toAddress
      });
      if (recovered) {
        await this.alertService?.notifyOfflinePayCircuitRecovered({
          circuitName: 'offline_pay_withdrawal_execution',
          settlementId: input.settlementId,
          message: 'withdraw execution resumed'
        });
      }

      return {
        status: 'WITHDRAW_REQUESTED' as const,
        withdrawalId: request.withdrawal.withdrawalId
      };
    } catch (error) {
      const opened = this.withdrawalCircuit.onFailure();
      const message = error instanceof Error ? error.message : 'offline pay execution failed';
      await this.appendAudit(input, 'offline_pay.execution.failed', {
        reason: message
      });
      await this.alertService?.notifyOfflinePayExecutionFailure({
        settlementId: input.settlementId,
        proofId: input.proofId,
        message
      });
      if (opened || this.withdrawalCircuit.state === 'OPEN') {
        await this.alertService?.notifyOfflinePayCircuitOpened({
          circuitName: 'offline_pay_withdrawal_execution',
          settlementId: input.settlementId,
          failureCount: this.withdrawalCircuit.failureCount,
          message
        });
      }
      throw error;
    }
  }

  private async appendAudit(
    input: OfflinePaySettlementFinalizedEvent,
    action: string,
    extra: Record<string, string>
  ) {
    await this.ledger.appendAuditLog({
      entityType: 'system',
      entityId: input.settlementId,
      action,
      actorType: 'system',
      actorId: 'offline_pay_consumer',
      metadata: {
        settlementId: input.settlementId,
        batchId: input.batchId,
        proofId: input.proofId,
        proofFingerprint: input.proofFingerprint,
        deviceId: input.deviceId,
        userId: input.userId,
        assetCode: input.assetCode,
        ...extra
      }
    });
  }
}
