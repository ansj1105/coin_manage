export type HealthCheckStatus = 'healthy' | 'unhealthy';

export interface AlertCursorState {
  monitorKey: string;
  lastSeenId: number;
  updatedAt: string;
}

export interface HealthCheckState {
  targetKey: string;
  targetName: string;
  targetUrl: string;
  lastStatus: HealthCheckStatus;
  consecutiveFailures: number;
  lastCheckedAt: string;
  lastFailureAt?: string;
  lastError?: string;
}

export interface AlertMonitorStateRepository {
  getCursor(monitorKey: string): Promise<AlertCursorState | undefined>;
  saveCursor(state: AlertCursorState): Promise<void>;
  listCursors(): Promise<AlertCursorState[]>;
  getHealthState(targetKey: string): Promise<HealthCheckState | undefined>;
  saveHealthState(state: HealthCheckState): Promise<void>;
  listHealthStates(): Promise<HealthCheckState[]>;
}
