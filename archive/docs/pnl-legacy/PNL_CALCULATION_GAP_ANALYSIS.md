# PnL Calculation Gap Analysis

**Date:** 2025-11-28
**Status:** Investigation Complete - Data Gaps Identified

## Executive Summary

We cannot accurately calculate realized PnL matching Polymarket's API using only our current database tables. The main issue is that **CTF minting events are not attributed to individual user wallets** - they go through the Exchange contract.

## W1 Wallet Test Case

| Source | Realized PnL | Notes |
|--------|-------------|-------|
| **Polymarket API** | +$12,298.89 | Official number from UI |
| **Archive (pm_user_positions)** | -$6,138.89 | Missing sells, incomplete data |
| **Our CLOB Calculation** | -$17,543.75 | Missing CTF minting costs |

**Gap:** $29,842 between CLOB calc and API

## Root Cause Analysis

### The Poland Market Example

W1's Poland market position (`5ce0d897bd66142c...`):

```
CLOB Data Shows:
- Outcome 0 (Yes - WON): Sold 24,135 tokens for $6,142 (no buys!)
- Outcome 1 (No - LOST): Bought 38,485 for $27,182, Sold 35,485 for $12,033

Net shares from CLOB:
- Outcome 0: -24,135 (sold without buying = acquired elsewhere)
- Outcome 1: +2,999 (net long)
```

### The Missing Piece: CTF Minting

When you sell tokens you never bought on CLOB, you must have **minted them** through the CTF (Conditional Tokens Framework):

1. User deposits $24,135 USDC to Exchange
2. Exchange calls CTF to mint 24,135 complete sets (Yes + No tokens)
3. User sells Yes tokens on CLOB for $6,142
4. User keeps No tokens

**Problem:** The PositionSplit event shows `user_address = Exchange contract`, not the actual user wallet.

### Data in pm_ctf_events

```
Event Distribution:
- Exchange | PositionSplit: 36,506,296 events
- Exchange | PositionsMerge: 12,656,711 events
- Exchange | PayoutRedemption: 5,017,541 events
- User | PositionSplit: 39,427,013 events (direct wallet minting)
- User | PayoutRedemption: 14,411,693 events
```

Only direct wallet interactions are attributed to user wallets. Exchange-mediated mints are NOT linked to users.

### Archive Data Quality Issues

The `pm_archive.pm_user_positions` table is incomplete:

```
W1 Archive Summary:
- Total Bought: $149,756.71
- Total Sold: $0.00 (SHOULD NOT BE ZERO!)
- Size: 0 for all positions
- Outcome: undefined
```

The archive is **not capturing sell activity** and has other data quality issues.

## What We Need

To accurately calculate PnL, we need ONE of these:

### Option 1: Polymarket API (Recommended)

Fetch realized PnL directly from `https://data-api.polymarket.com/profit-loss`:

```typescript
const response = await fetch(`https://data-api.polymarket.com/profit-loss?address=${wallet}`);
const data = await response.json();
// data.realizedPnl contains the accurate value
```

**Pros:** Accurate, official, already calculated
**Cons:** Rate limits, dependency on external API

### Option 2: ERC1155 Transfer Reconstruction

Index all ERC1155 transfers to/from user wallets to track token acquisition:

```sql
-- Need to create this table or source from Goldsky
CREATE TABLE pm_erc1155_transfers (
  from_address String,
  to_address String,
  token_id String,
  amount UInt256,
  tx_hash String,
  block_number UInt64,
  ...
)
```

Then reconstruct: `acquired_tokens = transfers_in - transfers_out + clob_buys - clob_sells`

**Pros:** Complete on-chain data
**Cons:** Need new data pipeline, complex reconstruction

### Option 3: Fix Archive Ingestion

Work with Goldsky to ensure archive data includes:
- Sell activity (total_sold)
- Position sizes
- Outcome information

**Pros:** Uses existing infrastructure
**Cons:** Depends on upstream data source

## Current Formula (CLOB-Only)

This formula is **mathematically correct** but produces wrong results because it can't see CTF minting:

```sql
WITH deduped AS (
  SELECT
    event_id,
    any(token_id) as token_id,
    any(side) as side,
    any(usdc_amount)/1e6 as usdc,
    any(token_amount)/1e6 as tokens
  FROM pm_trader_events_v2
  WHERE trader_wallet = :wallet AND is_deleted = 0
  GROUP BY event_id
),
by_outcome AS (
  SELECT
    condition_id,
    outcome_index,
    SUM(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as net_shares,
    SUM(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as net_cash
  FROM deduped d
  JOIN pm_token_to_condition_map_v3 m ON toString(d.token_id) = toString(m.token_id_dec)
  GROUP BY condition_id, outcome_index
),
with_resolution AS (
  SELECT
    b.*,
    r.payout_numerators
  FROM by_outcome b
  LEFT JOIN pm_condition_resolutions r ON lower(b.condition_id) = lower(r.condition_id)
)
SELECT
  SUM(net_cash + net_shares * JSON_EXTRACT(payout_numerators, outcome_index)) as realized_pnl
FROM with_resolution
WHERE payout_numerators IS NOT NULL
```

**Issue:** Negative net_shares means "sold without buying on CLOB" which implies CTF minting cost that we can't see.

## Solution: ERC1155 Transfer Migration

**UPDATE (Session 7):** We found an old ClickHouse database with the missing `erc1155_transfers` table:

- **Source:** `igm38nvzub.us-central1.gcp.clickhouse.cloud`
- **Table:** `erc1155_transfers` (61M rows)
- **Schema:**
  - `tx_hash`, `log_index`, `block_number`, `block_timestamp`
  - `contract`, `token_id`, `from_address`, `to_address`, `value`, `operator`

### Migration Status

**Migration script:** `/scripts/pnl/migrate-erc1155-transfers.ts`
- 4 parallel workers
- Checkpoint protection for crash recovery
- Target table: `pm_erc1155_transfers` (new database)

**Key Data Points:**
- Total transfers: 61,379,951
- Block range: 37,000,001 to 78,876,523
- Mints (from 0x0): 16,156,891
- Burns (to 0x0): 6,583,460
- Exchange contract transfers: 12,922,758

### Key Addresses

| Address | Role |
|---------|------|
| `0x4d97dcd97ec945f40cf65f87097ace5ea0476045` | CTF Contract |
| `0xd91e80cf2e7be2e162c6513ced06f1dd0da35296` | Exchange Contract |
| `0x0000000000000000000000000000000000000000` | Zero (mint source/burn dest) |

## Next Steps

1. **In Progress:** ERC1155 migration (~2-3 hours)
2. **Pending:** Build unified PnL view combining CLOB + ERC1155 + CTF + Resolutions
3. **Pending:** Validate against Polymarket API for W1

## Files Created

- `/scripts/pnl/calculate-w1-market-pnl.ts` - Market-level PnL calculation
- `/scripts/pnl/analyze-archive-coverage.ts` - Archive vs CLOB comparison
- `/scripts/pnl/compare-clob-archive-pnl.ts` - Token-level PnL comparison
- `/scripts/pnl/compare-clob-vs-archive.ts` - Full market comparison
- `/scripts/pnl/migrate-erc1155-transfers.ts` - ERC1155 migration script
- `/scripts/pnl/pnl-engine-unified-spec.md` - PnL engine design spec

---

*Signed: Claude Code Terminal - Session 6/7*
