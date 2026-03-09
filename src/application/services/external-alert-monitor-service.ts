import type { AlertMonitorStateRepository, HealthCheckState, HealthCheckStatus } from '../ports/alert-monitor-state-repository.js';
import type { FoxyaAlertEvent, FoxyaAlertSourceRepository, FoxyaAlertTable } from '../ports/foxya-alert-source-repository.js';
import { AlertService } from './alert-service.js';

export interface HealthTarget {
  key: string;
  name: string;
  url: string;
}

type ExternalAlertMonitorOptions = {
  enabled: boolean;
  tables: FoxyaAlertTable[];
  healthTargets: HealthTarget[];
  eventLimit: number;
  healthFailureThreshold: number;
};

export class ExternalAlertMonitorService {
  private running = false;
  private lastRunAt?: string;
  private lastError?: string;

  constructor(
    private readonly stateRepository: AlertMonitorStateRepository,
    private readonly alertService: AlertService,
    private readonly foxyaSourceRepository: FoxyaAlertSourceRepository | undefined,
    private readonly options: ExternalAlertMonitorOptions
  ) {}

  async getStatus() {
    const [cursors, healthStates] = await Promise.all([
      this.stateRepository.listCursors(),
      this.stateRepository.listHealthStates()
    ]);

    return {
      enabled: this.options.enabled,
      running: this.running,
      lastRunAt: this.lastRunAt ?? null,
      lastError: this.lastError ?? null,
      foxyaEventSourceConfigured: Boolean(this.foxyaSourceRepository),
      eventTables: this.options.tables,
      eventLimit: this.options.eventLimit,
      healthFailureThreshold: this.options.healthFailureThreshold,
      healthTargets: this.options.healthTargets,
      cursors,
      healthStates
    };
  }

  async runCycle() {
    if (this.running) {
      return { skipped: true, reason: 'already_running' as const };
    }

    if (!this.options.enabled) {
      return { skipped: true, reason: 'disabled' as const };
    }

    this.running = true;
    const startedAt = new Date().toISOString();
    let initialized = 0;
    let alertedEvents = 0;
    let checkedTargets = 0;

    try {
      checkedTargets = await this.checkHealthTargets();
      alertedEvents = await this.processFoxyaEvents((count) => {
        initialized += count.initialized;
      });
      this.lastRunAt = startedAt;
      this.lastError = undefined;

      return {
        startedAt,
        checkedTargets,
        alertedEvents,
        initializedCursors: initialized
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown external alert monitor failure';
      this.lastRunAt = startedAt;
      this.lastError = message;
      await this.alertService.notifyExternalMonitorFailure(message);
      throw error;
    } finally {
      this.running = false;
    }
  }

  private async processFoxyaEvents(onInit: (input: { initialized: number }) => void) {
    if (!this.foxyaSourceRepository || !this.options.tables.length) {
      return 0;
    }

    let alertedEvents = 0;

    for (const table of this.options.tables) {
      const cursor = await this.stateRepository.getCursor(table);
      if (!cursor) {
        const maxId = await this.foxyaSourceRepository.getMaxId(table);
        await this.stateRepository.saveCursor({
          monitorKey: table,
          lastSeenId: maxId,
          updatedAt: new Date().toISOString()
        });
        onInit({ initialized: 1 });
        continue;
      }

      const events = await this.foxyaSourceRepository.listNewEvents(table, cursor.lastSeenId, this.options.eventLimit);
      if (!events.length) {
        continue;
      }

      for (const event of events) {
        await this.sendFoxyaEventAlert(event);
      }

      alertedEvents += events.length;
      await this.stateRepository.saveCursor({
        monitorKey: table,
        lastSeenId: events[events.length - 1].id,
        updatedAt: new Date().toISOString()
      });
    }

    return alertedEvents;
  }

  private async sendFoxyaEventAlert(event: FoxyaAlertEvent) {
    await this.alertService.notifyExternalEvent({
      title: event.title,
      bodyLines: event.lines,
      dedupeKey: `${event.table}:${event.eventId}`
    });
  }

  private async checkHealthTargets() {
    let checked = 0;

    for (const target of this.options.healthTargets) {
      checked += 1;
      const now = new Date().toISOString();
      const previous = await this.stateRepository.getHealthState(target.key);
      const current = await this.fetchTargetHealth(target, previous, now);
      await this.handleHealthTransition(target, previous, current);
      await this.stateRepository.saveHealthState(current);
    }

    return checked;
  }

  private async fetchTargetHealth(target: HealthTarget, previous: HealthCheckState | undefined, now: string): Promise<HealthCheckState> {
    try {
      const response = await fetch(target.url, {
        signal: AbortSignal.timeout(10000)
      });

      const payload = await this.safeReadPayload(response);
      const statusField = this.extractStatusField(payload);
      const healthy = response.ok && (!statusField || statusField === 'ok' || statusField === 'up');

      if (!healthy) {
        return this.buildUnhealthyState(
          target,
          previous,
          now,
          `status=${response.status}${statusField ? `, bodyStatus=${statusField}` : ''}`
        );
      }

      return {
        targetKey: target.key,
        targetName: target.name,
        targetUrl: target.url,
        lastStatus: 'healthy',
        consecutiveFailures: 0,
        lastCheckedAt: now,
        lastFailureAt: previous?.lastFailureAt,
        lastError: undefined
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'health request failed';
      return this.buildUnhealthyState(target, previous, now, message);
    }
  }

  private buildUnhealthyState(
    target: HealthTarget,
    previous: HealthCheckState | undefined,
    now: string,
    errorMessage: string
  ): HealthCheckState {
    return {
      targetKey: target.key,
      targetName: target.name,
      targetUrl: target.url,
      lastStatus: previous?.lastStatus === 'unhealthy' ? 'unhealthy' : 'healthy',
      consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
      lastCheckedAt: now,
      lastFailureAt: now,
      lastError: errorMessage
    };
  }

  private async handleHealthTransition(target: HealthTarget, previous: HealthCheckState | undefined, current: HealthCheckState) {
    const becameUnhealthy =
      current.consecutiveFailures >= this.options.healthFailureThreshold &&
      previous?.lastStatus !== 'unhealthy' &&
      current.lastError;

    if (becameUnhealthy) {
      const detail = current.lastError ?? 'health target reported unhealthy';
      current.lastStatus = 'unhealthy';
      await this.alertService.notifyHealthCheckUnhealthy({
        targetName: target.name,
        targetUrl: target.url,
        detail,
        consecutiveFailures: current.consecutiveFailures
      });
      return;
    }

    const recovered = previous?.lastStatus === 'unhealthy' && current.lastStatus === 'healthy';
    if (recovered) {
      await this.alertService.notifyHealthCheckRecovered({
        targetName: target.name,
        targetUrl: target.url
      });
    }
  }

  private async safeReadPayload(response: Response) {
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : undefined;
    } catch {
      return text;
    }
  }

  private extractStatusField(payload: unknown): string | undefined {
    if (!payload || typeof payload !== 'object') {
      return undefined;
    }

    const status = (payload as { status?: unknown }).status;
    return typeof status === 'string' ? status.toLowerCase() : undefined;
  }
}
