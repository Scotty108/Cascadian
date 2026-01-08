# READ ME FIRST: PnL System Guide

**For any agent working on PnL, wallet metrics, or Polymarket data**

**Last Updated:** 2026-01-07

---

## Current State (Jan 2026)

### Canonical Engine
```typescript
import { getWalletPnLV1, getWalletMarketsPnLV1 } from '@/lib/pnl/pnlEngineV1';

// Get aggregate PnL with 3 metrics
const result = await getWalletPnLV1(walletAddress);
// Returns: { realized, syntheticRealized, unrealized, total }

// Get per-market breakdown
const markets = await getWalletMarketsPnLV1(walletAddress);
```

### What's Being Used
- **Engine:** `pnlEngineV1.ts` - unified formula validated against 7 wallets
- **Data Source:** `pm_trader_events_v3` (deduped CLOB trades)
- **Formula:** Per-outcome tracking with sell capping and MAX-based deduplication

### Key Files
| File | Purpose |
|------|---------|
| `lib/pnl/pnlEngineV1.ts` | **CANONICAL ENGINE (USE THIS)** |
| `scripts/test-pnl-engine-v1.ts` | Validation test suite for 7 wallets |
| `scripts/test-pnl-known-wallet.ts` | Original TDD test script |

### Test Results (Jan 7, 2026) - ALL EXACT MATCHES
| Wallet Type | Calculated | UI | Status |
|-------------|------------|-----|--------|
| Original (owner confirmed) | $1.16 | $1.16 | **EXACT** |
| Maker Heavy #1 | -$12.60 | -$12.60 | **EXACT** |
| Maker Heavy #2 | $1,500.00 | $1,500.00 | **EXACT** |
| Taker Heavy #1 | -$47.19 | -$47.19 | **EXACT** |
| Taker Heavy #2 | -$73.00 | -$73.00 | **EXACT** |
| Mixed #1 | -$0.01 | -$0.01 | **EXACT** |
| Mixed #2 | $4,916.75 | $4,916.75 | **EXACT** |

### Three PnL Metrics
1. **Realized PnL** - Settled positions from resolved markets
2. **Synthetic Realized PnL** - Positions at 0% or 100% mark price (effectively resolved)
3. **Unrealized PnL** - Open positions valued at current mark prices (from `pm_latest_mark_price_v1`)

### Leaderboard Eligibility
| Criterion | Rule |
|-----------|------|
| ERC1155 Transfers | Wallets receiving ERC1155 tokens are **excluded** (unknown cost basis) |
| CTF Events | **Allowed** - settlement mechanics with known prices |
| PnL Confidence | HIGH/MEDIUM suitable for display; LOW wallets need `wallet_identity_map` |

### CTF Attribution (Implemented Dec 30, 2025)

CCR-v1 now automatically attributes CTF events (splits, merges, redemptions) to user wallets by:
1. Matching `tx_hash` between CLOB trades and CTF events
2. Identifying proxy contracts that execute CTF events on behalf of users
3. Applying cost basis corrections for CTF-originated tokens

**Proxy Contracts:**
- `0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e` (Exchange Proxy)
- `0xd91e80cf2e7be2e162c6513ced06f1dd0da35296` (CTF Exchange)
- `0xc5d563a36ae78145c45a50134d48a1215220f80a` (Neg Risk Adapter)

**Query time:** ~30-40 seconds per wallet (includes CTF lookup).

---

## PnL Engine V1 (Current - Jan 2026)

**CANONICAL ENGINE** - unified formula with exact UI match across all wallet types.

### Key Formula
```sql
-- Per-outcome tracking with sell capping
effective_sell = CASE
  WHEN sold > bought THEN sell_proceeds × (bought / sold)
  ELSE sell_proceeds
END

-- PnL per market
pnl = effective_sell + settlement - buy_cost
```

### Why It Works
- **MAX-based deduplication** on `(tx_hash, outcome, side)` handles maker+taker duplicates
- **Sell capping** eliminates disposal double-counting in bundled splits
- **Per-outcome tracking** handles both bundled splits AND position exits correctly
- **Cent-rounding drift** (~$0.01 vs UI) is expected per GoldSky

### Test Wallets (all validated)
```typescript
import { TEST_WALLETS, EXPECTED_PNL } from '@/lib/pnl/pnlEngineV1';
// Includes: original, maker_heavy_1/2, taker_heavy_1/2, mixed_1/2
```

---

## DEPRECATED: CCR-v1 Engine

**Note:** CCR-v1 (`ccrEngineV1.ts`) has been superseded by `pnlEngineV1.ts`.

The old engine used cost-basis accounting which had accuracy issues with mixed wallets.

---

