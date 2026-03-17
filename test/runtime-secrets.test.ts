import { describe, expect, it } from 'vitest';
import {
  discoverAsmSecretBindings,
  extractAsmSecretValue,
  loadRuntimeSecretsFromAsm
} from '../src/bootstrap/runtime-secrets.js';

describe('runtime secret bootstrap', () => {
  it('discovers ASM-bound environment variables', () => {
    const bindings = discoverAsmSecretBindings({
      AWS_REGION: 'ap-northeast-2',
      HOT_WALLET_PRIVATE_KEY_ASM_SECRET_ID: 'prod/korion/hot-wallet',
      HOT_WALLET_PRIVATE_KEY_ASM_JSON_KEY: 'privateKey'
    });

    expect(bindings).toEqual([
      {
        targetEnv: 'HOT_WALLET_PRIVATE_KEY',
        secretId: 'prod/korion/hot-wallet',
        jsonKey: 'privateKey',
        region: 'ap-northeast-2'
      }
    ]);
  });

  it('extracts a JSON field from an ASM secret string', () => {
    const value = extractAsmSecretValue({
      targetEnv: 'HOT_WALLET_PRIVATE_KEY',
      secretId: 'prod/korion/hot-wallet',
      secretString: JSON.stringify({ privateKey: 'abc123' }),
      jsonKey: 'privateKey'
    });

    expect(value).toBe('abc123');
  });

  it('loads bound secrets into process-like env objects', async () => {
    const env = {
      AWS_REGION: 'ap-northeast-2',
      HOT_WALLET_PRIVATE_KEY_ASM_SECRET_ID: 'prod/korion/hot-wallet',
      HOT_WALLET_PRIVATE_KEY_ASM_JSON_KEY: 'privateKey',
      FOXYA_ENCRYPTION_KEY_ASM_SECRET_ID: 'prod/korion/foxya',
      FOXYA_ENCRYPTION_KEY_ASM_JSON_KEY: 'encryptionKey'
    } as NodeJS.ProcessEnv;

    const seen: Array<{ secretId: string; region: string }> = [];

    await loadRuntimeSecretsFromAsm(env, async ({ secretId, region }) => {
      seen.push({ secretId, region });
      if (secretId === 'prod/korion/hot-wallet') {
        return JSON.stringify({ privateKey: 'hot-secret' });
      }
      return JSON.stringify({ encryptionKey: 'foxya-secret' });
    });

    expect(env.HOT_WALLET_PRIVATE_KEY).toBe('hot-secret');
    expect(env.FOXYA_ENCRYPTION_KEY).toBe('foxya-secret');
    expect(seen).toEqual([
      { secretId: 'prod/korion/hot-wallet', region: 'ap-northeast-2' },
      { secretId: 'prod/korion/foxya', region: 'ap-northeast-2' }
    ]);
  });
});
