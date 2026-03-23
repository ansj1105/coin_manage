import { env } from '../../config/env.js';
import type { AlertNotifier } from '../ports/alert-notifier.js';

export class AlertService {
  private readonly lastSentByKey = new Map<string, { signature: string; sentAtMs: number }>();

  constructor(private readonly notifier?: AlertNotifier) {}

  get enabled() {
    return Boolean(this.notifier);
  }

  async sendTestMessage(message?: string) {
    await this.send({
      title: '[KORION] Telegram Test',
      body: message?.trim() || 'coin_manage telegram notifier is configured.'
    });
  }

  async notifyReconciliationAlerts(input: { alerts: string[]; hotWalletBalance: string; hotWalletTrx: string }) {
    if (!input.alerts.length) {
      this.lastSentByKey.delete('reconciliation');
      return;
    }

    await this.send({
      title: '[KORION] Hot Wallet Alert',
      body: [`alerts=${input.alerts.join(',')}`, `kori=${input.hotWalletBalance}`, `trx=${input.hotWalletTrx}`].join('\n'),
      dedupeKey: 'reconciliation',
      cooldownSec: env.hotWalletAlertCooldownSec
    });
  }

  async notifySweepFailure(input: { depositId: string; sourceAddress: string; message: string }) {
    await this.send({
      title: '[KORION] Sweep Failed',
      body: [`depositId=${input.depositId}`, `source=${input.sourceAddress}`, `error=${input.message}`].join('\n'),
      dedupeKey: `sweep-failed:${input.depositId}:${input.message}`
    });
  }

  async notifyWithdrawalRequested(input: {
    withdrawalId: string;
    userId: string;
    amount: string;
    toAddress: string;
    riskLevel: 'low' | 'medium' | 'high';
    requiredApprovals: number;
  }) {
    await this.send({
      title: '[KORION] Withdrawal Requested',
      body: [
        `withdrawalId=${input.withdrawalId}`,
        `userId=${input.userId}`,
        `amount=${input.amount}`,
        `toAddress=${input.toAddress}`,
        `riskLevel=${input.riskLevel}`,
        `requiredApprovals=${input.requiredApprovals}`
      ].join('\n'),
      dedupeKey: `withdraw-requested:${input.withdrawalId}`
    });
  }

  async notifyWithdrawalApproved(input: {
    withdrawalId: string;
    adminId: string;
    approvalCount: number;
    requiredApprovals: number;
  }) {
    await this.send({
      title: '[KORION] Withdrawal Approved',
      body: [
        `withdrawalId=${input.withdrawalId}`,
        `adminId=${input.adminId}`,
        `approvalCount=${input.approvalCount}`,
        `requiredApprovals=${input.requiredApprovals}`
      ].join('\n'),
      dedupeKey: `withdraw-approved:${input.withdrawalId}:${input.approvalCount}`
    });
  }

  async notifyWithdrawalDispatchRetry(input: {
    withdrawalId: string;
    retryCount: number;
    reason: string;
  }) {
    await this.send({
      title: '[KORION] Withdrawal Dispatch Retry',
      body: [
        `withdrawalId=${input.withdrawalId}`,
        `retryCount=${input.retryCount}`,
        `reason=${input.reason}`
      ].join('\n'),
      dedupeKey: `withdraw-dispatch-retry:${input.withdrawalId}:${input.retryCount}:${input.reason}`
    });
  }

  async notifyWithdrawalDispatchFailed(input: {
    withdrawalId: string;
    reason: string;
  }) {
    await this.send({
      title: '[KORION] Withdrawal Dispatch Failed',
      body: [`withdrawalId=${input.withdrawalId}`, `reason=${input.reason}`].join('\n'),
      dedupeKey: `withdraw-dispatch-failed:${input.withdrawalId}:${input.reason}`
    });
  }

  async notifyWithdrawalExternalSyncFailed(input: {
    withdrawalId: string;
    status: string;
    reason: string;
  }) {
    await this.send({
      title: '[KORION] Withdrawal Callback Sync Failed',
      body: [
        `withdrawalId=${input.withdrawalId}`,
        `status=${input.status}`,
        `reason=${input.reason}`
      ].join('\n'),
      dedupeKey: `withdraw-callback-sync-failed:${input.withdrawalId}:${input.status}:${input.reason}`
    });
  }

