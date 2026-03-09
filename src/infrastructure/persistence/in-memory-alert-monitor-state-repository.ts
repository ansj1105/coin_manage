import type {
  AlertCursorState,
  AlertMonitorStateRepository,
  HealthCheckState
} from '../../application/ports/alert-monitor-state-repository.js';

export class InMemoryAlertMonitorStateRepository implements AlertMonitorStateRepository {
  private readonly cursors = new Map<string, AlertCursorState>();
  private readonly healthStates = new Map<string, HealthCheckState>();

  async getCursor(monitorKey: string): Promise<AlertCursorState | undefined> {
    const state = this.cursors.get(monitorKey);
    return state ? { ...state } : undefined;
  }

  async saveCursor(state: AlertCursorState): Promise<void> {
    this.cursors.set(state.monitorKey, { ...state });
  }

  async listCursors(): Promise<AlertCursorState[]> {
    return [...this.cursors.values()].map((item) => ({ ...item }));
  }

  async getHealthState(targetKey: string): Promise<HealthCheckState | undefined> {
    const state = this.healthStates.get(targetKey);
    return state ? { ...state } : undefined;
  }

  async saveHealthState(state: HealthCheckState): Promise<void> {
    this.healthStates.set(state.targetKey, { ...state });
  }

  async listHealthStates(): Promise<HealthCheckState[]> {
    return [...this.healthStates.values()].map((item) => ({ ...item }));
  }
}
