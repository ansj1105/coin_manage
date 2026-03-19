import { formatKoriAmount, parseKoriAmount } from '../../domain/value-objects/money.js';
import { buildWithdrawalStateChangedContract, type WithdrawalStateChangedContract } from '../../contracts/ledger-contracts.js';
import type { WithdrawBridgeStateResponseContract } from '../../contracts/withdraw-bridge-contracts.js';
import { env } from '../../config/env.js';
import type { EventPublisher } from '../ports/event-publisher.js';
import type { WithdrawJobQueue } from '../ports/withdraw-job-queue.js';
import type { LedgerRepository } from '../ports/ledger-repository.js';
import type { TronGateway } from '../ports/tron-gateway.js';
import type { WithdrawalSigner } from '../ports/withdrawal-signer.js';
import type { ExternalWithdrawalSyncClient } from '../ports/external-withdrawal-sync-client.js';
import { AlertService } from './alert-service.js';
import type { VirtualWalletLifecyclePolicyService } from './virtual-wallet-lifecycle-policy-service.js';
import { WithdrawGuardService } from './withdraw-guard-service.js';
import type { WithdrawPolicyService } from './withdraw-policy-service.js';
import { mapWithdrawalToSyncStatus } from '../../domain/ledger/withdraw-sync-status.js';
import { DomainError } from '../../domain/errors/domain-error.js';

export class WithdrawService {
  constructor(
    private readonly ledger: LedgerRepository,
    private readonly eventPublisher: EventPublisher,
    private readonly tronGateway: TronGateway,
    private readonly alertService: AlertService,
    private readonly withdrawJobQueue: WithdrawJobQueue,
    private readonly virtualWalletLifecyclePolicy?: VirtualWalletLifecyclePolicyService,
    private readonly withdrawGuardService = new WithdrawGuardService(tronGateway),
    private readonly withdrawPolicyService?: WithdrawPolicyService,
    private readonly externalWithdrawalSyncClient?: ExternalWithdrawalSyncClient,
    private readonly withdrawalSigner?: WithdrawalSigner
  ) {}

  async request(input: {
    userId?: string;
    walletAddress?: string;
    amountKori: number;
    toAddress: string;
    idempotencyKey: string;
    clientIp?: string;
    deviceId?: string;
  }) {
    const userId = await this.ledger.resolveUserId({
      userId: input.userId,
      walletAddress: input.walletAddress
    });
    await this.virtualWalletLifecyclePolicy?.assertWithdrawalAllowed({
      userId,
      walletAddress: input.walletAddress
    });
    await this.withdrawGuardService.assertRequestAllowed({
      toAddress: input.toAddress,
      walletAddress: input.walletAddress,
      amount: parseKoriAmount(input.amountKori)
    });
    const riskAssessment = await this.assessRisk({
      userId,
      amountKori: input.amountKori,
      toAddress: input.toAddress,
      clientIp: input.clientIp,
      deviceId: input.deviceId
    });
    const result = await this.ledger.requestWithdrawal({
      userId,
      amount: parseKoriAmount(input.amountKori),
      toAddress: input.toAddress,
      idempotencyKey: input.idempotencyKey,
      riskLevel: riskAssessment.level,
      riskScore: riskAssessment.score,
      riskFlags: riskAssessment.flags,
      requiredApprovals: riskAssessment.requiredApprovals,
      clientIp: input.clientIp,
      deviceId: input.deviceId
    });

    if (!result.duplicated) {
      await this.publishWithdrawalStateChange(result.withdrawal, result.withdrawal.createdAt);
      await this.ledger.appendAuditLog({
        entityType: 'withdrawal',
        entityId: result.withdrawal.withdrawalId,
        action: 'withdraw.requested',
        actorType: 'user',
        actorId: userId,
        metadata: {
          riskLevel: result.withdrawal.riskLevel,
          riskScore: result.withdrawal.riskScore.toString(),
          requiredApprovals: result.withdrawal.requiredApprovals.toString(),
          clientIp: input.clientIp ?? '',
          deviceId: input.deviceId ?? ''
        }
      });
      await this.alertService.notifyWithdrawalRequested({
        withdrawalId: result.withdrawal.withdrawalId,
        userId,
        amount: formatKoriAmount(result.withdrawal.amount),
        toAddress: result.withdrawal.toAddress,
        riskLevel: result.withdrawal.riskLevel,
        requiredApprovals: result.withdrawal.requiredApprovals
      });
    }

    return result;
  }

