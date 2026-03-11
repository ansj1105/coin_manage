import 'dotenv/config';
import { TronWeb } from 'tronweb';

const TRC20_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  }
];

const MAINNET_API_URL = 'https://api.trongrid.io';
const TESTNET_API_URL = 'https://nile.trongrid.io';
const MAINNET_KORI_CONTRACT = 'TBJZD8RwQ1JcQvEP9BTbPbgBCGxUjxSXnn';
const TESTNET_KORI_CONTRACT = 'TPKZnRjJngnxVgxw52pMPSrCp2wGm7iT9W';
const TRON_ADDRESS_PATTERN = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const KORI_SCALE = 1_000_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseBoolean = (value, fallback = false) => {
  if (value === undefined) {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const parsePositiveInt = (name, fallback) => {
  const raw = process.env[name] ?? fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
};

const parseNonNegativeInt = (name, fallback) => {
  const raw = process.env[name] ?? fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
};

const parseAmountUnits = (amountText) => {
  const amount = Number(amountText);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('AMOUNT_KORI must be a positive number');
  }

  const scaled = amount * KORI_SCALE;
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) > 0.000001) {
    throw new Error('AMOUNT_KORI supports up to 6 decimals');
  }

  return BigInt(rounded);
};

const requireEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const resolveNetwork = () => {
  const network = (process.env.NETWORK ?? 'mainnet').trim().toLowerCase();
  if (!['mainnet', 'testnet', 'custom'].includes(network)) {
    throw new Error('NETWORK must be mainnet, testnet, or custom');
  }
  return network;
};

const resolveApiUrl = (network) => {
  if (process.env.TRON_API_URL?.trim()) {
    return process.env.TRON_API_URL.trim();
  }

  if (network === 'mainnet') {
    return MAINNET_API_URL;
  }
  if (network === 'testnet') {
    return TESTNET_API_URL;
  }

  throw new Error('TRON_API_URL is required when NETWORK=custom');
};

const resolveContractAddress = (network) => {
  if (process.env.TOKEN_CONTRACT_ADDRESS?.trim()) {
    return process.env.TOKEN_CONTRACT_ADDRESS.trim();
  }

  if (network === 'mainnet') {
    return MAINNET_KORI_CONTRACT;
  }
  if (network === 'testnet') {
    return TESTNET_KORI_CONTRACT;
  }

  throw new Error('TOKEN_CONTRACT_ADDRESS is required when NETWORK=custom');
};

const validateTronAddress = (name, value) => {
  if (!TRON_ADDRESS_PATTERN.test(value)) {
    throw new Error(`${name} must be a valid TRON base58 address`);
  }
  return value;
};

const parseConfig = () => {
  const network = resolveNetwork();
  const privateKey = requireEnv('PRIVATE_KEY');
  const toAddress = validateTronAddress('TO_ADDRESS', requireEnv('TO_ADDRESS'));
  const fromAddress = TronWeb.address.fromPrivateKey(privateKey);
  if (!fromAddress) {
    throw new Error('PRIVATE_KEY is invalid');
  }

  const amountUnits = parseAmountUnits(requireEnv('AMOUNT_KORI'));
  const amountKori = requireEnv('AMOUNT_KORI');
  const maxRequestsPerWindow = parsePositiveInt('MAX_REQUESTS_PER_WINDOW', '15');
  const windowMs = parsePositiveInt('WINDOW_MS', '1000');
  const requestCostPerSend = parsePositiveInt('REQUEST_COST_PER_SEND', '3');
  const maxInFlight = parsePositiveInt('MAX_IN_FLIGHT', '1');
  const pollIntervalMs = parseNonNegativeInt('POLL_INTERVAL_MS', '0');
  const feeLimitSun = parsePositiveInt('FEE_LIMIT_SUN', '100000000');
  const stopOnError = parseBoolean(process.env.STOP_ON_ERROR, false);
  const tronApiKey = process.env.TRON_API_KEY?.trim() || undefined;
  const tronApiUrl = resolveApiUrl(network);
  const tokenContractAddress = validateTronAddress('TOKEN_CONTRACT_ADDRESS', resolveContractAddress(network));
  const logPrefix = process.env.LOG_PREFIX?.trim() || 'kori-transfer-worker';

  if (requestCostPerSend > maxRequestsPerWindow) {
    throw new Error('REQUEST_COST_PER_SEND cannot be greater than MAX_REQUESTS_PER_WINDOW');
  }

  return {
    network,
    privateKey,
    fromAddress,
    toAddress,
    amountKori,
    amountUnits,
    maxRequestsPerWindow,
    windowMs,
    requestCostPerSend,
    maxInFlight,
    pollIntervalMs,
    feeLimitSun,
    stopOnError,
    tronApiKey,
    tronApiUrl,
    tokenContractAddress,
    logPrefix
  };
};

class RollingWindowRateLimiter {
  constructor(maxCost, windowMs) {
    this.maxCost = maxCost;
    this.windowMs = windowMs;
    this.events = [];
    this.pending = Promise.resolve();
  }

  async acquire(cost) {
    this.pending = this.pending.then(() => this.acquireInternal(cost));
    return this.pending;
  }

