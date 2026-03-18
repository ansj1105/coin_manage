import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

describe('foxya internal withdrawal config', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NODE_ENV = 'test';
    delete process.env.FOXYA_INTERNAL_WITHDRAWAL_API_KEY;
    delete process.env.FOXYA_INTERNAL_WITHDRAWAL_API_KEY_ASM_SECRET_ID;
    delete process.env.FOXYA_INTERNAL_WITHDRAWAL_API_KEY_ASM_JSON_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL_ENV)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, ORIGINAL_ENV);
  });

  it('falls back to the shared foxya internal api key when a withdrawal-specific key is absent', async () => {
    process.env.FOXYA_INTERNAL_API_KEY = 'shared-internal-key';

    const { env } = await import('../src/config/env.js');

    expect(env.foxyaInternalWithdrawalApiKey).toBe('shared-internal-key');
  });

  it('prefers the withdrawal-specific api key when it is configured', async () => {
    process.env.FOXYA_INTERNAL_API_KEY = 'shared-internal-key';
    process.env.FOXYA_INTERNAL_WITHDRAWAL_API_KEY = 'withdrawal-only-key';

    const { env } = await import('../src/config/env.js');

    expect(env.foxyaInternalWithdrawalApiKey).toBe('withdrawal-only-key');
  });
});
