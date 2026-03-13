export interface VirtualWalletSyncClient {
  syncVirtualWallet(input: {
    userId: string;
    currencyId: number;
    network: 'mainnet' | 'testnet';
    address: string;
    privateKey?: string;
    verified?: boolean;
  }): Promise<void>;
}
