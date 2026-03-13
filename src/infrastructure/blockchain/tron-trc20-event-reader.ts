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
      const hexValue = value.startsWith('0x') ? `41${value.slice(2)}` : value;
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

const isUnauthorizedError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'response' in error &&
  typeof (error as { response?: { status?: unknown } }).response?.status === 'number' &&
  [401, 403].includes((error as { response: { status: number } }).response.status);

export class TronTrc20EventReader implements Trc20EventReader {
  async listTransfers(input: {
    network: BlockchainNetwork;
    contractAddress: string;
    minBlockTimestamp: number;
    fingerprint?: string;
    limit: number;
  }): Promise<Trc20TransferPage> {
    const response = (await this.withApiKeyFallback(input.network, async (tronWeb) =>
      (await tronWeb.getEventResult(input.contractAddress, {
        eventName: 'Transfer',
        minBlockTimestamp: input.minBlockTimestamp,
        orderBy: 'block_timestamp,asc',
        fingerprint: input.fingerprint,
        limit: input.limit
      })) as TronEventResponse
    )) as TronEventResponse;

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
    const block = await this.withApiKeyFallback(network, async (tronWeb) => tronWeb.trx.getCurrentBlock());
    return block?.block_header?.raw_data?.number ?? 0;
  }

  private createTronWeb(network: BlockchainNetwork, useApiKey = true) {
    const { tronApiUrl } = getBlockchainNetworkConfig(network);
    return new TronWeb({
      fullHost: tronApiUrl,
      headers: useApiKey ? buildHeaders() : undefined
    });
  }

  private async withApiKeyFallback<T>(
    network: BlockchainNetwork,
    action: (tronWeb: TronWeb) => Promise<T>
  ): Promise<T> {
    try {
      return await action(this.createTronWeb(network, true));
    } catch (error) {
      if (!env.tronApiKey || !isUnauthorizedError(error)) {
        throw error;
      }

      console.warn('TRON API key rejected for read-only request, retrying without key');
      return action(this.createTronWeb(network, false));
    }
  }
}
