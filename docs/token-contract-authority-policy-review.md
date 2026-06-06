# KORION Token Contract Authority Policy Review

Date: 2026-06-06

## Scope

- Token: KORION (`KORI`)
- Network: TRON mainnet TRC-20
- Contract: `TBJZD8RwQ1JcQvEP9BTbPbgBCGxUjxSXnn`
- Related service repo evidence: `coin_manage`

This document separates confirmed on-chain state from policy decisions that still need governance implementation.

## Confirmed State

Evidence sources:

- TRONSCAN contract API: `https://apilist.tronscanapi.com/api/contract?contract=TBJZD8RwQ1JcQvEP9BTbPbgBCGxUjxSXnn`
- TRONSCAN token API: `https://apilist.tronscanapi.com/api/token_trc20?contract=TBJZD8RwQ1JcQvEP9BTbPbgBCGxUjxSXnn`
- TRON mainnet constant calls through `https://api.trongrid.io`
- Local runtime references in `coin_manage/docker-compose.yml`, `coin_manage/ENVIRONMENT.md`, and `coin_manage/README.md`

Observed values:

- Contract verification status: verified on TRONSCAN (`verify_status=2`)
- Contract name: `KORIONToken`
- Token name/symbol/decimals: `KORION` / `KORI` / `6`
- Total supply at review time: `10000000000000000` base units = `10,000,000,000 KORI`
- Current owner at review time: `TSM7ocJQHigW9jhk5yFQKrUmBAXz2FFapa`
- `mintEnabled`: `true`
- `transferEnabled`: `true`

ABI/method map exposed by TRONSCAN includes:

- Standard TRC-20 flows: `transfer`, `transferFrom`, `approve`, `increaseAllowance`, `decreaseAllowance`
- Owner/admin flows: `mint`, `setMintEnabled`, `setTransferEnabled`, `transferOwnership`, `initialDistribute`
- Burn flows: `burn`, `burnFrom`

## Risk Assessment

### Owner Key Authority

The current owner can call privileged methods. If the owner key is compromised, the impact is high because minting and transfer toggles are admin-controlled.

Required policy:

- Owner key must not be a normal hot wallet key.
- Owner key should be moved to a multisig/governance account or custody flow.
- Owner actions must require internal approval records and public change notice for material changes.
- Owner key usage must be monitored through TRON event/transaction alerts.

### Supply Cap

The current observed ABI exposes `mint(address,uint256)` and `setMintEnabled(bool)`. No cap-specific public method was observed from the TRONSCAN method map in this review.

Required policy:

- If the deployed contract has no immutable cap enforcement, treat this as a centralization risk.
- Short term: set `mintEnabled=false` after confirming all initial distribution requirements are complete.
- Medium term: publish a supply policy that states maximum intended supply and mint authority limitations.
- Long term: if immutable cap guarantees are required, migrate or wrap governance into a capped/timelocked token architecture.

### Timelock

No timelock-specific method was observed from the TRONSCAN method map in this review.

Required policy:

- Treat privileged functions as immediate-execution owner actions until a timelock control is proven.
- Add an off-chain governance delay immediately: proposed owner action, review window, approval, execution, public notice.
- For stronger guarantees, move owner authority behind an on-chain timelock/multisig contract when feasible.

### Transfer Freeze

`setTransferEnabled(bool)` means transfer availability is administratively controlled.

Required policy:

- This must be documented as an emergency control, not ordinary discretionary control.
- Freeze usage should be limited to security incidents, legal/compliance emergencies, or migration protection.
- Any freeze should have an incident record, scope, reason, expected duration, and post-event notice.

## Recommended Remediation Track

P0:

- Confirm whether initial distribution is complete.
- If complete, execute `setMintEnabled(false)`.
- Store owner key only in cold/multisig custody.
- Add monitoring for calls to `mint`, `setMintEnabled`, `setTransferEnabled`, and `transferOwnership`.

P1:

- Publish a token authority disclosure page.
- Define an internal owner-action approval workflow.
- Document maximum intended supply and any remaining mint allocation, if any.
- Define emergency transfer freeze criteria.

P2:

- Move owner authority to multisig.
- Add timelock for `mint`, `setMintEnabled`, `setTransferEnabled`, and `transferOwnership`, if the current contract architecture supports ownership transfer to such a controller.
- If immutable cap cannot be added to the existing deployed contract, evaluate capped replacement or wrapper strategy.

## Public Explanation Draft

KORION's TRC-20 token contract is deployed on the TRON mainnet at `TBJZD8RwQ1JcQvEP9BTbPbgBCGxUjxSXnn`. The contract is verified on TRONSCAN and currently reports a total supply of `10,000,000,000 KORI`.

The contract includes owner-controlled administrative functions, including mint controls and transfer availability controls. These functions are intended for controlled ecosystem operations and emergency response, not for arbitrary or undisclosed use.

KORION recognizes that token-owner privileges must be governed transparently. The team is reviewing the authority model and will maintain a policy covering owner key custody, mint controls, transfer freeze criteria, monitoring, and public disclosure of material administrative actions.

The immediate governance direction is:

- restrict owner key access to cold or multisig-controlled custody;
- disable minting when initial distribution requirements are complete;
- monitor all privileged contract calls;
- define public criteria for any emergency transfer control;
- evaluate timelock or multisig ownership for privileged actions.

Until an immutable on-chain cap or timelock controller is proven or implemented, KORION will describe these controls as governance and custody controls rather than immutable smart-contract guarantees.

## Response To Vulnerability Report

The centralization finding is valid as a governance risk. The current contract exposes privileged owner methods and minting is currently enabled. The risk is not a direct remote exploit against user accounts, but it is material to token-holder trust because a compromised or misused owner key could affect supply or transferability.

Planned response:

- Acknowledge the finding.
- Confirm current total supply and owner authority publicly.
- Disable minting after distribution review, or publish the exact reason minting must remain enabled.
- Move owner authority to multisig/timelock where technically feasible.
- Publish a governance and emergency-control policy.

