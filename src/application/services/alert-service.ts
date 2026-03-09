import type { AlertNotifier } from '../ports/alert-notifier.js';

export class AlertService {
  private readonly lastSentByKey = new Map<string, string>();

  constructor(private readonly notifier?: AlertNotifier) {}

  get enabled() {
    return Boolean(this.notifier);
  }

  async sendTestMessage() {
    await this.send({
      title: '[KORION] Telegram Test',
      body: 'coin_manage telegram notifier is configured.'
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
      dedupeKey: 'reconciliation'
    });
  }

  async notifySweepFailure(input: { depositId: string; sourceAddress: string; message: string }) {
    await this.send({
      title: '[KORION] Sweep Failed',
      body: [`depositId=${input.depositId}`, `source=${input.sourceAddress}`, `error=${input.message}`].join('\n'),
      dedupeKey: `sweep-failed:${input.depositId}:${input.message}`
    });
  }

  async notifyDepositMonitorFailure(message: string) {
    await this.send({
      title: '[KORION] Deposit Monitor Failed',
      body: message,
      dedupeKey: `deposit-monitor:${message}`
    });
  }

  private async send(input: { title: string; body: string; dedupeKey?: string }) {
    if (!this.notifier) {
      return;
    }

    const signature = `${input.title}\n${input.body}`;
    if (input.dedupeKey && this.lastSentByKey.get(input.dedupeKey) === signature) {
      return;
    }

    await this.notifier.sendMessage({
      title: input.title,
      body: input.body,
      dedupeKey: input.dedupeKey
    });

    if (input.dedupeKey) {
      this.lastSentByKey.set(input.dedupeKey, signature);
    }
  }
}
