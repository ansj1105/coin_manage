import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { VirtualWalletKeyCipher } from '../../application/services/virtual-wallet-service.js';

const IV_LENGTH_BYTES = 16;
const TAG_LENGTH_BYTES = 16;

export class AesGcmVirtualWalletKeyCipher implements VirtualWalletKeyCipher {
  constructor(private readonly encryptionKey: string) {}

  encrypt(value: string): string {
    const iv = randomBytes(IV_LENGTH_BYTES);
    const key = createHash('sha256').update(this.encryptionKey).digest();
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return Buffer.concat([iv, encrypted, tag]).toString('hex');
  }

  decrypt(value: string): string {
    const data = Buffer.from(value, 'hex');
    if (data.length <= IV_LENGTH_BYTES + TAG_LENGTH_BYTES) {
      throw new Error('virtual wallet encrypted private key format is invalid');
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