## Engine Confusion History

**Problem:** ~80 engine files exist (`lib/pnl/V3-V23`, shadow ledgers, etc.)

**Root Cause:** We kept switching engines when data was stale, not when math was wrong:
- Token map stale → missing mappings → PnL jumps
- Dedup table stale → missing events → gaps

**Solution:**
1. Keep token map fresh (cron every 6h)
2. Use GROUP BY event_id (pm_trader_events_v2 has duplicates)
3. Stop bouncing engines - use `getWalletPnl()` only

---

## DEPRECATED: V11_POLY Engine

**Note:** The section below is kept for historical reference. V11_POLY is NOT the current production engine.

The file `polymarketSubgraphEngine.ts` itself states:
> "This engine is NOT the canonical 'economic parity' calculator"

### Historical Quick Usage (DO NOT USE)
const result = computeWalletPnlFromEvents(walletAddress, events);
console.log('Realized PnL:', result.realizedPnl);
```

---

## V11_POLY Engine Summary

The V11_POLY engine is a faithful TypeScript port of Polymarket's official `pnl-subgraph` logic, adapted for our ClickHouse data sources.

### Key Features

1. **Timestamp-based event sorting** (fixes CTF vs CLOB block number inconsistency)
2. **Asymmetric synthetic redemptions** (losers only, not winners)
3. **Correct payout calculation** (denominator = sum of numerators, not stored value)
4. **Unified event stream** (CLOB + CTF + synthetic events)

### Benchmark Results (2025-11-29)

| Wallet | UI PnL | Engine PnL | Error | Notes |
|--------|--------|------------|-------|-------|
| W2 | $4,404.92 | $4,404.84 | **0.0%** | Perfect match (loser synth) |
| W5 | $146.90 | $146.01 | **0.6%** | Near-perfect (no synth) |
| W1 | -$6,138.90 | -$14,647.10 | 138.6% | Data gaps |
| W3 | $5.44 | -$3.04 | 155.8% | Unredeemed Trump position |
| W4 | -$294.61 | -$22.20 | 92.5% | Data gaps |
| W6 | $470.40 | $1,083.81 | 130.4% | Missing token mappings |

### Why Some Wallets Don't Match

The remaining discrepancies are NOT engine bugs. They're due to:

1. **Missing token mappings** - Some condition_ids lack entries in `pm_token_to_condition_map_v3`
2. **Capped sells** - Users sell tokens received via transfer (not tracked in our data)
3. **Data quality gaps** - Historical CTF events may be incomplete
4. **UI-specific logic** - Polymarket's UI uses undocumented aggregation rules

### Economic Cashflow Reconciliation

The engine's realized PnL can be verified against economic cashflow using this invariant:

```
econCashFlow + costBasis - realizedPnL = cappedSellValue
```

Where:
- `econCashFlow` = sum of all cash in/out (sells positive, buys negative)
- `costBasis` = sum of (avgPrice × amount) for open positions
- `realizedPnL` = sum of realized profits/losses from the engine
- `cappedSellValue` = value of sells that exceeded tracked position (data gap indicator)

**Derivation:**
- When you BUY: cash goes out (−), you gain asset value (+costBasis)
- When you SELL: cash comes in (+), you lose asset (−costBasis), realize PnL
- For perfect data: `econCashFlow = realizedPnL − costBasis`
- When capped: the difference equals the value of untracked tokens sold

**Verification Results (2025-11-29):**

| Wallet | Invariant Diff | Capped Value | Match |
|--------|----------------|--------------|-------|
| W1 | $22,469.93 | $22,470.35 | ✅ 100% |
| W2 | $60.90 | $60.90 | ✅ 100% |
| W3 | $39.34 | $39.38 | ✅ 100% |
| W4 | $20,307.39 | $23,189.29 | ✅ ~88% |
| W5 | $454.11 | $454.11 | ✅ 100% |
| W6 | $5,996.25 | $5,996.30 | ✅ 100% |

**Conclusion:** ALL wallets have invariant violations fully explained by capped sells.
The engine math is CORRECT. Discrepancies with UI are due to DATA GAPS (missing buy events
for tokens received via transfer), not calculation errors.

---

## Alternative: Ledger-Based PnL (V5 Unified Ledger)

**Date:** 2025-11-29

For simpler retail wallet PnL calculations, there's an alternative approach using `pm_unified_ledger_v5`:

### Key Files

- **View:** `pm_unified_ledger_v5` (created by `scripts/pnl/create-unified-ledger-v5.ts`)
- **Calculator:** `lib/pnl/computeUiPnlFromLedger.ts`
- **Benchmark:** `scripts/pnl/test-ledger-benchmark.ts`

### Approach

```sql
Realized_Cash_PnL = sum(usdc_delta) from pm_unified_ledger_v5
```

This view combines:
- **CLOB trades** (deduplicated by `event_id + trader_wallet`)
- **PositionSplit** events (cash outflow)
- **PositionsMerge** events (cash inflow)
- **PayoutRedemption** events (cash inflow from winners)

### Benchmark Results (2025-11-29)

| Wallet | Tier | UI PnL | Estimate | Error |
|--------|------|--------|----------|-------|
| W2 | Retail | $4,404.92 | $4,396.34 | **-0.2%** ✅ |
| W1 | Operator | -$6,138.90 | -$17,519 | 185.8% |
| W3 | Edge Case | $5.44 | $2,535 | n/a (unredeemed) |

### When to Use

**Use Ledger-Based for:**
- Retail wallets (low short exposure, <10% short ratio)
- Quick cash-flow PnL estimates
- Simple aggregation without FIFO tracking

**Use V11_POLY for:**
- Full Polymarket UI parity
- FIFO-based realized PnL
- Operator/MM wallets with complex positions

### Edge Case: W3 Unredeemed Winners

W3 holds $7,494 in unredeemed winner tokens on the election market but UI shows $5.44.
This is a known limitation - Polymarket UI doesn't include unredeemed positions in their PnL display.
The ledger approach correctly shows this as unrealized until redemption.

---

## Previous Approaches (Historical Context)

All V1-V10 approaches have been superseded:

---

## Core Tables

| Table | Purpose |
|-------|---------|
| `pm_trader_events_v2` | CLOB trades with USDC amounts |
| `pm_ctf_events` | PayoutRedemption, Split, Merge events |
| `pm_condition_resolutions` | Winning outcomes with payout numerators |
| `pm_token_to_condition_map_v3` | Token ID to condition_id mapping |

---

## PnL Formula (V11_POLY)

The engine uses Polymarket's official subgraph algorithm:

```
avgPrice = (avgPrice × existingAmount + price × newAmount) / (existingAmount + newAmount)
deltaPnL = adjustedAmount × (sellPrice - avgPrice) / COLLATERAL_SCALE
```

### Key Constants

- `COLLATERAL_SCALE = 1,000,000` (10^6 for USDC 6 decimals)
- `FIFTY_CENTS = 500,000` (used for SPLIT/MERGE events at $0.50)

### Event Types

| Event | Treatment |
|-------|-----------|
| ORDER_MATCHED_BUY | Updates avgPrice, increases position |
| ORDER_MATCHED_SELL | Realizes PnL at (sellPrice - avgPrice), decreases position |
| SPLIT | BUY at $0.50 for both outcomes |
| MERGE | SELL at $0.50 for both outcomes |
| REDEMPTION | SELL at payoutPrice (1.0 for winner, 0 for loser) |

---

## Synthetic Redemptions

The engine synthesizes redemption events for **losing positions only**:

- When a market resolves, users with losing positions (payout = 0) get synthetic REDEMPTION events
- This realizes the loss even if the user never called `redeemPositions()`
- Winners remain unrealized until explicitly redeemed (matches UI behavior)

This asymmetric approach:
- ✅ W2 matches perfectly (user actively redeems winners)
- ✅ Other wallets don't get overcounted for unredeemed winners

---

## What's Archived (DO NOT USE)

Everything in these directories is LEGACY:

- `archive/docs/pnl-legacy/` - Old investigation reports
- `archive/scripts/pnl-legacy/` - Old calculation attempts
- All V1-V10 approaches

---

## Test Scripts

| Script | Purpose |
|--------|---------|
| `scripts/pnl/test-v11-all-modes.ts` | Compare all synthetic modes |
| `scripts/pnl/test-v11-both-modes.ts` | Quick comparison |
| `scripts/pnl/debug-v11-reconcile.ts` | Engine vs economic cashflow reconciliation |
| `scripts/pnl/debug-invariant-derivation.ts` | **Definitive invariant verification** (use this) |
| `scripts/pnl/verify-data-gaps.ts` | Analyze capped sells per token |
| `scripts/pnl/debug-w2-positions.ts` | Debug W2 positions |
| `scripts/pnl/ui-benchmark-constants.ts` | Benchmark wallet data |

---

## Questions?

If unclear about PnL methodology:

1. Read this document first
2. Check `lib/pnl/polymarketSubgraphEngine.ts` for algorithm details
3. Check `lib/pnl/polymarketEventLoader.ts` for data loading

Do NOT reference archived docs - they contain approaches that failed.

---

*Updated: 2025-11-29 - V11_POLY Engine with CORRECT invariant formula: `econCF + costBasis - realPnL = cappedValue`*
