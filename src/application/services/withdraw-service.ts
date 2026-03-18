import { formatKoriAmount, parseKoriAmount } from '../../domain/value-objects/money.js';
import { buildWithdrawalStateChangedContract } from '../../contracts/ledger-contracts.js';
import { env } from '../../config/env.js';
import type { EventPublisher } from '../ports/event-publisher.js';
import type { WithdrawJobQueue } from '../ports/withdraw-job-queue.js';
import type { LedgerRepository } from '../ports/ledger-repository.js';
import type { TronGateway } from '../ports/tron-gateway.js';
import { AlertService } from './alert-service.js';
import type { VirtualWalletLifecyclePolicyService } from './virtual-wallet-lifecycle-policy-service.js';
import { WithdrawGuardService } from './withdraw-guard-service.js';
import type { WithdrawPolicyService } from './withdraw-policy-service.js';

export class WithdrawService {
  constructor(
    private readonly ledger: LedgerRepository,
    private readonly eventPublisher: EventPublisher,
    private readonly tronGateway: TronGateway,
    private readonly alertService: AlertService,
    private readonly withdrawJobQueue: WithdrawJobQueue,
    private readonly virtualWalletLifecyclePolicy?: VirtualWalletLifecyclePolicyService,
    private readonly withdrawGuardService = new WithdrawGuardService(tronGateway),
    private readonly withdrawPolicyService?: WithdrawPolicyService
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
      walletAddress: input.walletAddress
    });
    const riskAssessment = this.assessRisk(input);
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
      this.eventPublisher.publish(
        'withdrawal.state.changed',
        buildWithdrawalStateChangedContract(result.withdrawal, result.withdrawal.createdAt)
      );
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
    this.eventPublisher.publish('withdrawal.state.changed', buildWithdrawalStateChangedContract(updated, new Date().toISOString()));
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
    input: { adminId?: string; actorType?: 'admin' | 'system'; note?: string } = {}
  ) {
    const result = await this.ledger.approveWithdrawal(withdrawalId, {
      adminId: input.adminId ?? 'admin-unknown',
      actorType: input.actorType ?? 'admin',
      note: input.note
    });
    this.eventPublisher.publish(
      'withdrawal.state.changed',
      buildWithdrawalStateChangedContract(result.withdrawal, result.approval.createdAt)
    );
    await this.ledger.appendAuditLog({
      entityType: 'withdrawal',
      entityId: withdrawalId,
      action: result.finalized ? 'withdraw.approved.finalized' : 'withdraw.approved.partial',
      actorType: input.actorType ?? 'admin',
      actorId: input.adminId ?? 'admin-unknown',
      metadata: {
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
      toAddress: current.toAddress
    });

    const { txHash } = await this.tronGateway.broadcastTransfer({
      toAddress: current.toAddress,
      amount: current.amount
    });

    const updated = await this.ledger.broadcastWithdrawal(withdrawalId, txHash);
    this.eventPublisher.publish('withdrawal.state.changed', buildWithdrawalStateChangedContract(updated, new Date().toISOString()));
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

  async confirm(withdrawalId: string) {
    const updated = await this.ledger.confirmWithdrawal(withdrawalId);
    this.eventPublisher.publish('withdrawal.state.changed', buildWithdrawalStateChangedContract(updated, new Date().toISOString()));
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
    this.eventPublisher.publish('withdrawal.state.changed', buildWithdrawalStateChangedContract(updated, new Date().toISOString()));
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

      const receipt = await this.tronGateway.getTransactionReceipt(withdrawal.txHash);
      if (receipt === 'confirmed') {
        await this.confirm(withdrawal.withdrawalId);
        confirmed.push(withdrawal.withdrawalId);
        continue;
      }
      if (receipt === 'failed') {
        await this.fail(withdrawal.withdrawalId, 'on-chain receipt reported failure');
        failed.push(withdrawal.withdrawalId);
        continue;
      }
      pending.push(withdrawal.withdrawalId);
    }

    return { confirmed, failed, pending };
  }

  private assessRisk(input: { amountKori: number; clientIp?: string; deviceId?: string }) {
    const flags: string[] = [];
    let score = 0;

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
}
