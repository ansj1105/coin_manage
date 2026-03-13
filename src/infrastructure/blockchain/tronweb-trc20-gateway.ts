import { TronWeb } from 'tronweb';
import { DomainError } from '../../domain/errors/domain-error.js';
import { env } from '../../config/env.js';
import { getBlockchainNetworkConfig } from '../../config/blockchain-networks.js';
import { getEffectiveKoriTokenContractAddress, getEffectiveTronApiUrl } from '../../config/runtime-settings.js';
import type { BroadcastRequest, ResourceDelegationRequest, TronGateway, TronResourceType } from '../../application/ports/tron-gateway.js';

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

  async broadcastNativeTransfer(request: BroadcastRequest): Promise<{ txHash: string }> {
    const privateKey = request.fromPrivateKey ?? env.hotWalletPrivateKey;
    const fromAddress = request.fromAddress ?? env.hotWalletAddress;
    const derivedAddress = TronWeb.address.fromPrivateKey(privateKey);
    if (!derivedAddress || derivedAddress !== fromAddress) {
      throw new DomainError(500, 'CONFIG_ERROR', 'broadcast signer private key does not match source address');
    }

    const tronWeb = this.createTronWeb(
      request.apiUrl ??
        (request.network ? getBlockchainNetworkConfig(request.network).tronApiUrl : getEffectiveTronApiUrl()),
      privateKey,
      fromAddress
    );

    const tx = await tronWeb.transactionBuilder.sendTrx(request.toAddress, Number(request.amount), fromAddress);
    const signed = await tronWeb.trx.sign(tx, privateKey);
    const broadcast = await tronWeb.trx.sendRawTransaction(signed);
    if (!broadcast.result || !broadcast.txid) {
      throw new DomainError(
        502,
        'TRON_NATIVE_BROADCAST_FAILED',
        broadcast.code ? String(broadcast.code) : 'native transfer broadcast failed'
      );
    }
    return { txHash: broadcast.txid };
  }

  async delegateResource(request: ResourceDelegationRequest): Promise<{ txHash: string }> {
    return this.broadcastResourceDelegation('delegate', request);
  }

  async undelegateResource(request: ResourceDelegationRequest): Promise<{ txHash: string }> {
    return this.broadcastResourceDelegation('undelegate', request);
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

  async getCanDelegatedMaxSize(
    address: string,
    resource: TronResourceType,
    network?: 'mainnet' | 'testnet'
  ): Promise<bigint> {
    const apiUrl = network ? getBlockchainNetworkConfig(network).tronApiUrl : getEffectiveTronApiUrl();
    const tronWeb = this.createTronWeb(apiUrl);
    const result = await tronWeb.trx.getCanDelegatedMaxSize(address, resource, { confirmed: true });
    return BigInt(result?.max_size ?? 0);
  }

  async getDelegatedResource(
    fromAddress: string,
    toAddress: string,
    resource: TronResourceType,
    network?: 'mainnet' | 'testnet'
  ): Promise<bigint> {
    const apiUrl = network ? getBlockchainNetworkConfig(network).tronApiUrl : getEffectiveTronApiUrl();
    const tronWeb = this.createTronWeb(apiUrl);
    const result = await tronWeb.trx.getDelegatedResourceV2(fromAddress, toAddress, { confirmed: true });
    const delegated = result?.delegatedResource;
    if (!delegated) {
      return 0n;
    }

    return resource === 'ENERGY'
      ? BigInt(delegated.frozen_balance_for_energy ?? 0)
      : BigInt(delegated.frozen_balance_for_bandwidth ?? 0);
  }

  private createTronWeb(fullHost: string, privateKey?: string, fromAddress?: string) {
    const tronWeb = new TronWeb({
      fullHost,
      headers: env.tronApiKey
        ? {
            'TRON-PRO-API-KEY': env.tronApiKey
          }
        : undefined,
      privateKey
    });
    if (fromAddress) {
      tronWeb.setAddress(fromAddress);
    }
    return tronWeb;
  }

  private async broadcastResourceDelegation(
    action: 'delegate' | 'undelegate',
    request: ResourceDelegationRequest
  ): Promise<{ txHash: string }> {
    const privateKey = request.fromPrivateKey ?? env.hotWalletPrivateKey;
    const fromAddress = request.fromAddress ?? env.hotWalletAddress;
    const derivedAddress = TronWeb.address.fromPrivateKey(privateKey);
    if (!derivedAddress || derivedAddress !== fromAddress) {
      throw new DomainError(500, 'CONFIG_ERROR', 'broadcast signer private key does not match source address');
    }

    const tronWeb = this.createTronWeb(
      request.network ? getBlockchainNetworkConfig(request.network).tronApiUrl : getEffectiveTronApiUrl(),
      privateKey,
      fromAddress
    );
    const tx =
      action === 'delegate'
        ? await tronWeb.transactionBuilder.delegateResource(
            Number(request.amountSun),
            request.receiverAddress,
            request.resource,
            fromAddress,
            request.lock ?? false,
            request.lockPeriod
          )
        : await tronWeb.transactionBuilder.undelegateResource(
            Number(request.amountSun),
            request.receiverAddress,
            request.resource,
            fromAddress
          );
    const signed = await tronWeb.trx.sign(tx, privateKey);
    const broadcast = await tronWeb.trx.sendRawTransaction(signed);
    if (!broadcast.result || !broadcast.txid) {
      throw new DomainError(
        502,
        action === 'delegate' ? 'TRON_RESOURCE_DELEGATE_FAILED' : 'TRON_RESOURCE_UNDELEGATE_FAILED',
        broadcast.code ? String(broadcast.code) : `${action} resource broadcast failed`
      );
    }
    return { txHash: broadcast.txid };
  }
}
