# Ledger Contract Integration

`coin_manage` now exposes signed ledger contracts for backend and admin integration.

## Contract types

- `deposit.state.changed`
- `withdrawal.state.changed`
- `ledger.journal.recorded`

All payloads include:

- `schemaVersion`
- `issuer`
- `signature`

`signature` is an `HMAC-SHA256` over the sorted JSON payload without the `signature` field.

## Runtime settings

- `LEDGER_SYSTEM_ID`
- `LEDGER_SHARED_HMAC_SECRET`

All downstream services that verify the contract must use the same shared secret.

## Discovery endpoints

- `GET /system/ledger/contracts`
  - Returns issuer, schema version, verification note, and signed example payloads.
- `POST /system/ledger/contracts/verify`
  - Request body:

```json
{
  "payload": {
    "eventType": "withdrawal.state.changed"
  }
}
```

  - Response body:

```json
{
  "valid": true,
  "eventType": "withdrawal.state.changed",
  "issuer": "korion"
}
```

## Recommended downstream policy

- Reject payloads with unsupported `eventType`
- Reject payloads with invalid signature
- Reject payloads with unexpected `issuer`
- Validate `schemaVersion`
- Treat `referenceId`, `withdrawalId`, `depositId` as idempotency keys
