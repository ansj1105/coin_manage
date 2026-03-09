import { TronWeb } from 'tronweb';
import { getBlockchainNetworkConfig, type BlockchainNetwork } from '../../config/blockchain-networks.js';
import { env } from '../../config/env.js';
import type { Trc20EventReader, Trc20TransferPage } from '../../application/ports/trc20-event-reader.js';

type TronEventResponse = {
  data?: Array<{
    block_number: number;
    block_timestamp: number;
    event_index: number;
    result: Record<string, string>;
    transaction_id: string;
    _unconfirmed: boolean;
  }>;
  meta?: {
    fingerprint?: string;
  };
};

const normalizeAddress = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  if (value.startsWith('41') || value.startsWith('0x')) {
    try {
      const hexValue = value.startsWith('0x') ? value.slice(2) : value;
      return TronWeb.address.fromHex(hexValue);
    } catch {
      return value;
    }
  }

  return value;
};

const buildHeaders = () =>
  env.tronApiKey
    ? {
        'TRON-PRO-API-KEY': env.tronApiKey
      }
    : undefined;

export class TronTrc20EventReader implements Trc20EventReader {
  async listTransfers(input: {
    network: BlockchainNetwork;
    contractAddress: string;
    minBlockTimestamp: number;
    fingerprint?: string;
    limit: number;
  }): Promise<Trc20TransferPage> {
    const tronWeb = this.createTronWeb(input.network);
    const response = (await tronWeb.getEventResult(input.contractAddress, {
      eventName: 'Transfer',
      minBlockTimestamp: input.minBlockTimestamp,
      orderBy: 'block_timestamp,asc',
      fingerprint: input.fingerprint,
      limit: input.limit
    })) as TronEventResponse;

    const events = (response.data ?? []).map((event) => ({
      txHash: event.transaction_id,
      eventIndex: event.event_index ?? 0,
      blockNumber: event.block_number,
      blockTimestampMs: event.block_timestamp,
      fromAddress: normalizeAddress(event.result.from),
      toAddress: normalizeAddress(event.result.to),
      amountRaw: event.result.value ?? '0',
      confirmed: event._unconfirmed !== true
    }));

    return {
      events,
      nextFingerprint: response.meta?.fingerprint
    };
  }

  async getCurrentBlockNumber(network: BlockchainNetwork): Promise<number> {
    const block = await this.createTronWeb(network).trx.getCurrentBlock();
    return block?.block_header?.raw_data?.number ?? 0;
  }

  private createTronWeb(network: BlockchainNetwork) {
    const { tronApiUrl } = getBlockchainNetworkConfig(network);
    return new TronWeb({
      fullHost: tronApiUrl,
      headers: buildHeaders()
    });
  }
}
