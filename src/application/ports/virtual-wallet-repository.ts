import type { DepositWatchAddress } from '../../domain/deposit-monitor/types.js';
import type { FoxyaWalletSigner } from './foxya-wallet-repository.js';
import type { VirtualWalletBinding, VirtualWalletIssueResult } from '../../domain/virtual-wallet/types.js';

export interface VirtualWalletRepository {
  issueVirtualWallet(input: {
    userId: string;
    currencyId: number;
    network: 'mainnet' | 'testnet';
    walletAddress: string;
    privateKey: string;
    encryptedPrivateKey: string;
    sweepTargetAddress: string;
    idempotencyKey: string;
    nowIso?: string;
  }): Promise<VirtualWalletIssueResult>;
  reissueVirtualWallet(input: {
    userId: string;
    currencyId: number;
    network: 'mainnet' | 'testnet';
    walletAddress: string;
    privateKey: string;
    encryptedPrivateKey: string;
    sweepTargetAddress: string;
    idempotencyKey: string;
    nowIso?: string;
  }): Promise<VirtualWalletIssueResult>;
  getVirtualWallet(input: { userId?: string; walletAddress?: string }): Promise<VirtualWalletBinding | undefined>;
  retireVirtualWallet(input: { virtualWalletId: string; replacedByVirtualWalletId?: string; nowIso?: string }): Promise<VirtualWalletBinding>;
  disableVirtualWallet(input: { virtualWalletId: string; nowIso?: string }): Promise<VirtualWalletBinding>;
  listWatchAddresses(network: 'mainnet' | 'testnet'): Promise<DepositWatchAddress[]>;
  getWalletSignerByAddress(input: {
    address: string;
    currencyId: number;
    network?: 'mainnet' | 'testnet';
  }): Promise<FoxyaWalletSigner | undefined>;
}
