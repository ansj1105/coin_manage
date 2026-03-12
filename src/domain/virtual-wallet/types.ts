export type VirtualWalletStatus = 'active' | 'retired' | 'disabled';

export interface VirtualWalletBinding {
  virtualWalletId: string;
  userId: string;
  currencyId: number;
  network: 'mainnet' | 'testnet';
  walletAddress: string;
  sweepTargetAddress: string;
  issuedBy: 'hot_wallet';
  status: VirtualWalletStatus;
  createdAt: string;
  retiredAt?: string;
  disabledAt?: string;
  replacedByVirtualWalletId?: string;
}

export interface VirtualWalletIssueResult {
  binding: VirtualWalletBinding;
  duplicated: boolean;
}
