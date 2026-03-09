export interface FoxyaWalletSigner {
  userId: string;
  currencyId: number;
  address: string;
  privateKey: string;
}

export interface FoxyaWalletRepository {
  getWalletSignerByAddress(input: { address: string; currencyId: number }): Promise<FoxyaWalletSigner | undefined>;
}
