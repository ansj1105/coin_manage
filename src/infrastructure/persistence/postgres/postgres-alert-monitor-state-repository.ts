import type { Kysely } from 'kysely';
import type {
  AlertCursorState,
  AlertMonitorStateRepository,
  HealthCheckState
} from '../../../application/ports/alert-monitor-state-repository.js';
import type { KorionDatabase } from './db-schema.js';

export class PostgresAlertMonitorStateRepository implements AlertMonitorStateRepository {
  constructor(private readonly db: Kysely<KorionDatabase>) {}

  async getCursor(monitorKey: string): Promise<AlertCursorState | undefined> {
    const row = await this.db.selectFrom('alert_monitor_cursors').selectAll().where('monitor_key', '=', monitorKey).executeTakeFirst();
    if (!row) {
      return undefined;
    }

    return {
      monitorKey: row.monitor_key,
      lastSeenId: Number(row.last_seen_id),
      updatedAt: row.updated_at
    };
  }

  async saveCursor(state: AlertCursorState): Promise<void> {
    await this.db
      .insertInto('alert_monitor_cursors')
      .values({
        monitor_key: state.monitorKey,
        last_seen_id: String(state.lastSeenId),
        updated_at: state.updatedAt
      })
      .onConflict((oc) =>
        oc.column('monitor_key').doUpdateSet({
          last_seen_id: String(state.lastSeenId),
          updated_at: state.updatedAt
        })
      )
      .execute();
  }

  async listCursors(): Promise<AlertCursorState[]> {
    const rows = await this.db.selectFrom('alert_monitor_cursors').selectAll().orderBy('monitor_key asc').execute();
    return rows.map((row) => ({
      monitorKey: row.monitor_key,
      lastSeenId: Number(row.last_seen_id),
      updatedAt: row.updated_at
    }));
  }

  async getHealthState(targetKey: string): Promise<HealthCheckState | undefined> {
    const row = await this.db.selectFrom('health_check_states').selectAll().where('target_key', '=', targetKey).executeTakeFirst();
    if (!row) {
      return undefined;
    }

    return {
      targetKey: row.target_key,
      targetName: row.target_name,
      targetUrl: row.target_url,
      lastStatus: row.last_status,
      consecutiveFailures: row.consecutive_failures,
      lastCheckedAt: row.last_checked_at,
      lastFailureAt: row.last_failure_at ?? undefined,
      lastError: row.last_error ?? undefined
    };
  }

  async saveHealthState(state: HealthCheckState): Promise<void> {
    await this.db
      .insertInto('health_check_states')
      .values({
        target_key: state.targetKey,
        target_name: state.targetName,
        target_url: state.targetUrl,
        last_status: state.lastStatus,
        consecutive_failures: state.consecutiveFailures,
        last_checked_at: state.lastCheckedAt,
        last_failure_at: state.lastFailureAt ?? null,
        last_error: state.lastError ?? null
      })
      .onConflict((oc) =>
        oc.column('target_key').doUpdateSet({
          target_name: state.targetName,
          target_url: state.targetUrl,
          last_status: state.lastStatus,
          consecutive_failures: state.consecutiveFailures,
          last_checked_at: state.lastCheckedAt,
          last_failure_at: state.lastFailureAt ?? null,
          last_error: state.lastError ?? null
        })
      )
      .execute();
  }

  async listHealthStates(): Promise<HealthCheckState[]> {
    const rows = await this.db.selectFrom('health_check_states').selectAll().orderBy('target_key asc').execute();
    return rows.map((row) => ({
      targetKey: row.target_key,
      targetName: row.target_name,
      targetUrl: row.target_url,
      lastStatus: row.last_status,
      consecutiveFailures: row.consecutive_failures,
      lastCheckedAt: row.last_checked_at,
      lastFailureAt: row.last_failure_at ?? undefined,
      lastError: row.last_error ?? undefined
    }));
  }
}
