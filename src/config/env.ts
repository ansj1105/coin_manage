import dotenv from 'dotenv';
import crypto from 'node:crypto';
import { z } from 'zod';

dotenv.config();

const PLACEHOLDER_SECRETS = new Set([
  'replace-with-strong-secret',
  'replace-with-private-key',
  'dev-only-secret-change-me',
  'dev-only-private-key-change-me'
]);

const hasAsmBinding = (name: string) => {
  const value = process.env[`${name}_ASM_SECRET_ID`];
  return typeof value === 'string' && value.trim() !== '';
};

const optionalBooleanString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.enum(['true', 'false']).optional()
);

const optionalUrlString = z.preprocess((value) => (value === '' ? undefined : value), z.string().url().optional());
const optionalNumberString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.coerce.number().int().nonnegative().optional()
);
const optionalString = z.preprocess((value) => (value === '' ? undefined : value), z.string().optional());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HTTP_ENABLED: optionalBooleanString,
  SINGLETON_WORKERS_ENABLED: optionalBooleanString,
  WITHDRAW_QUEUE_WORKER_ENABLED: optionalBooleanString,
  LEDGER_PROVIDER: z.enum(['memory', 'postgres']).default('memory'),
  TRON_GATEWAY_MODE: z.enum(['mock', 'trc20']).default('mock'),
  ALLOW_RUNTIME_PROFILE_SWITCHING: optionalBooleanString,
  ALLOW_SANDBOX_DIRECT_ONCHAIN_SEND: optionalBooleanString,
  ALLOW_MAINNET_SANDBOX_DIRECT_ONCHAIN_SEND: optionalBooleanString,
  WALLET_MONITOR_ENABLED: optionalBooleanString,
  WALLET_MONITOR_INTERVAL_SEC: z.coerce.number().int().positive().default(20),
  WALLET_MONITOR_REQUEST_GAP_MS: z.coerce.number().int().nonnegative().default(1500),
  JWT_SECRET: z.string().optional(),
  TRON_API_URL: z.string().url().default('https://api.trongrid.io'),
  MAINNET_TRON_API_URL: z.string().url().default('https://api.trongrid.io'),
  TESTNET_TRON_API_URL: z.string().url().default('https://nile.trongrid.io'),
  TRON_API_KEY: z.string().optional(),
  KORI_TOKEN_CONTRACT_ADDRESS: z.string().optional(),
  MAINNET_KORI_TOKEN_CONTRACT_ADDRESS: z.string().default('TBJZD8RwQ1JcQvEP9BTbPbgBCGxUjxSXnn'),
  TESTNET_KORI_TOKEN_CONTRACT_ADDRESS: z.string().default('TPKZnRjJngnxVgxw52pMPSrCp2wGm7iT9W'),
  TRON_FEE_LIMIT_SUN: z.coerce.number().int().positive().default(100000000),
  TREASURY_WALLET_ADDRESS: z.string().default('TSM7ocJQHigW9jhk5yFQKrUmBAXz2FFapa'),
  DEPOSIT_WALLET_ADDRESSES: z
    .string()
    .default('TWbuSkkRid1st9gSMy1NhpK1KwJMebHNwh,TLkgBr1vwpkdenM3LZq2hzb33TbCzBYDE3,TCFD5eZAXGdA8ud4ZH2Dt6cZdeGRFYSiaH,TMCUdq7BfaTRCdzUvYmuVoKnjZssYqnJ3s'),
  HOT_WALLET_ADDRESS: z.string().default('replace-with-hot-wallet-address'),
  HOT_WALLET_PRIVATE_KEY: z.string().optional(),
  WITHDRAW_SIGNER_MODE: z.enum(['hot', 'offline_stub', 'hybrid']).default('hot'),
  WITHDRAW_SIGNER_BACKEND: z.enum(['local', 'remote']).default('local'),
  WITHDRAW_SIGNER_API_URL: optionalUrlString,
  WITHDRAW_SIGNER_API_KEY: z.string().optional(),
  COLD_WITHDRAW_MIN_KORI: z.coerce.number().positive().default(100000),
  HOT_WALLET_ALERT_MIN_KORI: z.coerce.number().positive().default(1000),
  HOT_WALLET_ALERT_MIN_TRX: z.coerce.number().positive().default(100),
  HOT_WALLET_ALERT_COOLDOWN_SEC: z.coerce.number().int().positive().default(21600),
  SIGNUP_WALLET_COOLDOWN_SEC: z.coerce.number().int().positive().default(3600),
  ACTIVATION_GRANT_ENABLED: optionalBooleanString,
  ACTIVATION_GRANT_INTERVAL_SEC: z.coerce.number().int().positive().default(30),
  ACTIVATION_GRANT_CYCLE_LIMIT: z.coerce.number().int().positive().max(500).default(100),
  ACTIVATION_GRANT_AMOUNT_TRX: z.coerce.number().positive().default(1),
  ACTIVATION_RECLAIM_ENABLED: optionalBooleanString,
  ACTIVATION_RECLAIM_INTERVAL_SEC: z.coerce.number().int().positive().default(30),
  ACTIVATION_RECLAIM_CYCLE_LIMIT: z.coerce.number().int().positive().max(500).default(100),
  ACTIVATION_RECLAIM_AMOUNT_TRX: z.coerce.number().positive().default(1),
  ACTIVATION_RECLAIM_MIN_BANDWIDTH: z.coerce.number().int().nonnegative().default(300),
  RESOURCE_DELEGATION_ENABLED: optionalBooleanString,
  RESOURCE_DELEGATION_INTERVAL_SEC: z.coerce.number().int().positive().default(30),
  RESOURCE_DELEGATION_CYCLE_LIMIT: z.coerce.number().int().positive().max(500).default(100),
  RESOURCE_DELEGATION_BANDWIDTH_TRX: z.coerce.number().nonnegative().default(1),
  RESOURCE_DELEGATION_ENERGY_TRX: z.coerce.number().nonnegative().default(50),
  SWEEP_SOURCE_MIN_TRX: z.coerce.number().nonnegative().default(50),
  SWEEP_SOURCE_MIN_ENERGY: z.coerce.number().int().nonnegative().default(35000),
  SWEEP_QUEUE_TIMEOUT_SEC: z.coerce.number().int().positive().default(3600),
  SWEEP_MAX_RETRY_COUNT: z.coerce.number().int().positive().default(120),
  SWEEP_PLAN_MIN_KORI: z.coerce.number().positive().default(1),
  SWEEP_BOT_ENABLED: optionalBooleanString,
  SWEEP_BOT_POLL_INTERVAL_SEC: z.coerce.number().int().positive().default(30),
  SWEEP_BOT_CYCLE_LIMIT: z.coerce.number().int().positive().max(500).default(100),
  DEPOSIT_MONITOR_ENABLED: optionalBooleanString,
  DEPOSIT_MONITOR_NETWORK: z.enum(['mainnet', 'testnet']).default('mainnet'),
  DEPOSIT_MONITOR_POLL_INTERVAL_SEC: z.coerce.number().int().positive().default(20),
  DEPOSIT_MONITOR_CONFIRMATIONS: z.coerce.number().int().positive().default(20),
  DEPOSIT_MONITOR_START_TIMESTAMP_MS: optionalNumberString,
  DEPOSIT_MONITOR_LOOKBACK_MS: z.coerce.number().int().nonnegative().default(300000),
  DEPOSIT_MONITOR_PAGE_LIMIT: z.coerce.number().int().positive().max(200).default(200),
  DEPOSIT_MONITOR_CURRENCY_IDS: z.string().optional(),
  FOXYA_INTERNAL_API_URL: optionalUrlString,
  FOXYA_INTERNAL_API_KEY: z.string().optional(),
  FOXYA_INTERNAL_WALLET_API_URL: optionalUrlString,
  FOXYA_INTERNAL_WITHDRAWAL_API_URL: optionalUrlString,
  FOXYA_INTERNAL_WITHDRAWAL_API_KEY: z.string().optional(),
  FOXYA_DB_HOST: z.string().optional(),
  FOXYA_DB_PORT: z.coerce.number().int().positive().default(5432),
  FOXYA_DB_NAME: z.string().optional(),
  FOXYA_DB_USER: z.string().optional(),
  FOXYA_DB_PASSWORD: z.string().optional(),
  FOXYA_ENCRYPTION_KEY: z.string().optional(),
  VIRTUAL_WALLET_ENCRYPTION_KEY: z.string().optional(),
  LEDGER_SYSTEM_ID: z.string().min(1).default('korion'),
  LEDGER_SHARED_HMAC_SECRET: z.string().optional(),
  ALERT_MONITOR_ENABLED: optionalBooleanString,
  ALERT_MONITOR_POLL_INTERVAL_SEC: z.coerce.number().int().positive().default(30),
  ALERT_MONITOR_EVENT_LIMIT: z.coerce.number().int().positive().max(500).default(100),
  ALERT_MONITOR_HEALTH_FAILURE_THRESHOLD: z.coerce.number().int().positive().max(10).default(2),
  ALERT_MONITOR_TABLES: optionalString,
  ALERT_MONITOR_HEALTH_TARGETS: optionalString,
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().default('korion'),
  DB_USER: z.string().default('korion'),
  DB_PASSWORD: z.string().default('korion'),
  DB_SCHEMA: z.string().default('public'),
  REDIS_ENABLED: optionalBooleanString,
  REDIS_URL: z.string().url().default('redis://127.0.0.1:6379'),
  REDIS_KEY_PREFIX: z.string().default('korion'),
  WITHDRAW_REQUEST_API_KEY: z.string().optional(),
  WITHDRAW_ADMIN_API_KEY: z.string().optional(),
  WITHDRAW_SINGLE_LIMIT_KORI: z.coerce.number().positive().default(10000),
  WITHDRAW_DAILY_LIMIT_KORI: z.coerce.number().positive().default(50000),
  SCHEDULER_PENDING_TIMEOUT_SEC: z.coerce.number().int().positive().default(60),
  WITHDRAW_DISPATCH_ENABLED: optionalBooleanString,
  WITHDRAW_DISPATCH_INTERVAL_SEC: z.coerce.number().int().positive().default(15),
  WITHDRAW_DISPATCH_CYCLE_LIMIT: z.coerce.number().int().positive().max(500).default(50),
  WITHDRAW_DISPATCH_MAX_RETRY_COUNT: z.coerce.number().int().positive().default(20),
  WITHDRAW_RETRY_BASE_DELAY_SEC: z.coerce.number().int().positive().default(15),
  OUTBOX_PUBLISH_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  OUTBOX_PUBLISH_BATCH_SIZE: z.coerce.number().int().positive().max(500).default(100),
  OUTBOX_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(30000),
  OUTBOX_RETRY_MAX_DELAY_MS: z.coerce.number().int().positive().default(300000),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
  OUTBOX_PROCESSING_STALE_TIMEOUT_SEC: z.coerce.number().int().positive().default(300),
  WITHDRAW_MIN_TRX_SUN: z.coerce.number().int().nonnegative().default(5_000_000),
  WITHDRAW_MIN_BANDWIDTH: z.coerce.number().int().nonnegative().default(500),
  WITHDRAW_MIN_ENERGY: z.coerce.number().int().nonnegative().default(10_000)
});

