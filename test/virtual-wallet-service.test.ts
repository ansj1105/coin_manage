import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppDependencies } from '../src/container/create-app-dependencies.js';
import { MockTronGateway } from '../src/infrastructure/blockchain/mock-tron-gateway.js';
import { VirtualWalletService } from '../src/application/services/virtual-wallet-service.js';
import { InMemoryVirtualWalletRepository } from '../src/infrastructure/persistence/in-memory-virtual-wallet-repository.js';
import { InMemoryLedgerRepository } from '../src/infrastructure/persistence/in-memory-ledger-repository.js';
import { AesGcmVirtualWalletKeyCipher } from '../src/infrastructure/security/virtual-wallet-key-cipher.js';
import { parseKoriAmount } from '../src/domain/value-objects/money.js';

describe('virtual wallet service', () => {
  let deps: ReturnType<typeof createAppDependencies>;

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () => '',
        json: async () => ({})
      }))
    );
    deps = createAppDependencies({
      tronGateway: new MockTronGateway()
    });
  });

  it('issues a virtual wallet and returns the same binding for duplicate idempotency', async () => {
    const first = await deps.virtualWalletService.issue({
      userId: '77',
      currencyId: 101,
      network: 'mainnet',
      idempotencyKey: 'virtual-wallet-issue-1'
    });

    expect(first.duplicated).toBe(false);
    expect(first.binding.userId).toBe('77');
    expect(first.binding.currencyId).toBe(101);
    expect(first.binding.network).toBe('mainnet');
    expect(first.binding.walletAddress).toMatch(/^T/);

    const second = await deps.virtualWalletService.issue({
      userId: '77',
      currencyId: 101,
      network: 'mainnet',
      idempotencyKey: 'virtual-wallet-issue-1'
    });

    expect(second.duplicated).toBe(true);
    expect(second.binding.virtualWalletId).toBe(first.binding.virtualWalletId);

    const binding = await deps.virtualWalletService.get({ userId: '77' });
    expect(binding?.virtualWalletId).toBe(first.binding.virtualWalletId);
  });

  it('binds the issued address into the shared ledger account lookup path', async () => {
    const issued = await deps.virtualWalletService.issue({
      userId: '88',
      currencyId: 101,
      network: 'testnet',
      idempotencyKey: 'virtual-wallet-issue-2'
    });

    const account = await deps.walletService.getBalance({
      walletAddress: issued.binding.walletAddress
    });

    expect(account.userId).toBe('88');
    expect(account.walletAddress).toBe(issued.binding.walletAddress);
  });

  it('rejects issuance when the user already has a wallet binding outside virtual wallet issuance', async () => {
    await deps.walletService.bindWalletAddress({
      userId: '99',
      walletAddress: 'TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
    });

    await expect(
      deps.virtualWalletService.issue({
        userId: '99',
        currencyId: 101,
        network: 'mainnet',
        idempotencyKey: 'virtual-wallet-issue-3'
      })
    ).rejects.toMatchObject({
      code: 'USER_ALREADY_HAS_BOUND_WALLET_ADDRESS'
    });
  });

  it('retries foxya wallet sync from persisted signer material on duplicate idempotency', async () => {
    const ledger = new InMemoryLedgerRepository({
      singleLimit: parseKoriAmount(10000),
      dailyLimit: parseKoriAmount(50000)
    });
    const repository = new InMemoryVirtualWalletRepository(ledger);
    const syncCalls: Array<{ userId: string; currencyId: number; address: string; privateKey: string }> = [];
    let failFirst = true;
    const service = new VirtualWalletService(
      repository,
      new AesGcmVirtualWalletKeyCipher('test-virtual-wallet-secret'),
      'THotWallet111111111111111111111111111',
      async () => ({
        address: 'TDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
        privateKey: 'test-private-key-1'
      }),
      {
        async syncVirtualWallet(input) {
          syncCalls.push(input);
          if (failFirst) {
            failFirst = false;
            throw new Error('temporary foxya sync failure');
          }
        }
      }
    );

    await expect(
      service.issue({
        userId: '111',
        currencyId: 101,
        network: 'mainnet',
        idempotencyKey: 'virtual-wallet-sync-retry-1'
      })
    ).rejects.toThrow('temporary foxya sync failure');

    const retried = await service.issue({
      userId: '111',
      currencyId: 101,
      network: 'mainnet',
      idempotencyKey: 'virtual-wallet-sync-retry-1'
    });

    expect(retried.duplicated).toBe(true);
    expect(syncCalls).toHaveLength(2);
    expect(syncCalls[0]?.privateKey).toBe('test-private-key-1');
    expect(syncCalls[1]?.privateKey).toBe('test-private-key-1');
  });

  it('reissues a virtual wallet by retiring the previous active binding', async () => {
    const first = await deps.virtualWalletService.issue({
      userId: '201',
      currencyId: 101,
      network: 'mainnet',
      idempotencyKey: 'virtual-wallet-issue-201'
    });

    const second = await deps.virtualWalletService.reissue({
      userId: '201',
      currencyId: 101,
      network: 'mainnet',
      idempotencyKey: 'virtual-wallet-reissue-201'
    });

    expect(second.duplicated).toBe(false);
    expect(second.binding.virtualWalletId).not.toBe(first.binding.virtualWalletId);
    expect(second.binding.status).toBe('active');
    expect(second.binding.walletAddress).not.toBe(first.binding.walletAddress);

    const current = await deps.virtualWalletService.get({ userId: '201' });
    expect(current?.virtualWalletId).toBe(second.binding.virtualWalletId);
    expect(current?.status).toBe('active');
    expect(first.binding.status).toBe('active');
  });
});
