import {
  PER_WALLET_SIGNER_SCHEMA_VERSION,
  perWalletSignerTxResponseSchema,
  type PerWalletActivationReclaimRequestContract,
  type PerWalletFoxyaSweepRequestContract
} from '../../contracts/per-wallet-signer-contracts.js';
import { DomainError } from '../../domain/errors/domain-error.js';
import type {
  ActivationReclaimSigningRequest,
  FoxyaSweepSigningRequest,
  PerWalletSigner
} from '../../application/ports/per-wallet-signer.js';

export class HttpPerWalletSigner implements PerWalletSigner {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string
  ) {}

  async broadcastActivationReclaim(request: ActivationReclaimSigningRequest): Promise<{ txHash: string }> {
    return this.post(`/virtual-wallets/${request.virtualWalletId}/activation-reclaim`, {
      schemaVersion: PER_WALLET_SIGNER_SCHEMA_VERSION,
      toAddress: request.toAddress,
      amountSun: request.amountSun.toString(),
      network: request.network
    } satisfies PerWalletActivationReclaimRequestContract);
  }

  async broadcastFoxyaSweep(request: FoxyaSweepSigningRequest): Promise<{ txHash: string }> {
    return this.post('/foxya-wallets/sweep', {
      schemaVersion: PER_WALLET_SIGNER_SCHEMA_VERSION,
      sourceAddress: request.sourceAddress,
      currencyId: request.currencyId,
      toAddress: request.toAddress,
      amountSun: request.amountSun.toString(),
      network: request.network
    } satisfies PerWalletFoxyaSweepRequestContract);
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
      throw new DomainError(502, 'PER_WALLET_SIGNER_REMOTE_FAILED', `per-wallet signer request failed with status ${response.status}`);
    }

    const parsed = perWalletSignerTxResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new DomainError(502, 'PER_WALLET_SIGNER_REMOTE_INVALID_RESPONSE', 'per-wallet signer returned invalid response', {
        issues: parsed.error.flatten()
      });
    }

    return { txHash: parsed.data.txHash };
  }
}
