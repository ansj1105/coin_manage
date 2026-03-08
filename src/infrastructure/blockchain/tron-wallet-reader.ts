import { env } from '../../config/env.js';
import { getEffectiveKoriTokenContractAddress } from '../../config/runtime-settings.js';
import type { BlockchainReader, WalletMonitoringSnapshot } from '../../application/ports/blockchain-reader.js';

const TRONSCAN_API_BASE_URL = 'https://apilist.tronscanapi.com/api';
const DEFAULT_TOKEN_DECIMALS = 6;

const normalizeBigInt = (value: unknown, fallback = 0n): bigint => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value === 'bigint') {
    return value;
  }

  if (typeof value === 'number') {
    return BigInt(value);
  }

  if (typeof value === 'string') {
    return BigInt(value);
  }

  if (value && typeof value === 'object' && 'toString' in value && typeof value.toString === 'function') {
    return BigInt(value.toString());
  }

  return fallback;
};

const formatUnits = (rawValue: bigint, decimals: number): string => {
  const divisor = 10n ** BigInt(decimals);
  const whole = rawValue / divisor;
  const fraction = rawValue % divisor;
  const fractionText = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');

  if (!fractionText) {
    return whole.toString();
  }

  return `${whole.toString()}.${fractionText}`;
};

export class TronWalletReader implements BlockchainReader {
  async getWalletMonitoringSnapshot(address: string): Promise<WalletMonitoringSnapshot> {
    const fetchedAt = new Date().toISOString();
    const tokenContractAddress = getEffectiveKoriTokenContractAddress() ?? null;

    try {
      const account = await this.fetchJson('/accountv2', {
        address
      });
      const trxRawBalance = normalizeBigInt(account.balanceStr ?? account.balance);
      const trxBalance = formatUnits(trxRawBalance, 6);

      if (!tokenContractAddress) {
        return {
          address,
          tokenSymbol: 'KORI',
          tokenContractAddress: null,
          tokenBalance: null,
          tokenRawBalance: null,
          tokenDecimals: null,
          trxBalance,
          trxRawBalance: trxRawBalance.toString(),
          fetchedAt,
          status: 'error',
          error: 'KORI token contract address is not configured'
        };
      }

      const tokenPayload = await this.fetchJson('/account/tokens', {
        address,
        token: tokenContractAddress,
        start: '0',
        limit: '1',
        hidden: '1',
        show: '1',
        sortBy: '2',
        sortType: '0',
        assetType: '1'
      });

      const tokenRow = Array.isArray(tokenPayload.data) ? tokenPayload.data[0] : undefined;
      const contractInfo = tokenPayload.contractInfo?.[tokenContractAddress];
      const tokenDecimals = Number(tokenRow?.tokenDecimal ?? contractInfo?.tokenDecimal ?? DEFAULT_TOKEN_DECIMALS);
      const normalizedTokenDecimals = Number.isFinite(tokenDecimals) ? tokenDecimals : DEFAULT_TOKEN_DECIMALS;
      const tokenRawBalance = normalizeBigInt(tokenRow?.balance ?? tokenRow?.amount ?? tokenRow?.quantity);

      return {
        address,
        tokenSymbol: 'KORI',
        tokenContractAddress,
        tokenBalance: formatUnits(tokenRawBalance, normalizedTokenDecimals),
        tokenRawBalance: tokenRawBalance.toString(),
        tokenDecimals: normalizedTokenDecimals,
        trxBalance,
        trxRawBalance: trxRawBalance.toString(),
        fetchedAt,
        status: 'ok'
      };
    } catch (error) {
      return {
        address,
        tokenSymbol: 'KORI',
        tokenContractAddress,
        tokenBalance: null,
        tokenRawBalance: null,
        tokenDecimals: null,
        trxBalance: null,
        trxRawBalance: null,
        fetchedAt,
        status: 'error',
        error: error instanceof Error ? error.message : 'failed to fetch wallet monitoring snapshot'
      };
    }
  }

  private async fetchJson(pathname: string, query: Record<string, string>): Promise<any> {
    const url = new URL(`${TRONSCAN_API_BASE_URL}${pathname}`);
    Object.entries(query).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    const authenticatedResponse = await fetch(url, {
      headers: env.tronApiKey
        ? {
            'TRON-PRO-API-KEY': env.tronApiKey
          }
        : undefined
    });

    if (authenticatedResponse.ok) {
      return authenticatedResponse.json();
    }

    if (env.tronApiKey && authenticatedResponse.status === 401) {
      const fallbackResponse = await fetch(url);
      if (fallbackResponse.ok) {
        return fallbackResponse.json();
      }
      throw new Error(`TronScan fallback request failed with status code ${fallbackResponse.status}`);
    }

    throw new Error(`TronScan request failed with status code ${authenticatedResponse.status}`);
  }
}
