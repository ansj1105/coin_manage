import type { BlockchainNetwork } from '../../config/blockchain-networks.js';

export interface Trc20TransferEvent {
  txHash: string;
  eventIndex: number;
  blockNumber: number;
  blockTimestampMs: number;
  fromAddress?: string;
  toAddress?: string;
  amountRaw: string;
  confirmed: boolean;
}

export interface Trc20TransferPage {
  events: Trc20TransferEvent[];
  nextFingerprint?: string;
}

export interface Trc20EventReader {
  listTransfers(input: {
    network: BlockchainNetwork;
    contractAddress: string;
    minBlockTimestamp: number;
    fingerprint?: string;
    limit: number;
  }): Promise<Trc20TransferPage>;
  getCurrentBlockNumber(network: BlockchainNetwork): Promise<number>;
}
