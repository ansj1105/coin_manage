import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { z } from 'zod';
import { formatKoriAmount } from '../domain/value-objects/money.js';
import type { Withdrawal } from '../domain/ledger/types.js';

export const LEDGER_SCHEMA_VERSION = '1.0.0' as const;

export const withdrawalLedgerStatusSchema = z.enum([
  'REQUESTED',
  'LEDGER_RESERVED',
  'PENDING_ADMIN',
  'ADMIN_APPROVED',
  'TX_BROADCASTED',
  'ONCHAIN_CONFIRMED',
  'COMPLETED',
  'FAILED',
  'REJECTED'
]);

export const depositStateChangedContractSchema = z
  .object({
    schemaVersion: z.literal(LEDGER_SCHEMA_VERSION),
    eventType: z.literal('deposit.state.changed'),
    issuer: z.string().min(1).max(64),
    signature: z.string().regex(/^[a-f0-9]{64}$/),
    depositId: z.string().min(1).max(64),
    userId: z.string().min(1).max(64),
    walletAddress: z.string().min(1).max(128),
    txHash: z.string().min(8).max(128),
    toAddress: z.string().min(1).max(128),
    status: z.enum(['DETECTED', 'CONFIRMED', 'CREDITED', 'COMPLETED']),
    amount: z.string().regex(/^-?[0-9]+\.[0-9]{6}$/),
    currency: z.literal('KORI'),
    blockNumber: z.number().int().nonnegative(),
    occurredAt: z.string().datetime()
  })
  .strict();

export const journalPostingContractSchema = z
  .object({
    accountCode: z.string().min(1).max(128),
    accountType: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense', 'control']),
    side: z.enum(['debit', 'credit']),
    amount: z.string().regex(/^-?[0-9]+\.[0-9]{6}$/)
  })
  .strict();

export const journalEntryContractSchema = z
  .object({
    schemaVersion: z.literal(LEDGER_SCHEMA_VERSION),
    eventType: z.literal('ledger.journal.recorded'),
    issuer: z.string().min(1).max(64),
    signature: z.string().regex(/^[a-f0-9]{64}$/),
    journalType: z.string().min(1).max(64),
    referenceType: z.string().min(1).max(32),
    referenceId: z.string().min(1).max(64),
    currency: z.enum(['KORI', 'TRX']),
    description: z.string().max(500).optional(),
    postings: z.array(journalPostingContractSchema).min(2),
    occurredAt: z.string().datetime()
  })
  .strict();

export const withdrawalStateChangedContractSchema = z
  .object({
    schemaVersion: z.literal(LEDGER_SCHEMA_VERSION),
    eventType: z.literal('withdrawal.state.changed'),
    issuer: z.string().min(1).max(64),
    signature: z.string().regex(/^[a-f0-9]{64}$/),
    withdrawalId: z.string().min(1).max(64),
    userId: z.string().min(1).max(64),
    status: withdrawalLedgerStatusSchema,
    amount: z.string().regex(/^-?[0-9]+\.[0-9]{6}$/),
    currency: z.literal('KORI'),
    toAddress: z.string().min(1).max(128),
    txHash: z.string().min(8).max(128).optional(),
    approvalCount: z.number().int().nonnegative(),
    requiredApprovals: z.number().int().positive(),
    externalAuthProvider: z.string().min(1).max(64).optional(),
    externalAuthRequestId: z.string().min(1).max(128).optional(),
    occurredAt: z.string().datetime()
  })
  .strict();

export type DepositStateChangedContract = z.infer<typeof depositStateChangedContractSchema>;
export type JournalEntryContract = z.infer<typeof journalEntryContractSchema>;
export type WithdrawalStateChangedContract = z.infer<typeof withdrawalStateChangedContractSchema>;
export type WithdrawalLedgerStatus = z.infer<typeof withdrawalLedgerStatusSchema>;
export type SupportedLedgerContract =
  | DepositStateChangedContract
  | JournalEntryContract
  | WithdrawalStateChangedContract;

const sortValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortValue(nested)])
    );
  }
  return value;
};

const signLedgerContractPayload = (payload: Record<string, unknown>) =>
  crypto
    .createHmac('sha256', env.ledgerIdentity.sharedHmacSecret)
    .update(JSON.stringify(sortValue(payload)))
    .digest('hex');

const attachLedgerEnvelope = <TPayload extends Record<string, unknown>>(payload: TPayload) => {
  const unsigned = {
    ...payload,
    issuer: env.ledgerIdentity.systemId
  };

  return {
    ...unsigned,
    signature: signLedgerContractPayload(unsigned)
  };
};

export const verifyLedgerContractSignature = (payload: { issuer: string; signature: string } & Record<string, unknown>) => {
  const { signature, ...unsigned } = payload;
  const expected = signLedgerContractPayload(unsigned);
  return signature === expected;
};

export const parseLedgerContract = (payload: unknown): SupportedLedgerContract => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('ledger contract payload must be an object');
  }

  const eventType = (payload as { eventType?: unknown }).eventType;
  switch (eventType) {
    case 'deposit.state.changed':
      return depositStateChangedContractSchema.parse(payload);
    case 'ledger.journal.recorded':
      return journalEntryContractSchema.parse(payload);
    case 'withdrawal.state.changed':
      return withdrawalStateChangedContractSchema.parse(payload);
    default:
      throw new Error(`unsupported ledger contract event type: ${String(eventType ?? '')}`);
  }
};