  async confirmExternalAuth(
    withdrawalId: string,
    input: { provider: string; requestId: string; actorId?: string }
  ) {
    const updated = await this.ledger.confirmWithdrawalExternalAuth(withdrawalId, {
      provider: input.provider,
      requestId: input.requestId
    });
    await this.publishWithdrawalStateChange(updated, new Date().toISOString());
    await this.ledger.appendAuditLog({
      entityType: 'withdrawal',
      entityId: withdrawalId,
      action: 'withdraw.external_auth.confirmed',
      actorType: 'system',
      actorId: input.actorId ?? input.provider,
      metadata: {
        provider: input.provider,
        requestId: input.requestId
      }
    });
    return updated;
  }

  async approve(
    withdrawalId: string,
    input: {
      adminId?: string;
      actorType?: 'admin' | 'system';
      reasonCode?:
        | 'manual_review_passed'
        | 'high_value_verified'
        | 'trusted_destination_verified'
        | 'account_activity_verified'
        | 'ops_override';
      note?: string;
    } = {}
  ) {
    const reasonCode = input.reasonCode ?? 'manual_review_passed';
    const result = await this.ledger.approveWithdrawal(withdrawalId, {
      adminId: input.adminId ?? 'admin-unknown',
      actorType: input.actorType ?? 'admin',
      reasonCode,
      note: input.note
    });
    await this.publishWithdrawalStateChange(result.withdrawal, result.approval.createdAt);
    await this.ledger.appendAuditLog({
      entityType: 'withdrawal',
      entityId: withdrawalId,
      action: result.finalized ? 'withdraw.approved.finalized' : 'withdraw.approved.partial',
      actorType: input.actorType ?? 'admin',
      actorId: input.adminId ?? 'admin-unknown',
      metadata: {
        reasonCode,
        note: input.note ?? '',
        approvalCount: result.withdrawal.approvalCount.toString(),
        requiredApprovals: result.withdrawal.requiredApprovals.toString()
      }
    });
    if (result.finalized) {
      await this.withdrawJobQueue.enqueueDispatch(withdrawalId);
      await this.alertService.notifyWithdrawalApproved({
        withdrawalId,
        adminId: input.adminId ?? 'admin-unknown',
        approvalCount: result.withdrawal.approvalCount,
        requiredApprovals: result.withdrawal.requiredApprovals
      });
    }
    return result;
  }

  async broadcast(withdrawalId: string) {
    const current = await this.ledger.getWithdrawal(withdrawalId);
    if (!current) {
      return undefined;
    }

    await this.withdrawGuardService.assertBroadcastAllowed({
      toAddress: current.toAddress,
      amount: current.amount
    });

    const signer = this.withdrawalSigner ?? {
      broadcastWithdrawal: (request: { toAddress: string; amount: bigint }) => this.tronGateway.broadcastTransfer(request)
    };
    const { txHash } = await signer.broadcastWithdrawal({
      withdrawalId,
      toAddress: current.toAddress,
      amount: current.amount
    });

    const updated = await this.ledger.broadcastWithdrawal(withdrawalId, txHash);
    await this.publishWithdrawalStateChange(updated, new Date().toISOString());
    await this.ledger.appendAuditLog({
      entityType: 'withdrawal',
      entityId: withdrawalId,
      action: 'withdraw.broadcast',
      actorType: 'system',
      actorId: 'tron-gateway',
      metadata: {
        txHash
      }
    });
    return updated;
  }

