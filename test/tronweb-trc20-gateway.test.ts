import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

describe('TronWebTrc20Gateway', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.HOT_WALLET_PRIVATE_KEY = '03fa15b86aed96b2189edec3a6545771c8c6b4415d71b3869613d6002694da7e';
    process.env.HOT_WALLET_ADDRESS = 'TEcBR2zfPGCLGsoGpMFLpGTEwsC8jB72Hf';
    process.env.KORI_TOKEN_CONTRACT_ADDRESS = 'TBJZD8RwQ1JcQvEP9BTbPbgBCGxUjxSXnn';
    process.env.TRON_GATEWAY_MODE = 'trc20';
    process.env.TRON_API_URL = 'https://api.trongrid.io';
    process.env.VIRTUAL_WALLET_ENCRYPTION_KEY = 'test-virtual-wallet-encryption-key';
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

  it('can be constructed with a mismatched hot wallet key so read-only services still boot', async () => {
    const { TronWebTrc20Gateway } = await import('../src/infrastructure/blockchain/tronweb-trc20-gateway.js');

    expect(() => new TronWebTrc20Gateway()).not.toThrow();
  });
});
