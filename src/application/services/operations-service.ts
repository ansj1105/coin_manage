import type { Pool } from 'pg';
import { env } from '../../config/env.js';
import { createPostgresPool } from '../../infrastructure/persistence/postgres/postgres-pool.js';
import { getConfiguredSystemWallets } from '../../config/system-wallets.js';
import { formatKoriAmount, parseKoriAmount, parseStoredKoriAmount } from '../../domain/value-objects/money.js';
import type { NetworkFeeReceipt } from '../../domain/ledger/types.js';
import type { WithdrawJobQueue } from '../ports/withdraw-job-queue.js';
import type { LedgerRepository } from '../ports/ledger-repository.js';
import {
  isOfflinePayOutboxEvent,
  resolveOfflineFailureClass,
  resolveOfflineSagaStatus,
  resolveOfflineWorkflowStage
} from './offline-workflow-state.js';
import { SystemMonitoringService } from './system-monitoring-service.js';
import type { WithdrawPolicyService } from './withdraw-policy-service.js';
import type { WithdrawAddressPolicyType } from '../../domain/withdraw-policy/types.js';
import type { WithdrawGuardService } from './withdraw-guard-service.js';

type ExternalSyncFailureItem = {
  withdrawalId: string;
  createdAt: string;
  status: string;
  error: string;
  occurredAt: string;
  txHash: string;
  failedJob: {
    attemptsMade: number;
    failedReason: string;
  } | null;
};

type WithdrawalRiskEventSeverity = 'low' | 'medium' | 'high' | 'critical';

type WithdrawalRiskEvent = {
  eventId: string;
  address: string;
  signal: string;
  severity: WithdrawalRiskEventSeverity;
  reason: string;
  createdAt: string;
  actorId: string;
  blacklistPolicyType: WithdrawAddressPolicyType | null;
};

type OfflinePayOperationType = 'SETTLEMENT' | 'COLLATERAL_TOPUP' | 'COLLATERAL_RELEASE';
type OfflinePayOperationStatus = 'completed' | 'pending' | 'failed';

type OfflinePayOperationItem = {
  id: string;
  operationType: OfflinePayOperationType;
  status: OfflinePayOperationStatus;
  workflowStage: string;
  sagaStatus: string;
  failureClass: string | null;
  assetCode: string;
  amount: string;
  userId: string;
  deviceId: string;
  referenceId: string;
  source: 'audit' | 'outbox';
  createdAt: string;
  lastError: string | null;
};

type OfflinePayOperationOverview = {
  summary: {
    completedCount: number;
    pendingCount: number;
    failedCount: number;
    settlementCount: number;
    collateralTopupCount: number;
    collateralReleaseCount: number;
  };
  items: OfflinePayOperationItem[];
};

