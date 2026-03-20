import crypto from 'node:crypto';

export const computeOfflinePayProofFingerprint = (input: {
  settlementId: string;
  batchId: string;
  collateralId: string;
  proofId: string;
  deviceId: string;
  newStateHash: string;
  previousHash: string;
  monotonicCounter: number;
  nonce: string;
  signature: string;
}) =>
  crypto
    .createHash('sha256')
    .update(
      [
        input.settlementId,
        input.batchId,
        input.collateralId,
        input.proofId,
        input.deviceId,
        input.newStateHash,
        input.previousHash,
        String(input.monotonicCounter),
        input.nonce,
        input.signature
      ].join('|')
    )
    .digest('hex');
