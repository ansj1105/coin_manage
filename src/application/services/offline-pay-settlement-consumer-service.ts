import { DomainError } from '../../core/domain-error.js';
import type { LedgerRepository } from '../ports/ledger-repository.js';
import { AlertService } from './alert-service.js';
import { OfflinePaySettlementCircuitBreaker } from './offline-pay-settlement-circuit-breaker.js';
import type { WithdrawService } from './withdraw-service.js';
import { computeOfflinePayProofFingerprint } from './offline-pay-proof-fingerprint.js';

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
  constructor(
    private readonly ledger: Pick<LedgerRepository, 'appendAuditLog'>,
    private readonly withdrawService?: Pick<WithdrawService, 'request' | 'confirmExternalAuth' | 'approve'>,
    private readonly alertService?: AlertService,
    private readonly circuitBreaker = new OfflinePaySettlementCircuitBreaker()
  ) {}

  async handle(input: OfflinePaySettlementFinalizedEvent) {
    if (!this.circuitBreaker.canExecute()) {
      throw new DomainError(
        503,
        'OFFLINE_PAY_CONSUMER_CIRCUIT_OPEN',
        'offline pay settlement consumer circuit is open',
        this.circuitBreaker.snapshot()
      );
    }

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

    let stage = 'withdraw.request';

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
      stage = 'withdraw.confirm_external_auth';
      await this.withdrawService.confirmExternalAuth(request.withdrawal.withdrawalId, {
        provider: 'offline_pay',
        requestId: input.proofFingerprint,
        actorId: 'offline_pay_consumer'
      });
      stage = 'withdraw.approve';
      await this.withdrawService.approve(request.withdrawal.withdrawalId, {
        adminId: 'offline_pay_consumer',
        actorType: 'system',
        reasonCode: 'ops_override',
        note: `offline pay settlement ${input.settlementId}`
      });

      const previousState = this.circuitBreaker.snapshot();
      const recovered = this.circuitBreaker.recordSuccess();
      if (recovered) {
        await this.alertService?.notifyOfflinePaySettlementCircuitRecovered({
          consecutiveFailures: previousState.consecutiveFailures
        });
      }
      await this.appendAudit(input, 'offline_pay.execution.withdraw_requested', {
        withdrawalId: request.withdrawal.withdrawalId,
        toAddress: input.toAddress
      });

      return {
        status: 'WITHDRAW_REQUESTED' as const,
        withdrawalId: request.withdrawal.withdrawalId
      };
    } catch (error) {
      const failureMessage = error instanceof Error ? error.message : 'unknown offline pay settlement failure';
      const failureState = this.circuitBreaker.recordFailure();
      await this.alertService?.notifyOfflinePaySettlementConsumerFailure({
        settlementId: input.settlementId,
        batchId: input.batchId,
        stage,
        reason: failureMessage
      });
      if (failureState.opened) {
        await this.alertService?.notifyOfflinePaySettlementCircuitOpened({
          consecutiveFailures: failureState.state.consecutiveFailures,
          cooldownRemainingMs: failureState.state.cooldownRemainingMs,
          reason: failureMessage
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

  getCircuitState() {
    return this.circuitBreaker.snapshot();
  }
}
