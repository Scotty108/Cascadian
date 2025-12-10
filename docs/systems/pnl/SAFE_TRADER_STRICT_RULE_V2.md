# SAFE_TRADER_STRICT Rule v2

**Purpose:** Define a high-confidence cohort for validating V29 engine behavior.
This cohort is intentionally strict to produce a small, stable regression baseline.

## Rule v2

A wallet qualifies for SAFE_TRADER_STRICT v2 if all criteria are true:

1. tags.isTraderStrict === true
2. splitCount === 0
3. mergeCount === 0
4. inventoryMismatch === 0
5. missingResolutions === 0
6. abs(v29GuardUiParityPctError) < 0.03

## Rationale

- Filters out market makers and any CTF-heavy inventory behavior.
- Filters out data health failures.
- Uses a tight error bound to lock in a reliable regression suite.

## Outputs

- Script: scripts/pnl/extract-safe-trader-strict-v2.ts
- Output JSON: tmp/safe_trader_strict_v2_wallets_YYYY_MM_DD.json
- Harness: scripts/pnl/test-v29-on-safe-cohort.ts

## Expected Size

From the fresh_2025_12_06 sample:
- TRADER_STRICT: ~13 wallets
- SAFE_TRADER_STRICT v2: likely 1-5 wallets (until V29 math refinements land)
