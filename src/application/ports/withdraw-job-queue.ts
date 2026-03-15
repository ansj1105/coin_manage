export interface WithdrawJobQueue {
  enqueueDispatch(withdrawalId: string): Promise<void>;
  enqueueReconcile(withdrawalId?: string): Promise<void>;
  listFailed(limit: number): Promise<
    Array<{
      id: string;
      name: 'dispatch' | 'reconcile';
      withdrawalId?: string;
      failedReason?: string;
      attemptsMade: number;
    }>
  >;
  start(): void;
  stop(): Promise<void>;
}
