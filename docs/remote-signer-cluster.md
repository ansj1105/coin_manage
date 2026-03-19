# Remote Signer Cluster

`coin_manage`와 별도 `ledger-signer` 컨테이너를 같은 Docker network에 붙여 원격 서명 경계로 운영한다.

## 목적

- `coin_manage` 앱 프로세스가 hot-wallet 개인키를 직접 읽지 않도록 분리한다.
- signer 장애를 앱 API/worker와 독립적으로 롤링, 재시작, 격리할 수 있게 한다.
- 기존 단일 저장소 `app-signer` 역할은 유지하되, 분리 배포 시에는 `ledger-signer`를 우선한다.

## 네트워크

- `coin_manage`와 `ledger`는 같은 `SHARED_DOCKER_NETWORK_NAME` 값을 써야 한다.
- 현재 로컬 작업트리 기준 `coin_manage/.env` 값은 `fox_coin_fox_coin_foxya-network`다.
- `coin_manage`와 `ledger`가 같은 external network 이름을 사용해야 한다.

## coin_manage 설정

`.env` 또는 배포 env:

```env
WITHDRAW_SIGNER_BACKEND=remote
WITHDRAW_SIGNER_API_URL=http://ledger-signer:3000/api/internal/signer
WITHDRAW_SIGNER_API_KEY=replace-with-shared-internal-key
```

remote signer override 포함 기동:

```bash
docker compose -f docker-compose.yml -f docker-compose.remote-signer.yml up -d postgres flyway redis app-api app-withdraw-worker app-ops
```

주의:

- 분리 배포에서는 `app-signer`를 올리지 않는다.
- `WITHDRAW_SIGNER_API_URL`은 공통 signer base path다.
  - 출금 signer 경로: `/withdrawals/{withdrawalId}/broadcast`
  - hot-wallet Tron signer 경로: `/tron/*`

## ledger 설정

`ledger` 저장소 `.env` 예시:

```env
PORT=3000
WITHDRAW_SIGNER_API_KEY=replace-with-shared-internal-key
HOT_WALLET_ADDRESS=replace-with-hot-wallet-address
HOT_WALLET_PRIVATE_KEY=replace-with-hot-wallet-private-key
COIN_MANAGE_DB_HOST=coin-manage-postgres-host
COIN_MANAGE_DB_PORT=5432
COIN_MANAGE_DB_NAME=korion
COIN_MANAGE_DB_USER=korion
COIN_MANAGE_DB_PASSWORD=replace-with-db-password
COIN_MANAGE_VIRTUAL_WALLET_ENCRYPTION_KEY=replace-with-virtual-wallet-key
FOXYA_DB_HOST=foxya-db-host
FOXYA_DB_PORT=5432
FOXYA_DB_NAME=foxya
FOXYA_DB_USER=foxya
FOXYA_DB_PASSWORD=replace-with-db-password
FOXYA_ENCRYPTION_KEY=replace-with-foxya-encryption-key
TRON_API_URL=https://api.trongrid.io
MAINNET_TRON_API_URL=https://api.trongrid.io
TESTNET_TRON_API_URL=https://nile.trongrid.io
KORI_TOKEN_CONTRACT_ADDRESS=replace-with-main-profile-contract
MAINNET_KORI_TOKEN_CONTRACT_ADDRESS=replace-with-mainnet-contract
TESTNET_KORI_TOKEN_CONTRACT_ADDRESS=replace-with-testnet-contract
TRON_FEE_LIMIT_SUN=100000000
SHARED_DOCKER_NETWORK_NAME=fox_coin_fox_coin_foxya-network
LEDGER_SIGNER_PORT=3100
```

기동:

```bash
docker compose up -d --build
```

## 상태 확인

- signer health: `curl http://127.0.0.1:3100/health`
- `coin_manage` health: `curl http://127.0.0.1:3000/health`
- signer route smoke:

```bash
curl -sS \
  -H "x-internal-api-key: $WITHDRAW_SIGNER_API_KEY" \
  http://127.0.0.1:3100/health
```

## 현재 한계

- `ledger-signer`는 이제 hot-wallet 서명과 per-wallet 서명 경계를 모두 담당한다.
- signer 서비스가 `coin_manage virtual_wallet_bindings`, `foxya user_wallets`를 직접 조회하므로 DB 자격 증명과 암호화 키가 별도로 필요하다.
- 아직 HSM/MPC, signer HA, signer 전용 audit stream까지는 가지 않았다.
