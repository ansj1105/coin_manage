import { randomUUID } from 'node:crypto';
import { DomainError } from '../../domain/errors/domain-error.js';
import type { LedgerRepository } from '../../application/ports/ledger-repository.js';
import type { VirtualWalletRepository } from '../../application/ports/virtual-wallet-repository.js';
import type { DepositWatchAddress } from '../../domain/deposit-monitor/types.js';
import type { FoxyaWalletSigner } from '../../application/ports/foxya-wallet-repository.js';
import type { VirtualWalletBinding, VirtualWalletIssueResult } from '../../domain/virtual-wallet/types.js';

interface StoredVirtualWalletBinding extends VirtualWalletBinding {
  privateKey: string;
  encryptedPrivateKey: string;
  idempotencyKey: string;
}

export class InMemoryVirtualWalletRepository implements VirtualWalletRepository {
  constructor(private readonly ledger: Pick<LedgerRepository, 'bindWalletAddress' | 'getWalletBinding'>) {}

  private readonly walletsByUserId = new Map<string, StoredVirtualWalletBinding[]>();
  private readonly walletByAddress = new Map<string, StoredVirtualWalletBinding>();
  private readonly walletById = new Map<string, StoredVirtualWalletBinding>();
  private readonly walletByIdempotencyKey = new Map<string, StoredVirtualWalletBinding>();

  async issueVirtualWallet(input: {
    userId: string;
    currencyId: number;
    network: 'mainnet' | 'testnet';
    walletAddress: string;
    privateKey: string;
    encryptedPrivateKey: string;
    sweepTargetAddress: string;
    idempotencyKey: string;
    nowIso?: string;
  }): Promise<VirtualWalletIssueResult> {
    const duplicatedByIdempotency = this.walletByIdempotencyKey.get(input.idempotencyKey);
    if (duplicatedByIdempotency) {
      return {
        binding: this.toPublicBinding(duplicatedByIdempotency),
        duplicated: true
      };
    }

    const existing = this.getActiveWallet(input.userId, input.currencyId);
    if (existing) {
      return {
        binding: this.toPublicBinding(existing),
        duplicated: true
      };
    }

    const existingWalletBinding = await this.ledger.getWalletBinding({ userId: input.userId });
    if (existingWalletBinding) {
      throw new DomainError(
        409,
        'USER_ALREADY_HAS_BOUND_WALLET_ADDRESS',
        'user already has a wallet address bound outside virtual wallet issuance'
      );
    }

    const existingByAddress = this.walletByAddress.get(input.walletAddress);
    if (existingByAddress && existingByAddress.userId !== input.userId) {
      throw new DomainError(409, 'WALLET_ADDRESS_IN_USE', 'wallet address is already bound to another user');
    }

    return this.createWallet(input, undefined);
  }

  async reissueVirtualWallet(input: {
    userId: string;
    currencyId: number;
    network: 'mainnet' | 'testnet';
    walletAddress: string;
    privateKey: string;
    encryptedPrivateKey: string;
    sweepTargetAddress: string;
    idempotencyKey: string;
    nowIso?: string;
  }): Promise<VirtualWalletIssueResult> {
    const duplicatedByIdempotency = this.walletByIdempotencyKey.get(input.idempotencyKey);
    if (duplicatedByIdempotency) {
      return {
        binding: this.toPublicBinding(duplicatedByIdempotency),
        duplicated: true
      };
    }

    const current = this.getActiveWallet(input.userId, input.currencyId);
    return this.createWallet(input, current);
  }

  async getVirtualWallet(input: { userId?: string; walletAddress?: string }): Promise<VirtualWalletBinding | undefined> {
    if (input.userId) {
      const binding = this.getCurrentWalletByUserId(input.userId);
      return binding ? this.toPublicBinding(binding) : undefined;
    }

    if (input.walletAddress) {
      const binding = this.walletByAddress.get(input.walletAddress);
      return binding ? this.toPublicBinding(binding) : undefined;
    }

    throw new DomainError(400, 'VALIDATION_ERROR', 'userId or walletAddress is required');
  }

  async listWatchAddresses(network: 'mainnet' | 'testnet'): Promise<DepositWatchAddress[]> {
    return [...this.walletByAddress.values()]
      .filter((binding) => binding.network === network && binding.status === 'active')
      .map((binding) => ({
        userId: binding.userId,
        currencyId: binding.currencyId,
        address: binding.walletAddress,
        network: 'TRON'
      }));
  }

