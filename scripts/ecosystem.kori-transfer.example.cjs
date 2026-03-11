module.exports = {
  apps: [
    {
      name: 'kori-transfer-worker',
      script: './scripts/kori-transfer-worker.mjs',
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NETWORK: 'mainnet',
        PRIVATE_KEY: 'replace-with-private-key',
        TO_ADDRESS: 'replace-with-recipient-address',
        AMOUNT_KORI: '1',
        TRON_API_URL: 'https://api.trongrid.io',
        TOKEN_CONTRACT_ADDRESS: 'TBJZD8RwQ1JcQvEP9BTbPbgBCGxUjxSXnn',
        TRON_API_KEY: 'replace-with-tron-api-key',
        MAX_REQUESTS_PER_WINDOW: '15',
        WINDOW_MS: '1000',
        REQUEST_COST_PER_SEND: '3',
        MAX_IN_FLIGHT: '2',
        POLL_INTERVAL_MS: '0',
        FEE_LIMIT_SUN: '100000000',
        STOP_ON_ERROR: 'false',
        LOG_PREFIX: 'kori-transfer-worker'
      }
    }
  ]
};
