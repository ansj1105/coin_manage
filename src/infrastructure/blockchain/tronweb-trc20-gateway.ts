import { TronWeb } from 'tronweb';
import { DomainError } from '../../domain/errors/domain-error.js';
import { env } from '../../config/env.js';
import { getBlockchainNetworkConfig } from '../../config/blockchain-networks.js';
import { getEffectiveKoriTokenContractAddress, getEffectiveTronApiUrl } from '../../config/runtime-settings.js';
import type { BroadcastRequest, TronGateway } from '../../application/ports/tron-gateway.js';

const TRC20_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  }
] as const;

export class TronWebTrc20Gateway implements TronGateway {
  constructor() {
    const derivedAddress = TronWeb.address.fromPrivateKey(env.hotWalletPrivateKey);
    if (!derivedAddress || derivedAddress !== env.hotWalletAddress) {
      throw new Error('HOT_WALLET_PRIVATE_KEY does not match HOT_WALLET_ADDRESS');
    }
  }

  async broadcastTransfer(request: BroadcastRequest): Promise<{ txHash: string }> {
    const privateKey = request.fromPrivateKey ?? env.hotWalletPrivateKey;
    const fromAddress = request.fromAddress ?? env.hotWalletAddress;
    const derivedAddress = TronWeb.address.fromPrivateKey(privateKey);
    if (!derivedAddress || derivedAddress !== fromAddress) {
      throw new DomainError(500, 'CONFIG_ERROR', 'broadcast signer private key does not match source address');
    }

    const contractAddress =
      request.contractAddress ??
      (request.network ? getBlockchainNetworkConfig(request.network).contractAddress : getEffectiveKoriTokenContractAddress());
    if (!contractAddress) {
      throw new DomainError(500, 'CONFIG_ERROR', 'KORI_TOKEN_CONTRACT_ADDRESS is required for TRC20 transfers');
    }

    const tronWeb = this.createTronWeb(
      request.apiUrl ??
        (request.network ? getBlockchainNetworkConfig(request.network).tronApiUrl : getEffectiveTronApiUrl()),
      privateKey,
      fromAddress
    );
    const contract = await tronWeb.contract(TRC20_ABI, contractAddress).at(contractAddress);
    const txHash = await contract.transfer(request.toAddress, request.amount.toString()).send({
      feeLimit: env.tronFeeLimitSun,
      shouldPollResponse: false
    });

    return { txHash };
  }

  async getTransactionReceipt(txHash: string): Promise<'pending' | 'confirmed' | 'failed'> {
    const info = await this.createTronWeb(getEffectiveTronApiUrl()).trx.getTransactionInfo(txHash);
    if (!info || Object.keys(info).length === 0) {
      return 'pending';
    }
    if (info.result === 'FAILED') {
      return 'failed';
    }
    return 'confirmed';
  }

  async getAccountResources(address: string, network?: 'mainnet' | 'testnet'): Promise<{
    trxBalanceSun: bigint;
    energyLimit: number;
    energyUsed: number;
    bandwidthLimit: number;
    bandwidthUsed: number;
  }> {
    const apiUrl = network ? getBlockchainNetworkConfig(network).tronApiUrl : getEffectiveTronApiUrl();
    const tronWeb = this.createTronWeb(apiUrl);
    const [balance, rawResources] = await Promise.all([
      tronWeb.trx.getBalance(address),
      tronWeb.trx.getAccountResources(address).catch(() => ({}))
    ]);
    const resources = rawResources as Record<string, number | string | undefined>;

    return {
      trxBalanceSun: BigInt(balance ?? 0),
      energyLimit: Number(resources.EnergyLimit ?? 0),
      energyUsed: Number(resources.EnergyUsed ?? 0),
      bandwidthLimit: Number(resources.freeNetLimit ?? resources.NetLimit ?? 0),
      bandwidthUsed: Number(resources.freeNetUsed ?? resources.NetUsed ?? 0)
    };
  }

  private createTronWeb(fullHost: string, privateKey = env.hotWalletPrivateKey, fromAddress = env.hotWalletAddress) {
    const tronWeb = new TronWeb({
      fullHost,
      headers: env.tronApiKey
        ? {
            'TRON-PRO-API-KEY': env.tronApiKey
          }
        : undefined,
      privateKey
    });
    tronWeb.setAddress(fromAddress);
    return tronWeb;
  }
}
