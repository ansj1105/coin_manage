import type { AlertNotifier } from '../../application/ports/alert-notifier.js';

export class TelegramAlertNotifier implements AlertNotifier {
  private readonly endpoint: string;

  constructor(
    botToken: string,
    private readonly chatId: string
  ) {
    this.endpoint = `https://api.telegram.org/bot${botToken}/sendMessage`;
  }

  async sendMessage(input: { title: string; body: string }): Promise<void> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chat_id: this.chatId,
        text: `${input.title}\n${input.body}`.trim(),
        disable_web_page_preview: true
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      const message = await response.text();
      let detail = message;

      try {
        const parsed = JSON.parse(message) as {
          description?: string;
          parameters?: { retry_after?: number };
        };
        const retryAfter = parsed.parameters?.retry_after;
        detail = parsed.description ?? message;
        if (retryAfter !== undefined) {
          detail = `${detail} (retry_after=${retryAfter}s)`;
        }
      } catch {
        // Keep the raw Telegram response body when it is not JSON.
      }

      throw new Error(detail || `telegram sendMessage failed with status ${response.status}`);
    }
  }
}