  async notifyWithdrawalResourceLow(input: {
    withdrawalId: string;
    hotWalletAddress: string;
    trxBalanceSun: string;
    availableBandwidth: number;
    availableEnergy: number;
    minTrxSun: string;
    minBandwidth: number;
    minEnergy: number;
  }) {
    await this.send({
      title: '[KORION] Withdrawal Resource Low',
      body: [
        `withdrawalId=${input.withdrawalId}`,
        `hotWallet=${input.hotWalletAddress}`,
        `trxBalanceSun=${input.trxBalanceSun}`,
        `availableBandwidth=${input.availableBandwidth}`,
        `availableEnergy=${input.availableEnergy}`,
        `minTrxSun=${input.minTrxSun}`,
        `minBandwidth=${input.minBandwidth}`,
        `minEnergy=${input.minEnergy}`
      ].join('\n'),
      dedupeKey: `withdraw-resource-low:${input.withdrawalId}:${input.hotWalletAddress}`
    });
  }

  async notifySweepResourceLow(input: {
    depositId: string;
    sourceAddress: string;
    network: 'mainnet' | 'testnet';
    trxBalance: string;
    availableEnergy: number;
    availableBandwidth: number;
    attemptCount: number;
  }) {
    await this.send({
      title: '[KORION] Sweep Resource Low',
      body: [
        `depositId=${input.depositId}`,
        `source=${input.sourceAddress}`,
        `network=${input.network}`,
        `trx=${input.trxBalance}`,
        `availableEnergy=${input.availableEnergy}`,
        `availableBandwidth=${input.availableBandwidth}`,
        `attemptCount=${input.attemptCount}`
      ].join('\n'),
      dedupeKey: `sweep-resource-low:${input.sourceAddress}`
    });
  }

  async notifySweepQueueTimeout(input: {
    depositId: string;
    sourceAddress: string;
    queuedAt?: string;
    attemptCount: number;
    timeoutSec: number;
  }) {
    await this.send({
      title: '[KORION] Sweep Queue Timeout',
      body: [
        `depositId=${input.depositId}`,
        `source=${input.sourceAddress}`,
        `queuedAt=${input.queuedAt ?? 'unknown'}`,
        `attemptCount=${input.attemptCount}`,
        `timeoutSec=${input.timeoutSec}`
      ].join('\n'),
      dedupeKey: `sweep-queue-timeout:${input.sourceAddress}:${input.depositId}`
    });
  }

  async notifyDepositMonitorFailure(message: string) {
    await this.send({
      title: '[KORION] Deposit Monitor Failed',
      body: message,
      dedupeKey: `deposit-monitor:${message}`
    });
  }

  async notifyWalletLifecycleGateBlocked(input: {
    userId: string;
    walletAddress?: string;
    operation: 'deposit' | 'withdraw';
    reason: string;
  }) {
    await this.send({
      title: '[KORION] Wallet Lifecycle Gate Blocked',
      body: [
        `userId=${input.userId}`,
        `walletAddress=${input.walletAddress ?? '-'}`,
        `operation=${input.operation}`,
        `reason=${input.reason}`
      ].join('\n'),
      dedupeKey: `wallet-lifecycle-gate:${input.operation}:${input.userId}:${input.reason}`
    });
  }

  async notifyActivationGrantFailure(input: {
    userId: string;
    walletAddress: string;
    message: string;
  }) {
    await this.send({
      title: '[KORION] Activation Grant Failed',
      body: [`userId=${input.userId}`, `walletAddress=${input.walletAddress}`, `error=${input.message}`].join('\n'),
      dedupeKey: `activation-grant-failed:${input.userId}:${input.walletAddress}:${input.message}`
    });
  }

  async notifyActivationReclaimWaiting(input: {
    userId: string;
    walletAddress: string;
    availableBandwidth: number;
    trxBalanceSun: string;
    requiredBandwidth: number;
    requiredTrxSun: string;
  }) {
    await this.send({
      title: '[KORION] Activation Reclaim Waiting',
      body: [
        `userId=${input.userId}`,
        `walletAddress=${input.walletAddress}`,
        `availableBandwidth=${input.availableBandwidth}`,
        `trxBalanceSun=${input.trxBalanceSun}`,
        `requiredBandwidth=${input.requiredBandwidth}`,
        `requiredTrxSun=${input.requiredTrxSun}`
      ].join('\n'),
      dedupeKey: `activation-reclaim-waiting:${input.userId}:${input.walletAddress}`
    });
  }

  async notifyActivationReclaimFailure(input: {
    userId: string;
    walletAddress: string;
    message: string;
  }) {
    await this.send({
      title: '[KORION] Activation Reclaim Failed',
      body: [`userId=${input.userId}`, `walletAddress=${input.walletAddress}`, `error=${input.message}`].join('\n'),
      dedupeKey: `activation-reclaim-failed:${input.userId}:${input.walletAddress}:${input.message}`
    });
  }