  async confirm(
    withdrawalId: string,
    input?: { networkFee?: { txHash: string; feeSun: bigint; energyUsed: number; bandwidthUsed: number } }
  ) {
    const updated = await this.ledger.confirmWithdrawal(withdrawalId, input);
    await this.publishWithdrawalStateChange(updated, new Date().toISOString());
    await this.ledger.appendAuditLog({
      entityType: 'withdrawal',
      entityId: withdrawalId,
      action: 'withdraw.confirmed',
      actorType: 'system',
      actorId: 'reconciliation',
      metadata: {
        txHash: updated.txHash ?? ''
      }
    });
    return updated;
  }

  async fail(withdrawalId: string, reason: string) {
    const updated = await this.ledger.failWithdrawal(withdrawalId, reason);
    await this.publishWithdrawalStateChange(updated, new Date().toISOString());
    await this.ledger.appendAuditLog({
      entityType: 'withdrawal',
      entityId: withdrawalId,
      action: 'withdraw.failed',
      actorType: 'system',
      actorId: 'withdraw-service',
      metadata: {
        reason
      }
    });
    return updated;
  }

  async get(withdrawalId: string) {
    return this.ledger.getWithdrawal(withdrawalId);
  }

  async listOfflineSigningPending() {
    const withdrawals = await this.ledger.listWithdrawalsByStatuses(['ADMIN_APPROVED']);
    return withdrawals.filter((withdrawal) => this.withdrawGuardService.requiresOfflineSigning(withdrawal.amount));
  }

  async submitOfflineBroadcast(
    withdrawalId: string,
    input: { txHash: string; note?: string; actorId?: string }
  ) {
    const current = await this.ledger.getWithdrawal(withdrawalId);
    if (!current) {
      return undefined;
    }
    if (current.status !== 'ADMIN_APPROVED') {
      throw new DomainError(409, 'WITHDRAW_INVALID_STATE', `withdrawal is not dispatchable in state ${current.status}`);
    }
    if (!this.withdrawGuardService.requiresOfflineSigning(current.amount)) {
      throw new DomainError(409, 'WITHDRAW_OFFLINE_SIGN_NOT_REQUIRED', 'withdrawal does not require offline signing');
    }

    const updated = await this.ledger.broadcastWithdrawal(withdrawalId, input.txHash);
    await this.publishWithdrawalStateChange(updated, new Date().toISOString());
    await this.ledger.appendAuditLog({
      entityType: 'withdrawal',
      entityId: withdrawalId,
      action: 'withdraw.broadcast.offline_submitted',
      actorType: 'admin',
      actorId: input.actorId ?? 'admin-unknown',
      metadata: {
        txHash: input.txHash,
        note: input.note ?? ''
      }
    });
    return updated;
  }

  async getFoxyaPollingState(
    withdrawalId: string
  ): Promise<
    | Omit<WithdrawBridgeStateResponseContract, 'schemaVersion'>
    | undefined
  > {
    const withdrawal = await this.ledger.getWithdrawal(withdrawalId);
    if (!withdrawal) {
      return undefined;
    }

    return {
      withdrawalId: withdrawal.withdrawalId,
      externalTransferId: null,
      status: mapWithdrawalToSyncStatus(withdrawal),
      txHash: withdrawal.txHash ?? null,
      failedReason: withdrawal.failReason ?? null,
      updatedAt:
        withdrawal.confirmedAt ??
        withdrawal.failedAt ??
        withdrawal.broadcastedAt ??
        withdrawal.approvedAt ??
        withdrawal.externalAuthConfirmedAt ??
        withdrawal.reviewRequiredAt ??
        withdrawal.createdAt
    };
  }

  async listPendingApprovals() {
    return this.ledger.listPendingApprovalWithdrawals();
  }

  async listApprovals(withdrawalId: string) {
    return this.ledger.listWithdrawalApprovals(withdrawalId);
  }

