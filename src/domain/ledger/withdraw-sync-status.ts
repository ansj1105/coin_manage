import type { Withdrawal } from './types.js';
import type { WithdrawBridgeStateResponseContract } from '../../contracts/withdraw-bridge-contracts.js';

export const mapWithdrawalToSyncStatus = (
  withdrawal: Withdrawal
): WithdrawBridgeStateResponseContract['status'] => {
  switch (withdrawal.status) {
    case 'TX_BROADCASTED':
      return 'SENT';
    case 'COMPLETED':
      return 'COMPLETED';
    case 'FAILED':
    case 'REJECTED':
      return 'FAILED';
    default:
      return 'PROCESSING';
  }
};