  async notifyResourceDelegationWaiting(input: {
    userId: string;
    walletAddress: string;
    resource: 'BANDWIDTH' | 'ENERGY';
    requiredSun: string;
    availableSun: string;
  }) {
    await this.send({
      title: '[KORION] Resource Delegation Waiting',
      body: [
        `userId=${input.userId}`,
        `walletAddress=${input.walletAddress}`,
        `resource=${input.resource}`,
        `requiredSun=${input.requiredSun}`,
        `availableSun=${input.availableSun}`
      ].join('\n'),
      dedupeKey: `resource-delegation-waiting:${input.userId}:${input.walletAddress}:${input.resource}`
    });
  }

  async notifyResourceDelegationFailure(input: {
    userId: string;
    walletAddress: string;
    message: string;
  }) {
    await this.send({
      title: '[KORION] Resource Delegation Failed',
      body: [`userId=${input.userId}`, `walletAddress=${input.walletAddress}`, `error=${input.message}`].join('\n'),
      dedupeKey: `resource-delegation-failed:${input.userId}:${input.walletAddress}:${input.message}`
    });
  }

  async notifyResourceReleaseFailure(input: {
    userId: string;
    walletAddress: string;
    message: string;
  }) {
    await this.send({
      title: '[KORION] Resource Release Failed',
      body: [`userId=${input.userId}`, `walletAddress=${input.walletAddress}`, `error=${input.message}`].join('\n'),
      dedupeKey: `resource-release-failed:${input.userId}:${input.walletAddress}:${input.message}`
    });
  }

  async notifyExternalEvent(input: { title: string; bodyLines: string[]; dedupeKey: string }) {
    await this.send({
      title: input.title,
      body: input.bodyLines.join('\n'),
      dedupeKey: `external-event:${input.dedupeKey}`
    });
  }

  async notifyExternalMonitorFailure(message: string) {
    await this.send({
      title: '[KORION] External Alert Monitor Failed',
      body: message,
      dedupeKey: `external-alert-monitor:${message}`
    });
  }

  async notifyHealthCheckUnhealthy(input: {
    targetName: string;
    targetUrl: string;
    detail: string;
    consecutiveFailures: number;
  }) {
    await this.send({
      title: `[KORION] Health Down - ${input.targetName}`,
      body: [`url=${input.targetUrl}`, `detail=${input.detail}`, `consecutiveFailures=${input.consecutiveFailures}`].join('\n'),
      dedupeKey: `health-unhealthy:${input.targetName}:${input.targetUrl}`
    });
  }

  async notifyHealthCheckRecovered(input: { targetName: string; targetUrl: string }) {
    await this.send({
      title: `[KORION] Health Recovered - ${input.targetName}`,
      body: `url=${input.targetUrl}`,
      dedupeKey: `health-recovered:${input.targetName}:${input.targetUrl}`
    });
  }

  async notifyOfflinePayCircuitOpened(input: {
    circuitName: string;
    settlementId: string;
    failureCount: number;
    message: string;
  }) {
    await this.send({
      title: `[KORION] Offline Pay Circuit Open - ${input.circuitName}`,
      body: [
        `settlementId=${input.settlementId}`,
        `failureCount=${input.failureCount}`,
        `message=${input.message}`
      ].join('\n'),
      dedupeKey: `offline-pay-circuit-open:${input.circuitName}:${input.settlementId}:${input.message}`
    });
  }

  async notifyOfflinePayExecutionFailure(input: {
    settlementId: string;
    proofId: string;
    message: string;
  }) {
    await this.send({
      title: '[KORION] Offline Pay Execution Failed',
      body: [
        `settlementId=${input.settlementId}`,
        `proofId=${input.proofId}`,
        `message=${input.message}`
      ].join('\n'),
      dedupeKey: `offline-pay-execution-failed:${input.settlementId}:${input.proofId}:${input.message}`
    });
  }

  private async send(input: { title: string; body: string; dedupeKey?: string; cooldownSec?: number }) {
    if (!this.notifier) {
      return;
    }

    const signature = `${input.title}\n${input.body}`;
    const nowMs = Date.now();
    if (input.dedupeKey) {
      const previous = this.lastSentByKey.get(input.dedupeKey);
      if (
        previous &&
        previous.signature === signature &&
        input.cooldownSec !== undefined &&
        nowMs - previous.sentAtMs < input.cooldownSec * 1000
      ) {
        return;
      }
      if (previous && previous.signature === signature && input.cooldownSec === undefined) {
        return;
      }
    }

    try {
      await this.notifier.sendMessage({
        title: input.title,
        body: input.body,
        dedupeKey: input.dedupeKey
      });
    } catch (error) {
      console.error('Alert delivery failed:', {
        title: input.title,
        dedupeKey: input.dedupeKey,
        error: error instanceof Error ? error.message : String(error)
      });
      return;
    }

    if (input.dedupeKey) {
      this.lastSentByKey.set(input.dedupeKey, {
        signature,
        sentAtMs: nowMs
      });
    }
  }
}
