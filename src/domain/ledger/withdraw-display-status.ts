import type { Withdrawal } from './types.js';

export type WithdrawalDisplayStatus =
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'sending'
  | 'completed'
  | 'failed'
  | 'rejected';

export const mapWithdrawalDisplayStatus = (withdrawal: Pick<Withdrawal, 'status' | 'approvalCount'>): WithdrawalDisplayStatus => {
  switch (withdrawal.status) {
    case 'LEDGER_RESERVED':
      return 'submitted';
    case 'PENDING_ADMIN':
      return withdrawal.approvalCount > 0 ? 'under_review' : 'submitted';
    case 'ADMIN_APPROVED':
      return 'approved';
    case 'TX_BROADCASTED':
      return 'sending';
    case 'COMPLETED':
      return 'completed';
    case 'FAILED':
      return 'failed';
    case 'REJECTED':
      return 'rejected';
    default:
      return 'under_review';
  }
};
