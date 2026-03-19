import { DomainError } from '../../domain/errors/domain-error.js';
import type { FoxyaWalletRepository } from '../../application/ports/foxya-wallet-repository.js';
import type {
  ActivationReclaimSigningRequest,
  FoxyaSweepSigningRequest,
  PerWalletSigner
} from '../../application/ports/per-wallet-signer.js';
import type { TronGateway } from '../../application/ports/tron-gateway.js';
import type { VirtualWalletRepository } from '../../application/ports/virtual-wallet-repository.js';

export class LocalPerWalletSigner implements PerWalletSigner {
  constructor(
    private readonly virtualWalletRepository: VirtualWalletRepository,
    private readonly foxyaWalletRepository: FoxyaWalletRepository | undefined,
    private readonly tronGateway: TronGateway
  ) {}

  async broadcastActivationReclaim(request: ActivationReclaimSigningRequest): Promise<{ txHash: string }> {
    const signer = await this.virtualWalletRepository.getWalletSignerByAddress({
      address: request.walletAddress,
      currencyId: request.currencyId,
      network: request.network
    });
    if (!signer?.privateKey) {
      throw new DomainError(
        500,
        'VIRTUAL_WALLET_SIGNER_NOT_FOUND',
        'virtual wallet signer is required for activation reclaim'
      );
    }

    return this.tronGateway.broadcastNativeTransfer({
      toAddress: request.toAddress,
      amount: request.amountSun,
      network: request.network,
      fromAddress: signer.address,
      fromPrivateKey: signer.privateKey
    });
  }

  async broadcastFoxyaSweep(request: FoxyaSweepSigningRequest): Promise<{ txHash: string }> {
    if (!this.foxyaWalletRepository) {
      throw new DomainError(500, 'FOXYA_WALLET_SIGNER_NOT_CONFIGURED', 'foxya wallet signer repository is not configured');
    }

    const signer = await this.foxyaWalletRepository.getWalletSignerByAddress({
      address: request.sourceAddress,
      currencyId: request.currencyId
    });
    if (!signer?.privateKey) {
      throw new DomainError(404, 'FOXYA_WALLET_SIGNER_NOT_FOUND', 'foxya wallet signer not found');
    }

    return this.tronGateway.broadcastTransfer({
      toAddress: request.toAddress,
      amount: request.amountSun,
      network: request.network,
      fromAddress: signer.address,
      fromPrivateKey: signer.privateKey
    });
  }
}