const parsed = schema.parse(process.env);

const foxyaAlertTables = ['internal_transfers', 'external_transfers', 'token_deposits', 'payment_deposits', 'swaps', 'exchanges'] as const;

const parseAlertMonitorTables = (value?: string) => {
  const configured = (value ?? foxyaAlertTables.join(','))
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return configured.filter((item): item is (typeof foxyaAlertTables)[number] =>
    (foxyaAlertTables as readonly string[]).includes(item)
  );
};

const parseHealthTargets = (value?: string) => {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .flatMap((item) => {
      const [namePart, ...urlParts] = item.split('=');
      const url = urlParts.join('=').trim();
      const name = namePart.trim();
      if (!name || !url) {
        return [];
      }

      return [
        {
          key: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          name,
          url
        }
      ];
    });
};

if (parsed.NODE_ENV === 'production') {
  if ((!parsed.JWT_SECRET || PLACEHOLDER_SECRETS.has(parsed.JWT_SECRET)) && !hasAsmBinding('JWT_SECRET')) {
    throw new Error('JWT_SECRET is required in production');
  }
  if (
    parsed.WITHDRAW_SIGNER_BACKEND !== 'remote' &&
    (!parsed.HOT_WALLET_PRIVATE_KEY || PLACEHOLDER_SECRETS.has(parsed.HOT_WALLET_PRIVATE_KEY)) &&
    !hasAsmBinding('HOT_WALLET_PRIVATE_KEY')
  ) {
    throw new Error('HOT_WALLET_PRIVATE_KEY is required in production');
  }
  if (
    (!parsed.VIRTUAL_WALLET_ENCRYPTION_KEY || PLACEHOLDER_SECRETS.has(parsed.VIRTUAL_WALLET_ENCRYPTION_KEY)) &&
    !hasAsmBinding('VIRTUAL_WALLET_ENCRYPTION_KEY')
  ) {
    throw new Error('VIRTUAL_WALLET_ENCRYPTION_KEY is required in production');
  }
}

