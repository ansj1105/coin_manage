export type VirtualWalletStatus = 'active' | 'retired' | 'disabled';
export type VirtualWalletActivationStatus =
  | 'pending_trx_grant'
  | 'trx_granted'
  | 'reclaim_pending'
  | 'reclaimed'
  | 'failed';
export type VirtualWalletResourceStatus =
  | 'idle'
  | 'delegate_pending'
  | 'delegated'
  | 'release_pending'
  | 'released'
  | 'failed';

export interface VirtualWalletBinding {
  virtualWalletId: string;
  userId: string;
  currencyId: number;
  network: 'mainnet' | 'testnet';
  walletAddress: string;
  sweepTargetAddress: string;
  issuedBy: 'hot_wallet';
  status: VirtualWalletStatus;
  activationStatus: VirtualWalletActivationStatus;
  activationGrantTxHash?: string;
  activationGrantedAt?: string;
  activationReclaimTxHash?: string;
  activationReclaimedAt?: string;
  activationLastError?: string;
  resourceStatus: VirtualWalletResourceStatus;
  resourceDelegatedAt?: string;
  resourceReleasedAt?: string;
  resourceLastError?: string;
  createdAt: string;
  retiredAt?: string;
  disabledAt?: string;
  replacedByVirtualWalletId?: string;
}

export interface VirtualWalletIssueResult {
  binding: VirtualWalletBinding;
  duplicated: boolean;
}