  async acquireInternal(cost) {
    for (;;) {
      const now = Date.now();
      this.trim(now);
      const used = this.events.reduce((sum, event) => sum + event.cost, 0);

      if (used + cost <= this.maxCost) {
        this.events.push({ cost, at: now });
        return;
      }

      const oldest = this.events[0];
      const waitMs = Math.max(1, this.windowMs - (now - oldest.at));
      await sleep(waitMs);
    }
  }

  trim(now) {
    while (this.events.length > 0 && now - this.events[0].at >= this.windowMs) {
      this.events.shift();
    }
  }
}

const createWorkerClient = async (config) => {
  const tronWeb = new TronWeb({
    fullHost: config.tronApiUrl,
    headers: config.tronApiKey
      ? {
          'TRON-PRO-API-KEY': config.tronApiKey
        }
      : undefined,
    privateKey: config.privateKey
  });

  tronWeb.setAddress(config.fromAddress);

  const contract = await tronWeb.contract(TRC20_ABI, config.tokenContractAddress).at(config.tokenContractAddress);
  return { contract };
};

const createLogger = (prefix) => ({
  info(payload) {
    console.log(JSON.stringify({ level: 'info', prefix, ...payload }));
  },
  error(payload) {
    console.error(JSON.stringify({ level: 'error', prefix, ...payload }));
  }
});

const config = parseConfig();
const logger = createLogger(config.logPrefix);
const limiter = new RollingWindowRateLimiter(config.maxRequestsPerWindow, config.windowMs);
const requestLogPayload = Object.freeze({
  network: config.network,
  tronApiUrl: config.tronApiUrl,
  tokenContractAddress: config.tokenContractAddress,
  fromAddress: config.fromAddress,
  toAddress: config.toAddress,
  amountKori: config.amountKori,
  amountUnits: config.amountUnits.toString(),
  feeLimitSun: config.feeLimitSun,
  requestCostPerSend: config.requestCostPerSend
});

const stats = {
  attempted: 0,
  succeeded: 0,
  failed: 0
};

let stopping = false;

const requestStop = (signal) => {
  if (stopping) {
    return;
  }
  stopping = true;
  logger.info({
    event: 'shutdown_requested',
    signal,
    attempted: stats.attempted,
    succeeded: stats.succeeded,
    failed: stats.failed
  });
};

process.on('SIGINT', () => requestStop('SIGINT'));
process.on('SIGTERM', () => requestStop('SIGTERM'));

const sendOnce = async (contract, workerId) => {
  await limiter.acquire(config.requestCostPerSend);
  const sequence = ++stats.attempted;
  const startedAt = new Date().toISOString();

  logger.info({
    event: 'transfer_request',
    workerId,
    sequence,
    requestedAt: startedAt,
    params: requestLogPayload
  });

  try {
    const txHash = await contract.transfer(config.toAddress, config.amountUnits.toString()).send({
      feeLimit: config.feeLimitSun,
      shouldPollResponse: false
    });

    stats.succeeded += 1;
    logger.info({
      event: 'transfer_sent',
      workerId,
      sequence,
      txHash,
      startedAt,
      finishedAt: new Date().toISOString(),
      params: requestLogPayload,
      attempted: stats.attempted,
      succeeded: stats.succeeded,
      failed: stats.failed
    });
  } catch (error) {
    stats.failed += 1;
    logger.error({
      event: 'transfer_failed',
      workerId,
      sequence,
      startedAt,
      finishedAt: new Date().toISOString(),
      params: requestLogPayload,
      attempted: stats.attempted,
      succeeded: stats.succeeded,
      failed: stats.failed,
      message: error instanceof Error ? error.message : String(error)
    });

    if (config.stopOnError) {
      requestStop('STOP_ON_ERROR');
      process.exitCode = 1;
    }
  }
};

const runWorker = async (workerId) => {
  const { contract } = await createWorkerClient(config);

  while (!stopping) {
    await sendOnce(contract, workerId);

    if (stopping) {
      break;
    }

    if (config.pollIntervalMs > 0) {
      await sleep(config.pollIntervalMs);
    }
  }
};

logger.info({
  event: 'worker_started',
  network: config.network,
  tronApiUrl: config.tronApiUrl,
  tokenContractAddress: config.tokenContractAddress,
  fromAddress: config.fromAddress,
  toAddress: config.toAddress,
  amountKori: config.amountKori,
  maxRequestsPerWindow: config.maxRequestsPerWindow,
  windowMs: config.windowMs,
  requestCostPerSend: config.requestCostPerSend,
  maxInFlight: config.maxInFlight,
  pollIntervalMs: config.pollIntervalMs,
  feeLimitSun: config.feeLimitSun
});

try {
  await Promise.all(Array.from({ length: config.maxInFlight }, (_, index) => runWorker(index + 1)));
  logger.info({
    event: 'worker_stopped',
    attempted: stats.attempted,
    succeeded: stats.succeeded,
    failed: stats.failed
  });
} catch (error) {
  logger.error({
    event: 'worker_crashed',
    attempted: stats.attempted,
    succeeded: stats.succeeded,
    failed: stats.failed,
    message: error instanceof Error ? error.message : String(error)
  });
  process.exitCode = 1;
}