if (parsed.TRON_GATEWAY_MODE === 'trc20' && !parsed.KORI_TOKEN_CONTRACT_ADDRESS) {
  throw new Error('KORI_TOKEN_CONTRACT_ADDRESS is required when TRON_GATEWAY_MODE=trc20');
}

export const env = Object.freeze({
  nodeEnv: parsed.NODE_ENV,
  port: parsed.PORT,
  httpEnabled: parsed.HTTP_ENABLED !== undefined ? parsed.HTTP_ENABLED === 'true' : true,
  singletonWorkersEnabled:
    parsed.SINGLETON_WORKERS_ENABLED !== undefined ? parsed.SINGLETON_WORKERS_ENABLED === 'true' : true,
  withdrawQueueWorkerEnabled:
    parsed.WITHDRAW_QUEUE_WORKER_ENABLED !== undefined ? parsed.WITHDRAW_QUEUE_WORKER_ENABLED === 'true' : true,
  ledgerProvider: parsed.LEDGER_PROVIDER,
  tronGatewayMode: parsed.TRON_GATEWAY_MODE,
  runtimeProfileEditable:
    parsed.ALLOW_RUNTIME_PROFILE_SWITCHING !== undefined
      ? parsed.ALLOW_RUNTIME_PROFILE_SWITCHING === 'true'
      : parsed.NODE_ENV !== 'production',
  sandboxDirectOnchainSendEnabled:
    parsed.ALLOW_SANDBOX_DIRECT_ONCHAIN_SEND !== undefined
      ? parsed.ALLOW_SANDBOX_DIRECT_ONCHAIN_SEND === 'true'
      : parsed.NODE_ENV !== 'production',
  sandboxMainnetDirectOnchainSendEnabled:
    parsed.ALLOW_MAINNET_SANDBOX_DIRECT_ONCHAIN_SEND !== undefined
      ? parsed.ALLOW_MAINNET_SANDBOX_DIRECT_ONCHAIN_SEND === 'true'
      : false,
  walletMonitorEnabled:
    parsed.WALLET_MONITOR_ENABLED !== undefined ? parsed.WALLET_MONITOR_ENABLED === 'true' : true,
  walletMonitorIntervalSec: parsed.WALLET_MONITOR_INTERVAL_SEC,
  walletMonitorRequestGapMs: parsed.WALLET_MONITOR_REQUEST_GAP_MS,
  jwtSecret: parsed.JWT_SECRET ?? 'dev-only-secret-change-me',
  tronApiUrl: parsed.TRON_API_URL,
  mainnetTronApiUrl: parsed.MAINNET_TRON_API_URL,
  testnetTronApiUrl: parsed.TESTNET_TRON_API_URL,
  tronApiKey: parsed.TRON_API_KEY,
  koriTokenContractAddress: parsed.KORI_TOKEN_CONTRACT_ADDRESS,
  mainnetKoriTokenContractAddress: parsed.MAINNET_KORI_TOKEN_CONTRACT_ADDRESS,
  testnetKoriTokenContractAddress: parsed.TESTNET_KORI_TOKEN_CONTRACT_ADDRESS,
  tronFeeLimitSun: parsed.TRON_FEE_LIMIT_SUN,
  treasuryWalletAddress: parsed.TREASURY_WALLET_ADDRESS,
  depositWalletAddresses: parsed.DEPOSIT_WALLET_ADDRESSES.split(',')
    .map((item) => item.trim())
    .filter(Boolean),
  hotWalletAddress: parsed.HOT_WALLET_ADDRESS,
  hotWalletPrivateKey: parsed.HOT_WALLET_PRIVATE_KEY ?? 'dev-only-private-key-change-me',
  withdrawSignerMode: parsed.WITHDRAW_SIGNER_MODE,
  withdrawSignerBackend: parsed.WITHDRAW_SIGNER_BACKEND,
  withdrawSignerApiUrl: parsed.WITHDRAW_SIGNER_API_URL,
  withdrawSignerApiKey: parsed.WITHDRAW_SIGNER_API_KEY,
  coldWithdrawMinKori: parsed.COLD_WITHDRAW_MIN_KORI,
  hotWalletAlertMinKori: parsed.HOT_WALLET_ALERT_MIN_KORI,
  hotWalletAlertMinTrx: parsed.HOT_WALLET_ALERT_MIN_TRX,
  hotWalletAlertCooldownSec: parsed.HOT_WALLET_ALERT_COOLDOWN_SEC,
  signupWalletCooldownSec: parsed.SIGNUP_WALLET_COOLDOWN_SEC,
  activationGrantEnabled:
    parsed.ACTIVATION_GRANT_ENABLED !== undefined ? parsed.ACTIVATION_GRANT_ENABLED === 'true' : false,
  activationGrantIntervalSec: parsed.ACTIVATION_GRANT_INTERVAL_SEC,
  activationGrantCycleLimit: parsed.ACTIVATION_GRANT_CYCLE_LIMIT,
  activationGrantAmountTrx: parsed.ACTIVATION_GRANT_AMOUNT_TRX,
  activationReclaimEnabled:
    parsed.ACTIVATION_RECLAIM_ENABLED !== undefined ? parsed.ACTIVATION_RECLAIM_ENABLED === 'true' : false,
  activationReclaimIntervalSec: parsed.ACTIVATION_RECLAIM_INTERVAL_SEC,
  activationReclaimCycleLimit: parsed.ACTIVATION_RECLAIM_CYCLE_LIMIT,
  activationReclaimAmountTrx: parsed.ACTIVATION_RECLAIM_AMOUNT_TRX,
  activationReclaimMinBandwidth: parsed.ACTIVATION_RECLAIM_MIN_BANDWIDTH,
  resourceDelegationEnabled:
    parsed.RESOURCE_DELEGATION_ENABLED !== undefined ? parsed.RESOURCE_DELEGATION_ENABLED === 'true' : false,
  resourceDelegationIntervalSec: parsed.RESOURCE_DELEGATION_INTERVAL_SEC,
  resourceDelegationCycleLimit: parsed.RESOURCE_DELEGATION_CYCLE_LIMIT,
  resourceDelegationBandwidthTrx: parsed.RESOURCE_DELEGATION_BANDWIDTH_TRX,
  resourceDelegationEnergyTrx: parsed.RESOURCE_DELEGATION_ENERGY_TRX,
  sweepSourceMinTrx: parsed.SWEEP_SOURCE_MIN_TRX,
  sweepSourceMinEnergy: parsed.SWEEP_SOURCE_MIN_ENERGY,
  sweepQueueTimeoutSec: parsed.SWEEP_QUEUE_TIMEOUT_SEC,
  sweepMaxRetryCount: parsed.SWEEP_MAX_RETRY_COUNT,
  sweepPlanMinKori: parsed.SWEEP_PLAN_MIN_KORI,
  sweepBotEnabled: parsed.SWEEP_BOT_ENABLED !== undefined ? parsed.SWEEP_BOT_ENABLED === 'true' : false,
  sweepBotPollIntervalSec: parsed.SWEEP_BOT_POLL_INTERVAL_SEC,
  sweepBotCycleLimit: parsed.SWEEP_BOT_CYCLE_LIMIT,
  depositMonitorEnabled:
    parsed.DEPOSIT_MONITOR_ENABLED !== undefined ? parsed.DEPOSIT_MONITOR_ENABLED === 'true' : false,
  depositMonitorNetwork: parsed.DEPOSIT_MONITOR_NETWORK,
  depositMonitorPollIntervalSec: parsed.DEPOSIT_MONITOR_POLL_INTERVAL_SEC,
  depositMonitorConfirmations: parsed.DEPOSIT_MONITOR_CONFIRMATIONS,
  depositMonitorStartTimestampMs: parsed.DEPOSIT_MONITOR_START_TIMESTAMP_MS,
  depositMonitorLookbackMs: parsed.DEPOSIT_MONITOR_LOOKBACK_MS,
  depositMonitorPageLimit: parsed.DEPOSIT_MONITOR_PAGE_LIMIT,
  depositMonitorCurrencyIds: (parsed.DEPOSIT_MONITOR_CURRENCY_IDS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0),
  foxyaInternalApiUrl: parsed.FOXYA_INTERNAL_API_URL,
  foxyaInternalApiKey: parsed.FOXYA_INTERNAL_API_KEY,
  foxyaInternalWalletApiUrl: parsed.FOXYA_INTERNAL_WALLET_API_URL,
  foxyaInternalWithdrawalApiUrl: parsed.FOXYA_INTERNAL_WITHDRAWAL_API_URL,
  foxyaInternalWithdrawalApiKey: parsed.FOXYA_INTERNAL_WITHDRAWAL_API_KEY ?? parsed.FOXYA_INTERNAL_API_KEY,
  foxyaDb:
    parsed.FOXYA_DB_HOST && parsed.FOXYA_DB_NAME && parsed.FOXYA_DB_USER
      ? {
          host: parsed.FOXYA_DB_HOST,
          port: parsed.FOXYA_DB_PORT,
          name: parsed.FOXYA_DB_NAME,
          user: parsed.FOXYA_DB_USER,
          password: parsed.FOXYA_DB_PASSWORD ?? '',
          encryptionKey: parsed.FOXYA_ENCRYPTION_KEY
        }
      : undefined,
  virtualWalletEncryptionKey: parsed.VIRTUAL_WALLET_ENCRYPTION_KEY ?? 'dev-only-secret-change-me',
  ledgerIdentity: {
    systemId: parsed.LEDGER_SYSTEM_ID,
    sharedHmacSecret:
      parsed.LEDGER_SHARED_HMAC_SECRET ?? crypto.createHash('sha256').update('korion-dev-ledger-secret').digest('hex')
  },
  alertMonitor: {
    enabled: parsed.ALERT_MONITOR_ENABLED !== undefined ? parsed.ALERT_MONITOR_ENABLED === 'true' : false,
    pollIntervalSec: parsed.ALERT_MONITOR_POLL_INTERVAL_SEC,
    eventLimit: parsed.ALERT_MONITOR_EVENT_LIMIT,
    healthFailureThreshold: parsed.ALERT_MONITOR_HEALTH_FAILURE_THRESHOLD,
    tables: parseAlertMonitorTables(parsed.ALERT_MONITOR_TABLES),
    healthTargets: parseHealthTargets(parsed.ALERT_MONITOR_HEALTH_TARGETS)
  },
  telegram:
    parsed.TELEGRAM_BOT_TOKEN && parsed.TELEGRAM_CHAT_ID
      ? {
          botToken: parsed.TELEGRAM_BOT_TOKEN,
          chatId: parsed.TELEGRAM_CHAT_ID
        }
      : undefined,
  db: {
    host: parsed.DB_HOST,
    port: parsed.DB_PORT,
    name: parsed.DB_NAME,
    user: parsed.DB_USER,
    password: parsed.DB_PASSWORD,
    schema: parsed.DB_SCHEMA
  },
  redisEnabled: parsed.REDIS_ENABLED !== undefined ? parsed.REDIS_ENABLED === 'true' : false,
  redisUrl: parsed.REDIS_URL,
  redisKeyPrefix: parsed.REDIS_KEY_PREFIX,
  withdrawRequestApiKey: parsed.WITHDRAW_REQUEST_API_KEY,
  withdrawAdminApiKey: parsed.WITHDRAW_ADMIN_API_KEY,
  withdrawSingleLimitKori: parsed.WITHDRAW_SINGLE_LIMIT_KORI,
  withdrawDailyLimitKori: parsed.WITHDRAW_DAILY_LIMIT_KORI,
  schedulerPendingTimeoutSec: parsed.SCHEDULER_PENDING_TIMEOUT_SEC,
  withdrawDispatchEnabled:
    parsed.WITHDRAW_DISPATCH_ENABLED !== undefined ? parsed.WITHDRAW_DISPATCH_ENABLED === 'true' : true,
  withdrawDispatchIntervalSec: parsed.WITHDRAW_DISPATCH_INTERVAL_SEC,
  withdrawDispatchCycleLimit: parsed.WITHDRAW_DISPATCH_CYCLE_LIMIT,
  withdrawDispatchMaxRetryCount: parsed.WITHDRAW_DISPATCH_MAX_RETRY_COUNT,
  withdrawRetryBaseDelaySec: parsed.WITHDRAW_RETRY_BASE_DELAY_SEC,
  outboxPublishIntervalMs: parsed.OUTBOX_PUBLISH_INTERVAL_MS,
  outboxPublishBatchSize: parsed.OUTBOX_PUBLISH_BATCH_SIZE,
  outboxRetryBaseDelayMs: parsed.OUTBOX_RETRY_BASE_DELAY_MS,
  outboxRetryMaxDelayMs: parsed.OUTBOX_RETRY_MAX_DELAY_MS,
  outboxMaxAttempts: parsed.OUTBOX_MAX_ATTEMPTS,
  outboxProcessingStaleTimeoutSec: parsed.OUTBOX_PROCESSING_STALE_TIMEOUT_SEC,
  withdrawMinTrxSun: BigInt(parsed.WITHDRAW_MIN_TRX_SUN),
  withdrawMinBandwidth: parsed.WITHDRAW_MIN_BANDWIDTH,
  withdrawMinEnergy: parsed.WITHDRAW_MIN_ENERGY
});
