import { TronWeb } from 'tronweb';
import { DomainError } from '../../domain/errors/domain-error.js';
import type { VirtualWalletBinding } from '../../domain/virtual-wallet/types.js';
import type { VirtualWalletRepository } from '../ports/virtual-wallet-repository.js';
import type { VirtualWalletSyncClient } from '../ports/virtual-wallet-sync-client.js';

export interface VirtualWalletKeyCipher {
  encrypt(value: string): string;
  decrypt?(value: string): string;
}

export interface GeneratedVirtualWalletAccount {
  address: string;
  privateKey: string;
}

export type VirtualWalletAccountGenerator = () => Promise<GeneratedVirtualWalletAccount>;

const createTronAccount: VirtualWalletAccountGenerator = async () => {
  const account = await TronWeb.createAccount();
  return {
    address: account.address.base58,
    privateKey: account.privateKey
  };
};

export class VirtualWalletService {
  constructor(
    private readonly repository: VirtualWalletRepository,
    private readonly keyCipher: VirtualWalletKeyCipher,
    private readonly hotWalletAddress: string,
    private readonly generateAccount: VirtualWalletAccountGenerator = createTronAccount,
    private readonly syncClient?: VirtualWalletSyncClient
  ) {}

  async issue(input: { userId: string; currencyId: number; network: 'mainnet' | 'testnet'; idempotencyKey: string }) {
    return this.issueInternal(input, false);
  }

  async reissue(input: { userId: string; currencyId: number; network: 'mainnet' | 'testnet'; idempotencyKey: string }) {
    return this.issueInternal(input, true);
  }

  async retire(input: { virtualWalletId: string }) {
    return this.repository.retireVirtualWallet(input);
  }

  async disable(input: { virtualWalletId: string }) {
    return this.repository.disableVirtualWallet(input);
  }

  async get(input: { userId?: string; walletAddress?: string }): Promise<VirtualWalletBinding | undefined> {
    return this.repository.getVirtualWallet(input);
  }

  private async issueInternal(
    input: { userId: string; currencyId: number; network: 'mainnet' | 'testnet'; idempotencyKey: string },
    reissue: boolean
  ) {
    const generated = await this.generateAccount();
    if (!generated.address || !generated.privateKey) {
      throw new DomainError(500, 'VIRTUAL_WALLET_GENERATION_FAILED', 'failed to generate virtual wallet account');
    }

    const issueMethod = reissue ? this.repository.reissueVirtualWallet.bind(this.repository) : this.repository.issueVirtualWallet.bind(this.repository);
    const issued = await issueMethod({
      userId: input.userId,
      currencyId: input.currencyId,
      network: input.network,
      walletAddress: generated.address,
      privateKey: generated.privateKey,
      encryptedPrivateKey: this.keyCipher.encrypt(generated.privateKey),
      sweepTargetAddress: this.hotWalletAddress,
      idempotencyKey: input.idempotencyKey
    });

    if (this.syncClient) {
      const signer = await this.repository.getWalletSignerByAddress({
        address: issued.binding.walletAddress,
        currencyId: issued.binding.currencyId,
        network: issued.binding.network
      });
      if (!signer?.privateKey) {
        throw new DomainError(
          500,
          'VIRTUAL_WALLET_SIGNER_NOT_FOUND',
          'virtual wallet signer could not be loaded after issuance'
        );
      }

      await this.syncClient.syncVirtualWallet({
        userId: issued.binding.userId,
        currencyId: issued.binding.currencyId,
        network: issued.binding.network,
        address: signer.address,
        privateKey: signer.privateKey
      });
    }

    return issued;
  }
}
