# .env Required Settings

`KORION KORI Backend` 환경변수 정의입니다.

## Core
| Key | Required (dev) | Required (prod) | Default | Description |
|---|---|---|---|---|
| `NODE_ENV` | No | Yes | `development` | 런타임 환경 (`development`, `test`, `production`) |
| `PORT` | No | Yes | `3000` | API 서버 포트 |
| `LEDGER_PROVIDER` | No | Yes | `memory` | Ledger 저장소 선택 (`memory`, `postgres`) |
| `JWT_SECRET` | No | Yes | `dev-only-secret-change-me` | 인증 토큰 서명 키 |

## TRON / Wallet
| Key | Required (dev) | Required (prod) | Default | Description |
|---|---|---|---|---|
| `TRON_API_URL` | No | Yes | `https://api.trongrid.io` | TRON 노드/게이트웨이 URL |
| `TREASURY_WALLET_ADDRESS` | No | Yes | `TSM7ocJQHigW9jhk5yFQKrUmBAXz2FFapa` | 재단(트레저리) 지갑 주소 |
| `DEPOSIT_WALLET_ADDRESSES` | No | Yes | `TWbuSkkRid1st9gSMy1NhpK1KwJMebHNwh,TLkgBr1vwpkdenM3LZq2hzb33TbCzBYDE3,TCFD5eZAXGdA8ud4ZH2Dt6cZdeGRFYSiaH,TMCUdq7BfaTRCdzUvYmuVoKnjZssYqnJ3s` | 입금 감지 대상 지갑 목록(콤마 구분) |
| `HOT_WALLET_ADDRESS` | No | Yes | `TYKL8DPoR99bccujHXxcyBewCV1NimdRc8` | 핫월렛 주소 |
| `HOT_WALLET_PRIVATE_KEY` | No | Yes | `dev-only-private-key-change-me` | 핫월렛 개인키 (로그 출력 금지) |

## PostgreSQL / Flyway
| Key | Required (dev) | Required (prod) | Default | Description |
|---|---|---|---|---|
| `DB_HOST` | No | Yes | `127.0.0.1` | DB 호스트 |
| `DB_PORT` | No | Yes | `5432` | DB 포트 |
| `DB_NAME` | No | Yes | `korion` | DB 이름 |
| `DB_USER` | No | Yes | `korion` | DB 사용자 |
| `DB_PASSWORD` | No | Yes | `korion` | DB 비밀번호 |
| `DB_SCHEMA` | No | Yes | `public` | Flyway 대상 스키마 |

## Risk Control / Scheduler
| Key | Required (dev) | Required (prod) | Default | Description |
|---|---|---|---|---|
| `WITHDRAW_SINGLE_LIMIT_KORI` | No | Yes | `10000` | 1회 출금 한도 (KORI) |
| `WITHDRAW_DAILY_LIMIT_KORI` | No | Yes | `50000` | 1일 출금 누적 한도 (KORI) |
| `SCHEDULER_PENDING_TIMEOUT_SEC` | No | Yes | `60` | pending 재처리 기준 시간(초) |

## Example
```bash
cp .env.example .env
```