const formatTrxSunAmount = (value: bigint) => {
  const negative = value < 0n;
  const absolute = negative ? value * -1n : value;
  const whole = absolute / 1_000_000n;
  const fraction = (absolute % 1_000_000n).toString().padStart(6, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
};

export class OperationsService {
  private readonly runtimeDbPool: Pool | undefined;

  constructor(
    private readonly ledger: LedgerRepository,
    private readonly systemMonitoringService: SystemMonitoringService,
    private readonly withdrawJobQueue: WithdrawJobQueue,
    private readonly withdrawPolicyService?: WithdrawPolicyService,
    private readonly withdrawGuardService?: WithdrawGuardService
  ) {
    this.runtimeDbPool = env.ledgerProvider === 'postgres' ? createPostgresPool() : undefined;
  }

  async listAuditLogs(input?: {
    entityType?: 'withdrawal' | 'sweep' | 'system';
    entityId?: string;
    actorId?: string;
    action?: string;
    createdFrom?: string;
    createdTo?: string;
    limit?: number;
  }) {
    return this.ledger.listAuditLogs(input);
  }

  async getOutboxStatus(limit = 50) {
    const [summary, events] = await Promise.all([this.ledger.getOutboxEventSummary(), this.ledger.listOutboxEvents({ limit })]);

    return {
      workflow: {
        ledgerLockedCount: events.filter((event) => resolveOfflineWorkflowStage(event) === 'LEDGER_LOCKED').length,
        collateralReleasedCount: events.filter((event) => resolveOfflineWorkflowStage(event) === 'COLLATERAL_RELEASED').length,
        ledgerSyncedCount: events.filter((event) => resolveOfflineWorkflowStage(event) === 'LEDGER_SYNCED').length,
        deadLetteredCount: events.filter((event) => resolveOfflineWorkflowStage(event) === 'DEAD_LETTERED').length
      },
      summary: {
        ...summary,
        oldestPendingCreatedAt: summary.oldestPendingCreatedAt ?? null,
        oldestDeadLetteredAt: summary.oldestDeadLetteredAt ?? null
      },
      items: events.map((event) => ({
        outboxEventId: event.outboxEventId,
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        status: event.status,
        attempts: event.attempts,
        availableAt: event.availableAt,
        createdAt: event.createdAt,
        processingStartedAt: event.processingStartedAt ?? null,
        publishedAt: event.publishedAt ?? null,
        deadLetteredAt: event.deadLetteredAt ?? null,
        deadLetterAcknowledgedAt: event.deadLetterAcknowledgedAt ?? null,
        deadLetterAcknowledgedBy: event.deadLetterAcknowledgedBy ?? null,
        deadLetterNote: event.deadLetterNote ?? null,
        deadLetterCategory: event.deadLetterCategory ?? null,
        incidentRef: event.incidentRef ?? null,
        lastError: event.lastError ?? null,
        workflowStage: resolveOfflineWorkflowStage(event),
        sagaStatus: isOfflinePayOutboxEvent(event.eventType) ? resolveOfflineSagaStatus(event) : null,
        failureClass: isOfflinePayOutboxEvent(event.eventType)
          ? resolveOfflineFailureClass({
              deadLetterCategory: event.deadLetterCategory,
              lastError: event.lastError ?? null
            })
          : null
      }))
    };
  }

  async replayDeadLetterOutboxEvents(input: { outboxEventIds?: string[]; limit?: number; actorId: string }) {
    const replayedCount = await this.ledger.replayOutboxEvents({
      outboxEventIds: input.outboxEventIds,
      status: 'dead_lettered',
      limit: input.limit
    });

    await this.ledger.appendAuditLog({
      entityType: 'system',
      entityId: 'outbox',
      action: 'outbox.dead_letter.replayed',
      actorType: 'admin',
      actorId: input.actorId,
      metadata: {
        replayedCount: replayedCount.toString(),
        outboxEventIds: (input.outboxEventIds ?? []).join(',')
      }
    });

    return { replayedCount };
  }

  async recoverStaleOutboxProcessing(input: { timeoutSec?: number; actorId: string }) {
    const timeoutSec = input.timeoutSec ?? env.outboxProcessingStaleTimeoutSec;
    const recoveredCount = await this.ledger.recoverStaleProcessingOutboxEvents(timeoutSec);

    await this.ledger.appendAuditLog({
      entityType: 'system',
      entityId: 'outbox',
      action: 'outbox.processing.recovered',
      actorType: 'admin',
      actorId: input.actorId,
      metadata: {
        timeoutSec: timeoutSec.toString(),
        recoveredCount: recoveredCount.toString()
      }
    });

    return { recoveredCount, timeoutSec };
  }

  async acknowledgeDeadLetterOutboxEvents(input: {
    outboxEventIds?: string[];
    limit?: number;
    actorId: string;
    note?: string;
    category?: 'external_dependency' | 'validation' | 'state_conflict' | 'network' | 'unknown';
    incidentRef?: string;
  }) {
    const acknowledgedCount = await this.ledger.acknowledgeDeadLetterOutboxEvents(input);

    await this.ledger.appendAuditLog({
      entityType: 'system',
      entityId: 'outbox',
      action: 'outbox.dead_letter.acknowledged',
      actorType: 'admin',
      actorId: input.actorId,
      metadata: {
        acknowledgedCount: acknowledgedCount.toString(),
        outboxEventIds: (input.outboxEventIds ?? []).join(','),
        note: input.note ?? '',
        category: input.category ?? '',
        incidentRef: input.incidentRef ?? ''
      }
    });

    return { acknowledgedCount };
  }

  async getEventConsumerStatus(input: {
    consumerName?: string;
    eventType?: string;
    attemptStatus?: 'succeeded' | 'failed';
    limit?: number;
  } = {}) {
    const [attempts, deadLetters] = await Promise.all([
      this.ledger.listEventConsumerAttempts({
        consumerName: input.consumerName,
        eventType: input.eventType,
        status: input.attemptStatus,
        limit: input.limit
      }),
      this.ledger.listEventConsumerDeadLetters({
        consumerName: input.consumerName,
        eventType: input.eventType,
        limit: input.limit
      })
    ]);

    return {
      summary: {
        attemptCount: attempts.length,
        failureCount: attempts.filter((item) => item.status === 'failed').length,
        deadLetterCount: deadLetters.length
      },
      attempts,
      deadLetters
    };
  }

  async getDatabaseBackupStatus() {
    if (!this.runtimeDbPool) {
      return {
        systemId: env.ledgerIdentity.systemId,
        databaseName: env.db.name,
        currentNode: {
          transactionReadOnly: false,
          walLevel: 'unknown',
          archiveMode: 'unknown',
          archiveCommandConfigured: false,
          archiveTimeoutSec: null,
          synchronousStandbyNames: '',
          attachedReplicaCount: 0,
          healthySyncReplicaCount: 0
        },
        replicas: [],
        notes: ['postgres ledger provider is not enabled in this runtime']
      };
    }

    const primaryStatusResult = await this.runtimeDbPool.query<{
      database_name: string;
      transaction_read_only: boolean;
      wal_level: string;
      archive_mode: string;
      archive_command: string;
      archive_timeout: string;
      synchronous_standby_names: string;
      attached_replica_count: string;
      healthy_sync_replica_count: string;
    }>(`
      SELECT
        current_database() AS database_name,
        (current_setting('transaction_read_only') = 'on') AS transaction_read_only,
        COALESCE(current_setting('wal_level', true), 'unknown') AS wal_level,
        COALESCE(current_setting('archive_mode', true), 'unknown') AS archive_mode,
        COALESCE(current_setting('archive_command', true), '') AS archive_command,
        COALESCE(current_setting('archive_timeout', true), '') AS archive_timeout,
        COALESCE(current_setting('synchronous_standby_names', true), '') AS synchronous_standby_names,
        COALESCE((SELECT COUNT(*)::text FROM pg_stat_replication WHERE state = 'streaming'), '0') AS attached_replica_count,
        COALESCE((SELECT COUNT(*)::text FROM pg_stat_replication WHERE state = 'streaming' AND sync_state IN ('sync', 'quorum')), '0') AS healthy_sync_replica_count
    `);
    const replicaResult = await this.runtimeDbPool.query<{
      application_name: string | null;
      client_address: string | null;
      state: string | null;
      sync_state: string | null;
      replay_lag_bytes: string | null;
    }>(`
      SELECT
        application_name,
        client_addr::text AS client_address,
        state,
        sync_state,
        COALESCE(pg_wal_lsn_diff(sent_lsn, replay_lsn)::text, '0') AS replay_lag_bytes
      FROM pg_stat_replication
      ORDER BY application_name ASC
    `);

    const primary = primaryStatusResult.rows[0];
    const archiveTimeoutRaw = primary?.archive_timeout?.trim() ?? '';
    const archiveTimeoutSec = archiveTimeoutRaw.endsWith('s')
      ? Number.parseInt(archiveTimeoutRaw.replace(/s$/, ''), 10)
      : Number.isFinite(Number(archiveTimeoutRaw))
        ? Number.parseInt(archiveTimeoutRaw, 10)
        : null;

    const notes: string[] = [];
    if (primary.transaction_read_only) {
      notes.push('current node is read-only; confirm db-proxy is not routing writes to a standby');
    }
    if ((primary.synchronous_standby_names ?? '').trim().length === 0) {
      notes.push('synchronous standby is not configured on the current node');
    }
    if ((primary.archive_mode ?? '').toLowerCase() === 'off') {
      notes.push('archive_mode is off on the current node; WAL archive may be managed on a standby node');
    }

    return {
      systemId: env.ledgerIdentity.systemId,
      databaseName: primary.database_name,
      currentNode: {
        transactionReadOnly: primary.transaction_read_only,
        walLevel: primary.wal_level,
        archiveMode: primary.archive_mode,
        archiveCommandConfigured: Boolean(primary.archive_command && primary.archive_command !== '(disabled)'),
        archiveTimeoutSec: Number.isFinite(archiveTimeoutSec) ? archiveTimeoutSec : null,
        synchronousStandbyNames: primary.synchronous_standby_names,
        attachedReplicaCount: Number(primary.attached_replica_count ?? '0'),
        healthySyncReplicaCount: Number(primary.healthy_sync_replica_count ?? '0')
      },
      replicas: replicaResult.rows.map((row) => ({
        applicationName: row.application_name ?? '',
        clientAddress: row.client_address ?? null,
        state: row.state ?? 'unknown',
        syncState: row.sync_state ?? 'unknown',
        replayLagBytes: row.replay_lag_bytes ?? '0'
      })),
      notes
    };
  }

  async listWithdrawalExternalSyncFailures(limit = 50) {
    const [logs, failedJobs] = await Promise.all([
      this.ledger.listAuditLogs({
        entityType: 'withdrawal',
        limit: Math.max(limit * 4, 100)
      }),
      this.withdrawJobQueue.listFailed(limit)
    ]);

    const syncFailedJobs = failedJobs.filter((job) => job.name === 'external_sync');
    const failedJobByWithdrawalId = new Map(
      syncFailedJobs
        .filter((job) => job.withdrawalId)
        .map((job) => [job.withdrawalId as string, job] as const)
    );

    const items: ExternalSyncFailureItem[] = [];
    const seenWithdrawalIds = new Set<string>();

    for (const log of logs) {
      if (log.action !== 'withdraw.external_sync.failed' || seenWithdrawalIds.has(log.entityId)) {
        continue;
      }

      seenWithdrawalIds.add(log.entityId);
      const failedJob = failedJobByWithdrawalId.get(log.entityId);
      items.push({
        withdrawalId: log.entityId,
        createdAt: log.createdAt,
        status: log.metadata.status ?? '',
        error: log.metadata.error ?? '',
        occurredAt: log.metadata.occurredAt ?? '',
        txHash: log.metadata.txHash ?? '',
        failedJob: failedJob
          ? {
              attemptsMade: failedJob.attemptsMade,
              failedReason: failedJob.failedReason ?? ''
            }
          : null
      });

      if (items.length >= limit) {
        break;
      }
    }

    for (const failedJob of syncFailedJobs) {
      if (!failedJob.withdrawalId || seenWithdrawalIds.has(failedJob.withdrawalId)) {
        continue;
      }

      seenWithdrawalIds.add(failedJob.withdrawalId);
      items.push({
        withdrawalId: failedJob.withdrawalId,
        createdAt: '',
        status: '',
        error: failedJob.failedReason ?? '',
        occurredAt: '',
        txHash: '',
        failedJob: {
          attemptsMade: failedJob.attemptsMade,
          failedReason: failedJob.failedReason ?? ''
        }
      });

      if (items.length >= limit) {
        break;
      }
    }

    return {
      items,
      failedJobCount: syncFailedJobs.length
    };
  }

  async getWithdrawalExternalSyncStatus(limit = 200) {
    const [logs, failedJobs] = await Promise.all([
      this.ledger.listAuditLogs({
        entityType: 'withdrawal',
        limit
      }),
      this.withdrawJobQueue.listFailed(limit)
    ]);
    const syncLogs = logs.filter((log) => log.action.startsWith('withdraw.external_sync.'));
    const syncFailedJobs = failedJobs.filter((job) => job.name === 'external_sync');
    const failures = syncLogs.filter((log) => log.action === 'withdraw.external_sync.failed');
    const successes = syncLogs.filter((log) => log.action === 'withdraw.external_sync.succeeded');
    const lastFailure = failures[0];
    const recentFailures = (await this.listWithdrawalExternalSyncFailures(Math.min(limit, 10))).items;

    return {
      enabled: Boolean(env.foxyaInternalWithdrawalApiUrl && env.foxyaInternalWithdrawalApiKey),
      totalEvents: syncLogs.length,
      successCount: successes.length,
      failureCount: failures.length,
      failedJobCount: syncFailedJobs.length,
      recentFailures,
      lastFailure: lastFailure
        ? {
            withdrawalId: lastFailure.entityId,
            createdAt: lastFailure.createdAt,
            status: lastFailure.metadata.status ?? '',
            error: lastFailure.metadata.error ?? ''
          }
        : null,
      lastFailedJob: syncFailedJobs[0]
        ? {
            withdrawalId: syncFailedJobs[0].withdrawalId ?? '',
            attemptsMade: syncFailedJobs[0].attemptsMade,
            failedReason: syncFailedJobs[0].failedReason ?? ''
          }
        : null
    };
  }

  async listWithdrawalAddressPolicies(input?: {
    address?: string;
    policyType?: WithdrawAddressPolicyType;
    limit?: number;
  }) {
    if (!this.withdrawPolicyService) {
      throw new Error('withdraw policy service is not configured');
    }

    return this.withdrawPolicyService.listAddressPolicies(input);
  }

  async upsertWithdrawalAddressPolicy(input: {
    address: string;
    policyType: WithdrawAddressPolicyType;
    reason?: string;
    actorId: string;
  }) {
    if (!this.withdrawPolicyService) {
      throw new Error('withdraw policy service is not configured');
    }

    const policy = await this.withdrawPolicyService.upsertAddressPolicy({
      address: input.address,
      policyType: input.policyType,
      reason: input.reason,
      createdBy: input.actorId
    });

    await this.ledger.appendAuditLog({
      entityType: 'system',
      entityId: `withdraw-policy:${policy.address}:${policy.policyType}`,
      action: 'withdraw.policy.upserted',
      actorType: 'admin',
      actorId: input.actorId,
      metadata: {
        address: policy.address,
        policyType: policy.policyType,
        reason: policy.reason ?? ''
      }
    });

    return policy;
  }

  async deleteWithdrawalAddressPolicy(address: string, policyType: WithdrawAddressPolicyType, actorId: string) {
    if (!this.withdrawPolicyService) {
      throw new Error('withdraw policy service is not configured');
    }

    const deleted = await this.withdrawPolicyService.deleteAddressPolicy(address, policyType);
    await this.ledger.appendAuditLog({
      entityType: 'system',
      entityId: `withdraw-policy:${address}:${policyType}`,
      action: deleted ? 'withdraw.policy.deleted' : 'withdraw.policy.delete_missed',
      actorType: 'admin',
      actorId,
      metadata: {
        address,
        policyType
      }
    });

    return deleted;
  }

  async listWithdrawalRiskEvents(limit = 50): Promise<{ items: WithdrawalRiskEvent[] }> {
    const logs = await this.ledger.listAuditLogs({
      entityType: 'system',
      limit: Math.max(limit * 4, 100)
    });

    const items = logs
      .filter((log) => log.action === 'withdraw.risk_event.recorded')
      .slice(0, limit)
      .map((log) => ({
        eventId: log.entityId,
        address: log.metadata.address ?? '',
        signal: log.metadata.signal ?? '',
        severity: (log.metadata.severity as WithdrawalRiskEventSeverity | undefined) ?? 'medium',
        reason: log.metadata.reason ?? '',
        createdAt: log.createdAt,
        actorId: log.actorId,
        blacklistPolicyType: (log.metadata.blacklistPolicyType as WithdrawAddressPolicyType | undefined) ?? null
      }));

    return { items };
  }

  async recordWithdrawalRiskEvent(input: {
    address: string;
    signal: string;
    severity: WithdrawalRiskEventSeverity;
    reason: string;
    actorId: string;
    blacklistPolicyType?: WithdrawAddressPolicyType;
  }) {
    if (input.blacklistPolicyType) {
      await this.upsertWithdrawalAddressPolicy({
        address: input.address,
        policyType: input.blacklistPolicyType,
        reason: input.reason,
        actorId: input.actorId
      });
    }

    const eventId = `risk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const log = await this.ledger.appendAuditLog({
      entityType: 'system',
      entityId: eventId,
      action: 'withdraw.risk_event.recorded',
      actorType: 'admin',
      actorId: input.actorId,
      metadata: {
        address: input.address,
        signal: input.signal,
        severity: input.severity,
        reason: input.reason,
        blacklistPolicyType: input.blacklistPolicyType ?? ''
      }
    });

    return {
      eventId,
      address: input.address,
      signal: input.signal,
      severity: input.severity,
      reason: input.reason,
      createdAt: log.createdAt,
      actorId: input.actorId,
      blacklistPolicyType: input.blacklistPolicyType ?? null
    } satisfies WithdrawalRiskEvent;
  }

  async listNetworkFeeReceipts(input?: {
    referenceType?: NetworkFeeReceipt['referenceType'];
    referenceId?: string;
    limit?: number;
  }) {
    const items = await this.ledger.listNetworkFeeReceipts(input);
    const totalFeeSun = items.reduce((acc, item) => acc + item.feeSun, 0n);
    const byReferenceType = items.reduce(
      (acc, item) => {
        acc[item.referenceType] = (acc[item.referenceType] ?? 0n) + item.feeSun;
        return acc;
      },
      {} as Record<NetworkFeeReceipt['referenceType'], bigint>
    );

    return {
      items: items.map((item) => ({
        ...item,
        feeSun: item.feeSun.toString(),
        feeAmount: formatTrxSunAmount(item.feeSun)
      })),
      summary: {
        currencyCode: 'TRX',
        totalFeeSun: totalFeeSun.toString(),
        totalFeeAmount: formatTrxSunAmount(totalFeeSun),
        byReferenceType: {
          withdrawal: formatTrxSunAmount(byReferenceType.withdrawal ?? 0n),
          sweep: formatTrxSunAmount(byReferenceType.sweep ?? 0n)
        }
      }
    };
  }

  async listNetworkFeeDailySnapshots(input?: { days?: number }) {
    const items = await this.ledger.listNetworkFeeDailySnapshots(input);
    const totalLedgerFeeSun = items.reduce((acc, item) => acc + item.ledgerFeeSun, 0n);
    const totalActualFeeSun = items.reduce((acc, item) => acc + item.actualFeeSun, 0n);
    const totalGapFeeSun = totalActualFeeSun - totalLedgerFeeSun;

    return {
      items: items.map((item) => ({
        snapshotDate: item.snapshotDate,
        currencyCode: item.currencyCode,
        ledgerFeeSun: item.ledgerFeeSun.toString(),
        ledgerFeeAmount: formatTrxSunAmount(item.ledgerFeeSun),
        actualFeeSun: item.actualFeeSun.toString(),
        actualFeeAmount: formatTrxSunAmount(item.actualFeeSun),
        gapFeeSun: item.gapFeeSun.toString(),
        gapFeeAmount: formatTrxSunAmount(item.gapFeeSun),
        ledgerFeeCount: item.ledgerFeeCount,
        actualFeeCount: item.actualFeeCount,
        status: item.gapFeeSun === 0n ? 'balanced' : item.gapFeeSun > 0n ? 'underbooked' : 'overbooked',
        byReferenceType: {
          withdrawal: {
            ledgerFeeSun: item.byReferenceType.withdrawal.ledgerFeeSun.toString(),
            ledgerFeeAmount: formatTrxSunAmount(item.byReferenceType.withdrawal.ledgerFeeSun),
            actualFeeSun: item.byReferenceType.withdrawal.actualFeeSun.toString(),
            actualFeeAmount: formatTrxSunAmount(item.byReferenceType.withdrawal.actualFeeSun),
            ledgerFeeCount: item.byReferenceType.withdrawal.ledgerFeeCount,
            actualFeeCount: item.byReferenceType.withdrawal.actualFeeCount
          },
          sweep: {
            ledgerFeeSun: item.byReferenceType.sweep.ledgerFeeSun.toString(),
            ledgerFeeAmount: formatTrxSunAmount(item.byReferenceType.sweep.ledgerFeeSun),
            actualFeeSun: item.byReferenceType.sweep.actualFeeSun.toString(),
            actualFeeAmount: formatTrxSunAmount(item.byReferenceType.sweep.actualFeeSun),
            ledgerFeeCount: item.byReferenceType.sweep.ledgerFeeCount,
            actualFeeCount: item.byReferenceType.sweep.actualFeeCount
          }
        }
      })),
      summary: {
        currencyCode: 'TRX',
        totalLedgerFeeSun: totalLedgerFeeSun.toString(),
        totalLedgerFeeAmount: formatTrxSunAmount(totalLedgerFeeSun),
        totalActualFeeSun: totalActualFeeSun.toString(),
        totalActualFeeAmount: formatTrxSunAmount(totalActualFeeSun),
        totalGapFeeSun: totalGapFeeSun.toString(),
        totalGapFeeAmount: formatTrxSunAmount(totalGapFeeSun)
      }
    };
  }

  async listOfflinePayOperations(input: {
    limit?: number;
    operationType?: OfflinePayOperationType;
    status?: OfflinePayOperationStatus;
    assetCode?: string;
  } = {}): Promise<OfflinePayOperationItem[]> {
    const limit = input.limit ?? 50;
    const [logs, outbox] = await Promise.all([
      this.ledger.listAuditLogs({
        entityType: 'system',
        limit: Math.max(limit * 6, 120)
      }),
      this.ledger.listOutboxEvents({ limit: Math.max(limit * 6, 120) })
    ]);

    const mapAuditAction = (action: string): OfflinePayOperationType | null => {
      switch (action) {
        case 'offline_pay.collateral.locked':
          return 'COLLATERAL_TOPUP';
        case 'offline_pay.collateral.released':
          return 'COLLATERAL_RELEASE';
        case 'offline_pay.settlement.finalized':
          return 'SETTLEMENT';
        default:
          return null;
      }
    };

    const mapOutboxEventType = (eventType: string): OfflinePayOperationType | null => {
      switch (eventType) {
        case 'offline_pay.collateral.locked':
          return 'COLLATERAL_TOPUP';
        case 'offline_pay.collateral.released':
          return 'COLLATERAL_RELEASE';
        case 'offline_pay.settlement.finalized':
          return 'SETTLEMENT';
        default:
          return null;
      }
    };

    const auditItems: OfflinePayOperationItem[] = logs.flatMap((log) => {
      const operationType = mapAuditAction(log.action);
      if (!operationType) {
        return [];
      }
      return [{
        id: `${log.action}:${log.entityId}:${log.createdAt}`,
        operationType,
        status: 'completed' as const,
        workflowStage: operationType === 'SETTLEMENT'
          ? 'LEDGER_SYNCED'
          : log.action === 'offline_pay.collateral.released'
            ? 'COLLATERAL_RELEASED'
            : 'LEDGER_LOCKED',
        sagaStatus: 'COMPLETED',
        failureClass: null,
        assetCode: log.metadata.assetCode ?? '',
        amount: log.metadata.amount ?? '',
        userId: log.metadata.userId ?? '',
        deviceId: log.metadata.deviceId ?? '',
        referenceId: log.metadata.referenceId ?? log.entityId,
        source: 'audit' as const,
        createdAt: log.createdAt,
        lastError: null
      }];
    });

    const outboxItems: OfflinePayOperationItem[] = outbox.flatMap((event) => {
      const operationType = mapOutboxEventType(event.eventType);
      if (!operationType || event.status === 'published') {
        return [];
      }
      const status: OfflinePayOperationStatus = event.status === 'dead_lettered' ? 'failed' : 'pending';
      const payload = event.payload ?? {};
      return [{
        id: event.outboxEventId,
        operationType,
        status,
        workflowStage: resolveOfflineWorkflowStage(event) ?? 'SERVER_ACCEPTED',
        sagaStatus: resolveOfflineSagaStatus(event),
        failureClass: resolveOfflineFailureClass({
          deadLetterCategory: event.deadLetterCategory,
          lastError: event.lastError ?? null
        }),
        assetCode: typeof payload.assetCode === 'string' ? payload.assetCode : '',
        amount: typeof payload.amount === 'string' ? payload.amount : '',
        userId: typeof payload.userId === 'string' ? payload.userId : '',
        deviceId: typeof payload.deviceId === 'string' ? payload.deviceId : '',
        referenceId: event.aggregateId,
        source: 'outbox' as const,
        createdAt: event.createdAt,
        lastError: event.lastError ?? null
      }];
    });

    return [...outboxItems, ...auditItems]
      .filter((item) => !input.operationType || item.operationType === input.operationType)
      .filter((item) => !input.status || item.status === input.status)
      .filter((item) => !input.assetCode || item.assetCode.toUpperCase() === input.assetCode.toUpperCase())
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  async getOfflinePayOperationOverview(input: {
    limit?: number;
    assetCode?: string;
  } = {}): Promise<OfflinePayOperationOverview> {
    const items = await this.listOfflinePayOperations({
      limit: input.limit ?? 100,
      assetCode: input.assetCode
    });

    return {
      summary: {
        completedCount: items.filter((item) => item.status === 'completed').length,
        pendingCount: items.filter((item) => item.status === 'pending').length,
        failedCount: items.filter((item) => item.status === 'failed').length,
        settlementCount: items.filter((item) => item.operationType === 'SETTLEMENT').length,
        collateralTopupCount: items.filter((item) => item.operationType === 'COLLATERAL_TOPUP').length,
        collateralReleaseCount: items.filter((item) => item.operationType === 'COLLATERAL_RELEASE').length
      },
      items
    };
  }

  async getWithdrawalOverview() {
    const [pendingApprovals, adminApproved, txBroadcasted, failedJobs] = await Promise.all([
      this.ledger.listPendingApprovalWithdrawals(),
      this.ledger.listWithdrawalsByStatuses(['ADMIN_APPROVED']),
      this.ledger.listWithdrawalsByStatuses(['TX_BROADCASTED']),
      this.withdrawJobQueue.listFailed(200)
    ]);

    const offlineSigningPending = this.withdrawGuardService
      ? adminApproved.filter((withdrawal) => this.withdrawGuardService!.requiresOfflineSigning(withdrawal.amount))
      : [];
    const hotBroadcastPending = this.withdrawGuardService
      ? adminApproved.filter((withdrawal) => !this.withdrawGuardService!.requiresOfflineSigning(withdrawal.amount))
      : adminApproved;

    return {
      pendingApprovalCount: pendingApprovals.length,
      broadcastPendingCount: hotBroadcastPending.length,
      offlineSigningPendingCount: offlineSigningPending.length,
      onchainPendingCount: txBroadcasted.length,
      failedJobCount: failedJobs.length
    };
  }

  async getReconciliationReport() {
    const wallets = getConfiguredSystemWallets();
    const [snapshots, ledgerSummary] = await Promise.all([
      this.systemMonitoringService.getStoredWallets(wallets),
      this.ledger.getLedgerSummary()
    ]);

    const onchainTrackedBalance = snapshots
      .filter((snapshot) => snapshot.status === 'ok' && snapshot.tokenBalance)
      .reduce((acc, snapshot) => acc + parseStoredKoriAmount(snapshot.tokenBalance ?? '0'), 0n);

    const hotSnapshot = snapshots.find((snapshot) => snapshot.walletCode === 'hot');
    const hotKori = hotSnapshot?.tokenBalance ? parseStoredKoriAmount(hotSnapshot.tokenBalance) : 0n;
    const hotTrx = hotSnapshot?.trxBalance ? Number(hotSnapshot.trxBalance) : 0;

    const alerts: string[] = [];
    if (hotKori < parseKoriAmount(env.hotWalletAlertMinKori)) {
      alerts.push('HOT_WALLET_KORI_LOW');
    }
    if (hotTrx < env.hotWalletAlertMinTrx) {
      alerts.push('HOT_WALLET_TRX_LOW');
    }

    const gap = onchainTrackedBalance - ledgerSummary.liabilityBalance;

    return {
      ledger: {
        accountCount: ledgerSummary.accountCount,
        availableBalance: formatKoriAmount(ledgerSummary.availableBalance),
        lockedBalance: formatKoriAmount(ledgerSummary.lockedBalance),
        liabilityBalance: formatKoriAmount(ledgerSummary.liabilityBalance),
        confirmedDepositCount: ledgerSummary.confirmedDepositCount,
        activeWithdrawalCount: ledgerSummary.activeWithdrawalCount
      },
      onchain: {
        trackedWalletCount: snapshots.length,
        trackedBalance: formatKoriAmount(onchainTrackedBalance),
        hotWalletBalance: formatKoriAmount(hotKori),
        hotWalletTrx: hotSnapshot?.trxBalance ?? '0'
      },
      gap: {
        amount: formatKoriAmount(gap),
        status: gap >= 0n ? 'covered' : 'deficit'
      },
      alerts
    };
  }

  async planSweeps() {
    const wallets = getConfiguredSystemWallets().filter((wallet) => !['treasury', 'hot'].includes(wallet.code));
    const [snapshots, existingSweeps] = await Promise.all([
      this.systemMonitoringService.getStoredWallets(wallets),
      this.ledger.listSweepRecords(200)
    ]);

    const activeSources = new Set(
      existingSweeps
        .filter((sweep) => ['planned', 'queued', 'broadcasted'].includes(sweep.status))
        .map((sweep) => sweep.sourceWalletCode)
    );
    const minAmount = parseKoriAmount(env.sweepPlanMinKori);
    const sweeps = [];

    for (const snapshot of snapshots) {
      if (snapshot.status !== 'ok' || !snapshot.tokenBalance) {
        continue;
      }

      const amount = parseStoredKoriAmount(snapshot.tokenBalance);
      if (amount < minAmount || activeSources.has(snapshot.walletCode)) {
        continue;
      }

      const sweep = await this.ledger.createSweepRecord({
        sourceWalletCode: snapshot.walletCode,
        sourceAddress: snapshot.address,
        targetAddress: env.hotWalletAddress,
        amount,
        note: 'planned from latest monitoring snapshot'
      });

      await this.ledger.appendAuditLog({
        entityType: 'sweep',
        entityId: sweep.sweepId,
        action: 'sweep.planned',
        actorType: 'system',
        actorId: 'sweep-planner',
        metadata: {
          sourceWalletCode: sweep.sourceWalletCode,
          amount: formatKoriAmount(sweep.amount)
        }
      });

      sweeps.push(sweep);
    }

    return {
      plannedCount: sweeps.length,
      sweeps
    };
  }

  async listSweeps(limit?: number) {
    return this.ledger.listSweepRecords(limit);
  }

  async rebuildLedgerProjections() {
    const result = await this.ledger.rebuildAccountProjections();
    await this.ledger.appendAuditLog({
      entityType: 'system',
      entityId: 'ledger-projection',
      action: 'ledger.projection.rebuilt',
      actorType: 'system',
      actorId: 'operations-service',
      metadata: {
        accountCount: result.accountCount.toString()
      }
    });
    return result;
  }

  async reconcileOfflinePayUserBalance(input: {
    userId: string;
    targetLiabilityBalance: string;
    canonicalBasis: string;
    actorId: string;
    note?: string;
  }) {
    const result = await this.ledger.reconcileOfflinePayUserBalance({
      userId: input.userId,
      targetLiabilityBalance: parseStoredKoriAmount(input.targetLiabilityBalance),
      canonicalBasis: input.canonicalBasis,
      actorId: input.actorId,
      note: input.note
    });

    await this.ledger.appendAuditLog({
      entityType: 'system',
      entityId: `offline-pay-reconciliation:${input.userId}`,
      action: 'offline_pay.user_balance.reconciled',
      actorType: 'admin',
      actorId: input.actorId,
      metadata: {
        userId: input.userId,
        canonicalBasis: input.canonicalBasis,
        previousLiabilityBalance: formatKoriAmount(result.previousLiabilityBalance),
        targetLiabilityBalance: formatKoriAmount(result.targetLiabilityBalance),
        deltaAmount: formatKoriAmount(result.deltaAmount),
        adjusted: String(result.adjusted),
        note: input.note ?? ''
      }
    });

    return {
      userId: result.userId,
      previousLiabilityBalance: formatKoriAmount(result.previousLiabilityBalance),
      targetLiabilityBalance: formatKoriAmount(result.targetLiabilityBalance),
      deltaAmount: formatKoriAmount(result.deltaAmount),
      adjusted: result.adjusted
    };
  }

  async listFailedWithdrawJobs(limit = 50) {
    return this.withdrawJobQueue.listFailed(limit);
  }

  async retryExternalSyncWithdrawals(withdrawalIds: string[], actorId = 'manual-operator') {
    const uniqueWithdrawalIds = Array.from(new Set(withdrawalIds.map((item) => item.trim()).filter(Boolean)));

    for (const withdrawalId of uniqueWithdrawalIds) {
      await this.withdrawJobQueue.enqueueExternalSync(withdrawalId);
      await this.ledger.appendAuditLog({
        entityType: 'withdrawal',
        entityId: withdrawalId,
        action: 'withdraw.external_sync.retry_requested',
        actorType: 'admin',
        actorId,
        metadata: {}
      });
    }

    return {
      queuedCount: uniqueWithdrawalIds.length,
      withdrawalIds: uniqueWithdrawalIds
    };
  }

  async seedWithdrawalQueueRecovery() {
    const [approved, broadcasted] = await Promise.all([
      this.ledger.listWithdrawalsByStatuses(['ADMIN_APPROVED']),
      this.ledger.listWithdrawalsByStatuses(['TX_BROADCASTED'])
    ]);

    for (const withdrawal of approved) {
      await this.withdrawJobQueue.enqueueDispatch(withdrawal.withdrawalId);
    }
    for (const withdrawal of broadcasted) {
      await this.withdrawJobQueue.enqueueReconcile(withdrawal.withdrawalId);
    }

    await this.ledger.appendAuditLog({
      entityType: 'system',
      entityId: 'withdraw-queue-recovery',
      action: 'withdraw.queue.recovered',
      actorType: 'system',
      actorId: 'operations-service',
      metadata: {
        approvedCount: approved.length.toString(),
        broadcastedCount: broadcasted.length.toString()
      }
    });

    return {
      approvedCount: approved.length,
      broadcastedCount: broadcasted.length
    };
  }

  async markSweepBroadcasted(sweepId: string, txHash: string, note?: string) {
    const sweep = await this.ledger.markSweepBroadcasted(sweepId, txHash, note);
    await this.ledger.appendAuditLog({
      entityType: 'sweep',
      entityId: sweepId,
      action: 'sweep.broadcasted',
      actorType: 'admin',
      actorId: 'manual-operator',
      metadata: {
        txHash,
        note: note ?? ''
      }
    });
    return sweep;
  }

  async confirmSweep(sweepId: string, note?: string) {
    const sweep = await this.ledger.confirmSweep(sweepId, note);
    await this.ledger.appendAuditLog({
      entityType: 'sweep',
      entityId: sweepId,
      action: 'sweep.confirmed',
      actorType: 'admin',
      actorId: 'manual-operator',
      metadata: {
        note: note ?? ''
      }
    });
    return sweep;
  }
}
