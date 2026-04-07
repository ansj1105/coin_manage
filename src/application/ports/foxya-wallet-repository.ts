export interface FoxyaWalletSigner {
  userId: string;
  currencyId: number;
  address: string;
  privateKey: string;
}

export interface FoxyaCanonicalWalletSnapshot {
  userId: string;
  currencyCode: string;
  totalBalance: string;
  lockedBalance: string;
  walletCount: number;
  canonicalBasis: string;
}

export interface FoxyaWalletRepository {
  getWalletSignerByAddress(input: { address: string; currencyId: number }): Promise<FoxyaWalletSigner | undefined>;
  getCanonicalWalletSnapshot(input: { userId: string; currencyCode: string }): Promise<FoxyaCanonicalWalletSnapshot>;
  listUserIdsWithPositiveCanonicalBalance(input: { currencyCode: string; limit: number }): Promise<string[]>;
}