  async upsertAddressPolicy(input: {
    address: string;
    policyType: 'blacklist' | 'whitelist' | 'internal_blocked';
    reason?: string;
    createdBy: string;
  }) {
    if (!this.withdrawPolicyService) {
      throw new Error('withdraw policy service is not configured');
    }

    return this.withdrawPolicyService.upsertAddressPolicy(input);
  }

  async listAddressPolicies(input?: {
    address?: string;
    policyType?: 'blacklist' | 'whitelist' | 'internal_blocked';
    limit?: number;
  }) {
    return this.withdrawPolicyService?.listAddressPolicies(input) ?? [];
  }

  async deleteAddressPolicy(address: string, policyType: 'blacklist' | 'whitelist' | 'internal_blocked') {
    return this.withdrawPolicyService?.deleteAddressPolicy(address, policyType) ?? false;
  }

  async reconcileBroadcasted(): Promise<{ confirmed: string[]; failed: string[]; pending: string[] }> {
    const broadcasted = await this.ledger.listWithdrawalsByStatuses(['TX_BROADCASTED']);

    const confirmed: string[] = [];
    const failed: string[] = [];
    const pending: string[] = [];

    for (const withdrawal of broadcasted) {
      if (!withdrawal.txHash) {
        continue;
      }

      const receipt = await this.tronGateway.getTransactionReceiptDetails(withdrawal.txHash);
      if (receipt.status === 'confirmed') {
        await this.confirm(withdrawal.withdrawalId, {
          networkFee: {
            txHash: withdrawal.txHash,
            feeSun: receipt.feeSun,
            energyUsed: receipt.energyUsed,
            bandwidthUsed: receipt.bandwidthUsed
          }
        });
        confirmed.push(withdrawal.withdrawalId);
        continue;
      }
      if (receipt.status === 'failed') {
        await this.fail(withdrawal.withdrawalId, 'on-chain receipt reported failure');
        failed.push(withdrawal.withdrawalId);
        continue;
      }
      pending.push(withdrawal.withdrawalId);
    }

    return { confirmed, failed, pending };
  }

  async processExternalSyncRetry(withdrawalId: string, _attempt = 1) {
    const withdrawal = await this.ledger.getWithdrawal(withdrawalId);
    if (!withdrawal) {
      throw new Error('withdrawal not found');
    }

    await this.syncExternalWithdrawalState(withdrawal, new Date().toISOString(), false);
  }

  async consumeWithdrawalStateChanged(contract: WithdrawalStateChangedContract, enqueueOnFailure: boolean) {
    if (!this.externalWithdrawalSyncClient) {
      return;
    }

    try {
      await this.externalWithdrawalSyncClient.syncWithdrawalState(contract);
      await this.recordExternalSyncAudit(contract.withdrawalId, 'withdraw.external_sync.succeeded', {
        status: contract.status,
        occurredAt: contract.occurredAt,
        txHash: contract.txHash ?? ''
      });
    } catch (error) {
      console.error('Failed to sync withdrawal state to foxya', {
        withdrawalId: contract.withdrawalId,
        status: contract.status,
        error
      });
      const message = error instanceof Error ? error.message : 'unknown external sync failure';
      await Promise.all([
        this.recordExternalSyncAudit(contract.withdrawalId, 'withdraw.external_sync.failed', {
          status: contract.status,
          occurredAt: contract.occurredAt,
          txHash: contract.txHash ?? '',
          error: message.slice(0, 500)
        }),
        this.alertService.notifyWithdrawalExternalSyncFailed({
          withdrawalId: contract.withdrawalId,
          status: contract.status,
          reason: message.slice(0, 500)
        })
      ]);
      if (enqueueOnFailure) {
        await this.enqueueExternalSyncRetry(contract.withdrawalId);
      }
      throw error;
    }
  }

