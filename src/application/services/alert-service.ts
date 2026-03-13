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

    await this.notifier.sendMessage({
      title: input.title,
      body: input.body,
      dedupeKey: input.dedupeKey
    });

    if (input.dedupeKey) {
      this.lastSentByKey.set(input.dedupeKey, {
        signature,
        sentAtMs: nowMs
      });
    }
  }
}
