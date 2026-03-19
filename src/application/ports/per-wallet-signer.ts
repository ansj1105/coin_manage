import type { BlockchainNetwork } from '../../config/blockchain-networks.js';

export interface ActivationReclaimSigningRequest {
  virtualWalletId: string;
  walletAddress: string;
  currencyId: number;
  network?: BlockchainNetwork;
  toAddress: string;
  amountSun: bigint;
}

export interface FoxyaSweepSigningRequest {
  sourceAddress: string;
  currencyId: number;
  network?: BlockchainNetwork;
  toAddress: string;
  amountSun: bigint;
}

export interface PerWalletSigner {
  broadcastActivationReclaim(request: ActivationReclaimSigningRequest): Promise<{ txHash: string }>;
  broadcastFoxyaSweep(request: FoxyaSweepSigningRequest): Promise<{ txHash: string }>;
}
