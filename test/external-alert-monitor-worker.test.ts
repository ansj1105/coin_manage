import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExternalAlertMonitorWorker } from '../src/application/services/external-alert-monitor-worker.js';

describe('ExternalAlertMonitorWorker', () => {
  const originalConsoleError = console.error;

  beforeEach(() => {
    vi.useFakeTimers();
    console.error = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    console.error = originalConsoleError;
    vi.restoreAllMocks();
  });

  it('swallows runCycle errors so the app process keeps running', async () => {
    const service = {
      runCycle: vi.fn(async () => {
        throw new Error('connect ECONNREFUSED 54.210.92.221:15432');
      })
    };

    const worker = new ExternalAlertMonitorWorker(service as any, 1_000);
    worker.start();

    await vi.runOnlyPendingTimersAsync();

    expect(service.runCycle).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();

    worker.stop();
  });
});
