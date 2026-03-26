import { createDecipheriv, createHash } from 'node:crypto';
import { Pool } from 'pg';
import type {
  FoxyaCanonicalWalletSnapshot,
  FoxyaWalletRepository,
  FoxyaWalletSigner
} from '../../application/ports/foxya-wallet-repository.js';

type FoxyaWalletRow = {
  user_id: string | number;
  currency_id: number;
  address: string;
  private_key: string | null;
};

type FoxyaCanonicalWalletSnapshotRow = {
  user_id: string | number;
  currency_code: string;
  total_balance: string;
  locked_balance: string;
  wallet_count: string | number;
};

const IV_LENGTH_BYTES = 16;
const TAG_LENGTH_BYTES = 16;

export class PostgresFoxyaWalletRepository implements FoxyaWalletRepository {
  constructor(
    private readonly pool: Pool,
    private readonly encryptionKey?: string
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

  async getCanonicalWalletSnapshot(input: { userId: string; currencyCode: string }): Promise<FoxyaCanonicalWalletSnapshot> {
    const result = await this.pool.query<FoxyaCanonicalWalletSnapshotRow>(
      `
        select
          uw.user_id,
          c.code as currency_code,
          coalesce(sum(uw.balance), 0)::text as total_balance,
          coalesce(sum(uw.locked_balance), 0)::text as locked_balance,
          count(*)::text as wallet_count
        from user_wallets uw
        join currency c on c.id = uw.currency_id
        where uw.user_id = $1
          and upper(c.code) = upper($2)
          and uw.deleted_at is null
          and upper(coalesce(uw.status, 'ACTIVE')) = 'ACTIVE'
        group by uw.user_id, c.code
      `,
      [input.userId, input.currencyCode]
    );

    const row = result.rows[0];
    if (!row) {
      return {
        userId: input.userId,
        currencyCode: input.currencyCode.toUpperCase(),
        totalBalance: '0',
        lockedBalance: '0',
        walletCount: 0,
        canonicalBasis: 'FOX_CLIENT_VISIBLE_TOTAL_KORI'
      };
    }

    return {
      userId: String(row.user_id),
      currencyCode: row.currency_code,
      totalBalance: row.total_balance,
      lockedBalance: row.locked_balance,
      walletCount: Number(row.wallet_count),
      canonicalBasis: 'FOX_CLIENT_VISIBLE_TOTAL_KORI'
    };
  }

  private decryptPrivateKey(encryptedValue: string) {
    if (!this.encryptionKey) {
      throw new Error('foxya encryption key is required to decrypt wallet signer');
    }
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