  async getWalletSignerByAddress(input: {
    address: string;
    currencyId: number;
    network?: 'mainnet' | 'testnet';
  }): Promise<FoxyaWalletSigner | undefined> {
    const binding = this.walletByAddress.get(input.address);
    if (!binding || binding.currencyId !== input.currencyId || binding.status !== 'active') {
      return undefined;
    }
    if (input.network && binding.network !== input.network) {
      return undefined;
    }

    return {
      userId: binding.userId,
      currencyId: binding.currencyId,
      address: binding.walletAddress,
      privateKey: binding.privateKey
    };
  }

  async retireVirtualWallet(input: {
    virtualWalletId: string;
    replacedByVirtualWalletId?: string;
    nowIso?: string;
  }): Promise<VirtualWalletBinding> {
    const binding = this.walletById.get(input.virtualWalletId);
    if (!binding) {
      throw new DomainError(404, 'NOT_FOUND', 'virtual wallet not found');
    }
    if (binding.status !== 'active') {
      return this.toPublicBinding(binding);
    }
    binding.status = 'retired';
    binding.retiredAt = input.nowIso ?? new Date().toISOString();
    binding.replacedByVirtualWalletId = input.replacedByVirtualWalletId;
    return this.toPublicBinding(binding);
  }

  async disableVirtualWallet(input: { virtualWalletId: string; nowIso?: string }): Promise<VirtualWalletBinding> {
    const binding = this.walletById.get(input.virtualWalletId);
    if (!binding) {
      throw new DomainError(404, 'NOT_FOUND', 'virtual wallet not found');
    }
    if (binding.status === 'disabled') {
      return this.toPublicBinding(binding);
    }
    binding.status = 'disabled';
    binding.disabledAt = input.nowIso ?? new Date().toISOString();
    return this.toPublicBinding(binding);
  }

  private async createWallet(
    input: {
      userId: string;
      currencyId: number;
      network: 'mainnet' | 'testnet';
      walletAddress: string;
      privateKey: string;
      encryptedPrivateKey: string;
      sweepTargetAddress: string;
      idempotencyKey: string;
      nowIso?: string;
    },
    replacedWallet?: StoredVirtualWalletBinding
  ): Promise<VirtualWalletIssueResult> {
    const nowIso = input.nowIso ?? new Date().toISOString();
    const stored: StoredVirtualWalletBinding = {
      virtualWalletId: randomUUID(),
      userId: input.userId,
      currencyId: input.currencyId,
      network: input.network,
      walletAddress: input.walletAddress,
      privateKey: input.privateKey,
      sweepTargetAddress: input.sweepTargetAddress,
      issuedBy: 'hot_wallet',
      status: 'active',
      createdAt: nowIso,
      encryptedPrivateKey: input.encryptedPrivateKey,
      idempotencyKey: input.idempotencyKey
    };

    if (replacedWallet) {
      replacedWallet.status = 'retired';
      replacedWallet.retiredAt = nowIso;
      replacedWallet.replacedByVirtualWalletId = stored.virtualWalletId;
    }

    const wallets = this.walletsByUserId.get(stored.userId) ?? [];
    wallets.push(stored);
    this.walletsByUserId.set(stored.userId, wallets);
    this.walletById.set(stored.virtualWalletId, stored);
    this.walletByAddress.set(stored.walletAddress, stored);
    this.walletByIdempotencyKey.set(stored.idempotencyKey, stored);
    await this.ledger.bindWalletAddress({
      userId: stored.userId,
      walletAddress: stored.walletAddress,
      nowIso: stored.createdAt
    });

    return {
      binding: this.toPublicBinding(stored),
      duplicated: false
    };
  }

  private getCurrentWalletByUserId(userId: string): StoredVirtualWalletBinding | undefined {
    const wallets = this.walletsByUserId.get(userId) ?? [];
    return wallets.find((wallet) => wallet.status === 'active') ?? wallets.at(-1);
  }

  private getActiveWallet(userId: string, currencyId: number): StoredVirtualWalletBinding | undefined {
    return (this.walletsByUserId.get(userId) ?? []).find(
      (wallet) => wallet.currencyId === currencyId && wallet.status === 'active'
    );
  }

  private toPublicBinding(binding: StoredVirtualWalletBinding): VirtualWalletBinding {
    return {
      virtualWalletId: binding.virtualWalletId,
      userId: binding.userId,
      currencyId: binding.currencyId,
      network: binding.network,
      walletAddress: binding.walletAddress,
      sweepTargetAddress: binding.sweepTargetAddress,
      issuedBy: binding.issuedBy,
      status: binding.status,
      createdAt: binding.createdAt,
      retiredAt: binding.retiredAt,
      disabledAt: binding.disabledAt,
      replacedByVirtualWalletId: binding.replacedByVirtualWalletId
    };
  }
}
