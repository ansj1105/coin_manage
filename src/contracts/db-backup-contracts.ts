import { z } from 'zod';

export const dbReplicaStatusSchema = z
  .object({
    applicationName: z.string(),
    clientAddress: z.string().nullable(),
    state: z.string(),
    syncState: z.string(),
    replayLagBytes: z.string()
  })
  .strict();

export const dbBackupNodeStatusSchema = z
  .object({
    transactionReadOnly: z.boolean(),
    walLevel: z.string(),
    archiveMode: z.string(),
    archiveCommandConfigured: z.boolean(),
    archiveTimeoutSec: z.number().int().nonnegative().nullable(),
    synchronousStandbyNames: z.string(),
    attachedReplicaCount: z.number().int().nonnegative(),
    healthySyncReplicaCount: z.number().int().nonnegative()
  })
  .strict();

export const dbBackupStatusResponseSchema = z
  .object({
    systemId: z.string(),
    databaseName: z.string(),
    currentNode: dbBackupNodeStatusSchema,
    replicas: z.array(dbReplicaStatusSchema),
    notes: z.array(z.string())
  })
  .strict();

export const dbBackupStatusResponseContract = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  additionalProperties: false,
  required: ['systemId', 'databaseName', 'currentNode', 'replicas', 'notes'],
  properties: {
    systemId: { type: 'string' },
    databaseName: { type: 'string' },
    currentNode: {
      type: 'object',
      additionalProperties: false,
      required: [
        'transactionReadOnly',
        'walLevel',
        'archiveMode',
        'archiveCommandConfigured',
        'archiveTimeoutSec',
        'synchronousStandbyNames',
        'attachedReplicaCount',
        'healthySyncReplicaCount'
      ],
      properties: {
        transactionReadOnly: { type: 'boolean' },
        walLevel: { type: 'string' },
        archiveMode: { type: 'string' },
        archiveCommandConfigured: { type: 'boolean' },
        archiveTimeoutSec: { type: ['integer', 'null'], minimum: 0 },
        synchronousStandbyNames: { type: 'string' },
        attachedReplicaCount: { type: 'integer', minimum: 0 },
        healthySyncReplicaCount: { type: 'integer', minimum: 0 }
      }
    },
    replicas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['applicationName', 'clientAddress', 'state', 'syncState', 'replayLagBytes'],
        properties: {
          applicationName: { type: 'string' },
          clientAddress: { type: ['string', 'null'] },
          state: { type: 'string' },
          syncState: { type: 'string' },
          replayLagBytes: { type: 'string' }
        }
      }
    },
    notes: {
      type: 'array',
      items: { type: 'string' }
    }
  }
} as const;

export type DbBackupStatusResponseContract = z.infer<typeof dbBackupStatusResponseSchema>;
