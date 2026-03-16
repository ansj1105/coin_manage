import { describe, expect, it, vi } from 'vitest';
import { AlertService } from '../src/application/services/alert-service.js';

describe('AlertService', () => {
  it('swallows notifier failures so worker error handling is not masked by Telegram issues', async () => {
    const notifier = {
      sendMessage: vi.fn(async () => {
        throw new Error('Too Many Requests: retry after 39');
      })
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const service = new AlertService(notifier);

    await expect(service.notifyExternalMonitorFailure('connect ETIMEDOUT 54.210.92.221:15432')).resolves.toBeUndefined();

    expect(notifier.sendMessage).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      'Alert delivery failed:',
      expect.objectContaining({
        title: '[KORION] External Alert Monitor Failed',
        dedupeKey: 'external-alert-monitor:connect ETIMEDOUT 54.210.92.221:15432'
      })
    );
  });
});
