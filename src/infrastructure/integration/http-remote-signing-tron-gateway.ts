import { DomainError } from '../../domain/errors/domain-error.js';
import {
  TRON_SIGNER_SCHEMA_VERSION,
  tronSignerTxResponseSchema
} from '../../contracts/tron-signer-contracts.js';
import type {
  BroadcastRequest,
  ResourceDelegationRequest,
  TronAccountResources,
  TronGateway,
  TronReceiptStatus,
  TronResourceType,
  TronTransactionReceipt
} from '../../application/ports/tron-gateway.js';

export class HttpRemoteSigningTronGateway implements TronGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    private readonly readerGateway: TronGateway
  ) {}

  async broadcastTransfer(request: BroadcastRequest): Promise<{ txHash: string }> {
    this.assertHotWalletOnly(request.fromPrivateKey);
    return this.post('/tron/broadcast-transfer', {
      schemaVersion: TRON_SIGNER_SCHEMA_VERSION,
      toAddress: request.toAddress,
      amountSun: request.amount.toString(),
      network: request.network,
      apiUrl: request.apiUrl,
      contractAddress: request.contractAddress,
      fromAddress: request.fromAddress
    });
  }

  async broadcastNativeTransfer(request: BroadcastRequest): Promise<{ txHash: string }> {
    this.assertHotWalletOnly(request.fromPrivateKey);
    return this.post('/tron/broadcast-native', {
      schemaVersion: TRON_SIGNER_SCHEMA_VERSION,
      toAddress: request.toAddress,
      amountSun: request.amount.toString(),
      network: request.network,
      apiUrl: request.apiUrl,
      fromAddress: request.fromAddress
    });
  }

  async delegateResource(request: ResourceDelegationRequest): Promise<{ txHash: string }> {
    this.assertHotWalletOnly(request.fromPrivateKey);
    return this.post('/tron/delegate-resource', {
      schemaVersion: TRON_SIGNER_SCHEMA_VERSION,
      receiverAddress: request.receiverAddress,
      amountSun: request.amountSun.toString(),
      resource: request.resource,
      network: request.network,
      fromAddress: request.fromAddress,
      lock: request.lock,
      lockPeriod: request.lockPeriod
    });
  }

  async undelegateResource(request: ResourceDelegationRequest): Promise<{ txHash: string }> {
    this.assertHotWalletOnly(request.fromPrivateKey);
    return this.post('/tron/undelegate-resource', {
      schemaVersion: TRON_SIGNER_SCHEMA_VERSION,
      receiverAddress: request.receiverAddress,
      amountSun: request.amountSun.toString(),
      resource: request.resource,
      network: request.network,
      fromAddress: request.fromAddress,
      lock: request.lock,
      lockPeriod: request.lockPeriod
    });
  }

  async getTransactionReceipt(txHash: string): Promise<TronReceiptStatus> {
    return this.readerGateway.getTransactionReceipt(txHash);
  }

  async getTransactionReceiptDetails(txHash: string): Promise<TronTransactionReceipt> {
    return this.readerGateway.getTransactionReceiptDetails(txHash);
  }

  async getAccountResources(address: string, network?: 'mainnet' | 'testnet'): Promise<TronAccountResources> {
    return this.readerGateway.getAccountResources(address, network);
  }

  async getCanDelegatedMaxSize(
    address: string,
    resource: TronResourceType,
    network?: 'mainnet' | 'testnet'
  ): Promise<bigint> {
    return this.readerGateway.getCanDelegatedMaxSize(address, resource, network);
  }

  async getDelegatedResource(
    fromAddress: string,
    toAddress: string,
    resource: TronResourceType,
    network?: 'mainnet' | 'testnet'
  ): Promise<bigint> {
    return this.readerGateway.getDelegatedResource(fromAddress, toAddress, resource, network);
  }

  private assertHotWalletOnly(fromPrivateKey?: string) {
    if (fromPrivateKey) {
      throw new DomainError(
        409,
        'REMOTE_SIGNER_UNSUPPORTED_SIGNER_MATERIAL',
        'remote signer gateway does not accept inline private keys'
      );
    }
  }

  private async post(path: string, body: Record<string, unknown>): Promise<{ txHash: string }> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.apiKey ? { 'x-internal-api-key': this.apiKey } : {})
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new DomainError(502, 'TRON_SIGNER_REMOTE_FAILED', `tron signer request failed with status ${response.status}`);
    }

    const parsed = tronSignerTxResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new DomainError(502, 'TRON_SIGNER_REMOTE_INVALID_RESPONSE', 'tron signer returned invalid response', {
        issues: parsed.error.flatten()
      });
    }

    return { txHash: parsed.data.txHash };
  }
}
