import { TronWeb } from 'tronweb';
import { DomainError } from '../../domain/errors/domain-error.js';
import { env } from '../../config/env.js';
import type { TronGateway } from '../../application/ports/tron-gateway.js';

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
  private readonly tronWeb: TronWeb;

  constructor() {
    this.tronWeb = new TronWeb({
      fullHost: env.tronApiUrl,
      privateKey: env.hotWalletPrivateKey
    });

    const derivedAddress = TronWeb.address.fromPrivateKey(env.hotWalletPrivateKey);
    if (!derivedAddress || derivedAddress !== env.hotWalletAddress) {
      throw new Error('HOT_WALLET_PRIVATE_KEY does not match HOT_WALLET_ADDRESS');
    }
  }

  async broadcastTransfer(request: { toAddress: string; amount: bigint }): Promise<{ txHash: string }> {
    if (!env.koriTokenContractAddress) {
      throw new DomainError(500, 'CONFIG_ERROR', 'KORI_TOKEN_CONTRACT_ADDRESS is required for TRC20 transfers');
    }

    const contract = await this.tronWeb.contract(TRC20_ABI, env.koriTokenContractAddress).at(env.koriTokenContractAddress);
    const txHash = await contract.transfer(request.toAddress, request.amount.toString()).send({
      feeLimit: env.tronFeeLimitSun,
      shouldPollResponse: false
    });

    return { txHash };
  }

  async getTransactionReceipt(txHash: string): Promise<'pending' | 'confirmed' | 'failed'> {
    const info = await this.tronWeb.trx.getTransactionInfo(txHash);
    if (!info || Object.keys(info).length === 0) {
      return 'pending';
    }
    if (info.result === 'FAILED') {
      return 'failed';
    }
    return 'confirmed';
  }
}