  private async assessRisk(input: {
    userId: string;
    amountKori: number;
    toAddress: string;
    clientIp?: string;
    deviceId?: string;
  }) {
    const flags: string[] = [];
    let score = 0;
    const now = Date.now();
    const recentWithdrawals = await this.ledger.listWithdrawalsByUser(input.userId, 100);
    const recentHourThreshold = new Date(now - 60 * 60 * 1000).toISOString();
    const recentDayThreshold = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    if (input.amountKori >= env.withdrawSingleLimitKori * 0.8) {
      flags.push('large_amount');
      score += 60;
    } else if (input.amountKori >= env.withdrawSingleLimitKori * 0.25) {
      flags.push('medium_amount');
      score += 30;
    }

    if (!input.clientIp) {
      flags.push('missing_ip');
      score += 20;
    } else if (!this.isPrivateIp(input.clientIp)) {
      flags.push('external_ip');
      score += 10;
    }

    if (!input.deviceId) {
      flags.push('missing_device');
      score += 20;
    }

    const priorDestinationWithdrawals = recentWithdrawals.filter((withdrawal) => withdrawal.toAddress === input.toAddress);
    if (!priorDestinationWithdrawals.length) {
      flags.push('new_destination');
      score += 15;
    }

    const recentFailedDestinationCount = priorDestinationWithdrawals.filter(
      (withdrawal) => withdrawal.status === 'FAILED' && withdrawal.createdAt >= recentDayThreshold
    ).length;
    if (recentFailedDestinationCount >= 1) {
      flags.push('failed_destination_retry');
      score += 40;
    }

    const recentFailedWithdrawalCount = recentWithdrawals.filter(
      (withdrawal) => withdrawal.status === 'FAILED' && withdrawal.createdAt >= recentDayThreshold
    ).length;
    if (recentFailedWithdrawalCount >= 2) {
      flags.push('repeated_recent_failures');
      score += 25;
    }

    const rapidWithdrawalCount = recentWithdrawals.filter((withdrawal) => withdrawal.createdAt >= recentHourThreshold).length;
    if (rapidWithdrawalCount >= 3) {
      flags.push('withdrawal_burst');
      score += 25;
    }

    const level = score >= 80 ? 'high' : score >= 40 ? 'medium' : 'low';
    return {
      level,
      score,
      flags,
      requiredApprovals: level === 'low' ? 1 : 2
    } as const;
  }

  private isPrivateIp(ip: string) {
    return /^(127\.0\.0\.1|::1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(ip);
  }

  private async publishWithdrawalStateChange(
    withdrawal: Parameters<typeof buildWithdrawalStateChangedContract>[0],
    occurredAt: string
  ) {
    const contract = buildWithdrawalStateChangedContract(withdrawal, occurredAt);
    if (this.eventPublisher.publishAsync) {
      await this.eventPublisher.publishAsync('withdrawal.state.changed', contract);
      return;
    }

    this.eventPublisher.publish('withdrawal.state.changed', contract);
    if (this.externalWithdrawalSyncClient) {
      await this.consumeWithdrawalStateChanged(contract, true);
    }
  }

  private async syncExternalWithdrawalState(
    withdrawal: Parameters<typeof buildWithdrawalStateChangedContract>[0],
    occurredAt: string,
    enqueueOnFailure: boolean
  ) {
    const contract = buildWithdrawalStateChangedContract(withdrawal, occurredAt);
    await this.consumeWithdrawalStateChanged(contract, enqueueOnFailure);
  }

  private async recordExternalSyncAudit(withdrawalId: string, action: string, metadata: Record<string, string>) {
    try {
      await this.ledger.appendAuditLog({
        entityType: 'withdrawal',
        entityId: withdrawalId,
        action,
        actorType: 'system',
        actorId: 'foxya-withdrawal-sync',
        metadata
      });
    } catch (error) {
      console.error('Failed to record external withdrawal sync audit log', {
        withdrawalId,
        action,
        error
      });
    }
  }

  private async enqueueExternalSyncRetry(withdrawalId: string) {
    try {
      await this.withdrawJobQueue.enqueueExternalSync(withdrawalId);
    } catch (error) {
      console.error('Failed to enqueue external withdrawal sync retry', {
        withdrawalId,
        error
      });
    }
  }
}