export const buildDepositStateChangedContract = (input: {
  depositId: string;
  userId: string;
  walletAddress: string;
  txHash: string;
  toAddress: string;
  status: 'DETECTED' | 'CONFIRMED' | 'CREDITED' | 'COMPLETED';
  amount: bigint;
  blockNumber: number;
  occurredAt: string;
}): DepositStateChangedContract =>
  depositStateChangedContractSchema.parse(
    attachLedgerEnvelope({
      schemaVersion: LEDGER_SCHEMA_VERSION,
      eventType: 'deposit.state.changed',
      depositId: input.depositId,
      userId: input.userId,
      walletAddress: input.walletAddress,
      txHash: input.txHash,
      toAddress: input.toAddress,
      status: input.status,
      amount: formatKoriAmount(input.amount),
      currency: 'KORI',
      blockNumber: input.blockNumber,
      occurredAt: input.occurredAt
    })
  );

export const buildJournalEntryContract = (input: {
  journalType: string;
  referenceType: string;
  referenceId: string;
  currency?: 'KORI' | 'TRX';
  description?: string;
  postings: JournalEntryContract['postings'];
  occurredAt: string;
}): JournalEntryContract =>
  journalEntryContractSchema.parse(
    attachLedgerEnvelope({
      schemaVersion: LEDGER_SCHEMA_VERSION,
      eventType: 'ledger.journal.recorded',
      journalType: input.journalType,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    currency: input.currency ?? 'KORI',
      description: input.description,
      postings: input.postings,
      occurredAt: input.occurredAt
    })
  );

export const mapWithdrawalStatusToLedgerContract = (withdrawal: Withdrawal): WithdrawalLedgerStatus => {
  switch (withdrawal.status) {
    case 'LEDGER_RESERVED':
      return 'LEDGER_RESERVED';
    case 'PENDING_ADMIN':
      return 'PENDING_ADMIN';
    case 'ADMIN_APPROVED':
      return 'ADMIN_APPROVED';
    case 'TX_BROADCASTED':
      return 'TX_BROADCASTED';
    case 'COMPLETED':
      return 'COMPLETED';
    case 'FAILED':
      return 'FAILED';
    case 'REJECTED':
      return 'REJECTED';
    default:
      return 'REQUESTED';
  }
};

export const buildWithdrawalStateChangedContract = (
  withdrawal: Withdrawal,
  occurredAt: string
): WithdrawalStateChangedContract =>
  withdrawalStateChangedContractSchema.parse(
    attachLedgerEnvelope({
      schemaVersion: LEDGER_SCHEMA_VERSION,
      eventType: 'withdrawal.state.changed',
      withdrawalId: withdrawal.withdrawalId,
    userId: withdrawal.userId,
    status: mapWithdrawalStatusToLedgerContract(withdrawal),
    amount: formatKoriAmount(withdrawal.amount),
    currency: 'KORI',
    toAddress: withdrawal.toAddress,
    txHash: withdrawal.txHash,
    approvalCount: withdrawal.approvalCount,
      requiredApprovals: withdrawal.requiredApprovals,
      externalAuthProvider: withdrawal.externalAuthProvider,
      externalAuthRequestId: withdrawal.externalAuthRequestId,
      occurredAt
    })
  );

export const buildLedgerContractExamples = () => ({
  schemaVersion: LEDGER_SCHEMA_VERSION,
  issuer: env.ledgerIdentity.systemId,
  events: {
    depositStateChanged: buildDepositStateChangedContract({
      depositId: 'dep-example-001',
      userId: '138',
      walletAddress: 'TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      txHash: 'mock-deposit-tx-001',
      toAddress: 'TSM7ocJQHigW9jhk5yFQKrUmBAXz2FFapa',
      status: 'COMPLETED',
      amount: 10_000n,
      blockNumber: 12345678,
      occurredAt: '2026-03-12T12:00:00.000Z'
    }),
    withdrawalStateChanged: buildWithdrawalStateChangedContract(
      {
        withdrawalId: 'wd-example-001',
        userId: '138',
        amount: 1_000_000n,
        toAddress: 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        status: 'ADMIN_APPROVED',
        idempotencyKey: 'withdraw-example-key',
        ledgerTxId: 'ledger-example-001',
        createdAt: '2026-03-12T12:00:00.000Z',
        riskLevel: 'medium',
        riskScore: 50,
        riskFlags: ['medium_amount'],
        requiredApprovals: 2,
        approvalCount: 2,
        externalAuthProvider: 'foxya-admin',
        externalAuthRequestId: 'admin-approval-001'
      },
      '2026-03-12T12:05:00.000Z'
    ),
    journalEntryRecorded: buildJournalEntryContract({
      journalType: 'withdraw_reserved',
      referenceType: 'withdrawal',
      referenceId: 'wd-example-001',
      description: 'Reserve user balance before admin approval',
      postings: [
        {
          accountCode: 'user:138:available',
          accountType: 'liability',
          side: 'debit',
          amount: '1.000000'
        },
        {
          accountCode: 'user:138:withdraw_pending',
          accountType: 'liability',
          side: 'credit',
          amount: '1.000000'
        }
      ],
      occurredAt: '2026-03-12T12:05:00.000Z'
    })
  }
});
