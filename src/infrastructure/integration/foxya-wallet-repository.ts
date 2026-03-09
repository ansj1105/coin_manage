import { createDecipheriv, createHash } from 'node:crypto';
import { Pool } from 'pg';
import type { FoxyaWalletRepository, FoxyaWalletSigner } from '../../application/ports/foxya-wallet-repository.js';

type FoxyaWalletRow = {
  user_id: string | number;
  currency_id: number;
  address: string;
  private_key: string | null;
};

const IV_LENGTH_BYTES = 16;
const TAG_LENGTH_BYTES = 16;

export class PostgresFoxyaWalletRepository implements FoxyaWalletRepository {
  constructor(
    private readonly pool: Pool,
    private readonly encryptionKey: string
  ) {}

  async getWalletSignerByAddress(input: { address: string; currencyId: number }): Promise<FoxyaWalletSigner | undefined> {
    const result = await this.pool.query<FoxyaWalletRow>(
      `
        select
          user_id,
          currency_id,
          address,
          private_key
        from user_wallets
        where lower(address) = lower($1)
          and currency_id = $2
          and deleted_at is null
        limit 1
      `,
      [input.address, input.currencyId]
    );

    const row = result.rows[0];
    if (!row?.private_key) {
      return undefined;
    }

    return {
      userId: String(row.user_id),
      currencyId: row.currency_id,
      address: row.address,
      privateKey: this.decryptPrivateKey(row.private_key)
    };
  }

  private decryptPrivateKey(encryptedValue: string) {
    const data = Buffer.from(encryptedValue, 'hex');
    if (data.length <= IV_LENGTH_BYTES + TAG_LENGTH_BYTES) {
      throw new Error('foxya encrypted private key format is invalid');
    }

    const iv = data.subarray(0, IV_LENGTH_BYTES);
    const cipherAndTag = data.subarray(IV_LENGTH_BYTES);
    const cipherText = cipherAndTag.subarray(0, cipherAndTag.length - TAG_LENGTH_BYTES);
    const authTag = cipherAndTag.subarray(cipherAndTag.length - TAG_LENGTH_BYTES);
    const key = createHash('sha256').update(this.encryptionKey).digest();
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(cipherText), decipher.final()]).toString('utf8');
  }
}
