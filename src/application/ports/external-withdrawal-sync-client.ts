import type { WithdrawalStateChangedContract } from '../../contracts/ledger-contracts.js';

export interface ExternalWithdrawalSyncClient {
  syncWithdrawalState(contract: WithdrawalStateChangedContract): Promise<void>;
}
