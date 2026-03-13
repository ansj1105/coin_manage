# Reconciliation Architecture

## Goal

미반영 입금/출금을 주기 스캐너 실패와 분리해서 다시 내부원장으로 반영할 수 있어야 한다.

## Current Policy

- `deposit monitor worker`
  - 주기적으로 TRON KORI transfer event를 스캔한다.
  - cursor 기반으로 돌지만 `lookback window`를 겹쳐서 최근 구간은 반복 스캔한다.
- `withdraw reconcile`
  - `TX_BROADCASTED` 상태 출금을 다시 조회해서 `COMPLETED` 또는 `FAILED`로 전환한다.
- `account reconcile`
  - 유저 API 또는 운영 API에서 특정 주소/유저 기준으로 수동 재처리를 바로 걸 수 있다.

## API

### Wallet-triggered reconcile

- `GET /api/wallets/balance?userId=1&reconcile=true`
- `GET /api/wallets/1/balance?reconcile=true&lookbackMs=604800000`
- `POST /api/wallets/reconcile`

```json
{
  "userId": "1",
  "walletAddress": "TYteNy9PWTg9U68dnjwNnosQC9FP1Hgs1Z",
  "txHashes": [
    "e2c308c8e4b2d25d1d67652f59c50600916659f1cf35f5c07d6ca418f5228e61"
  ],
  "lookbackMs": 604800000
}
```

### System reconcile

- `POST /api/system/deposit-monitor/reconcile`
- `POST /api/withdrawals/reconcile`

## Recommended Operations Topology

- `coin_manage`
  - on-chain scanner
  - ledger apply/complete
  - reconcile API
- `foxya backend`
  - watch-address source
  - deposit registration/completion
- `user-facing app/admin`
  - 지갑 조회 시 `reconcile=true`를 붙여 미반영 상태를 즉시 재처리할 수 있다.

## Important Runtime Rule

`FOXYA_INTERNAL_API_URL`은 같은 Docker host가 아니면 container service name을 쓰면 안 된다.

- wrong: `http://foxya-api:8080/api/v1/internal/deposits`
- right on cross-host deployment: `http://54.210.92.221:8080/api/v1/internal/deposits`

같은 EC2 안의 compose stack이 아니면, 라우팅 가능한 IP 또는 도메인을 사용해야 한다.
