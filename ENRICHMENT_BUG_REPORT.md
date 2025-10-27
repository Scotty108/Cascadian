# Critical Enrichment Pipeline Bugs - Full Analysis

## Executive Summary

Path B enrichment has **TWO critical bugs** causing 4,861x P&L inflation:

1. **Bug #1: Trade Duplication** - Same trades counted ~8x (8,286 trades vs 1,000 Goldsky positions)
2. **Bug #2: Inverted Outcomes** - Losing trades calculated as wins (NO positions showing +$3,826 when market resolved YES)

## Validation Results

Testing top 50 wallets from enriched ClickHouse leaderboard:

- **Average P&L Difference: 95.89%**
- **All 50 wallets: POOR match quality (>15% difference)**
- **Example**: Rank #1 wallet
  - Our enriched P&L: **$563,244**
  - Goldsky corrected P&L: **$116**
  - **Ratio: 4,861x inflation**

## Bug #1: Massive Trade Duplication

### Evidence

Wallet `0xc7f7edb333f5cbd8a3146805e21602984b852abf`:
- **Our database: 8,286 trades**
- **Goldsky: 1,000 positions**
- **Duplication factor: ~8.3x**

### Root Cause

Unknown - requires investigation of:
1. Trade syncing logic in `lib/sync/wallet-trade-sync-utils.ts`
2. ClickHouse table constraints (missing UNIQUE constraint on trade_id?)
3. Multiple sync runs inserting duplicates

### Sample Evidence

Top 10 enriched trades for wallet `0xc7f7edb333...`:
- Trades #1-3: **IDENTICAL** (same transaction hash)
- Trades #4-9: **IDENTICAL** (same transaction hash)
- Trades are being counted 3-6 times each

## Bug #2: Inverted Outcome Calculation

### Evidence

From `scripts/debug-enrichment-inflation.ts`:

```
[1] Trade: 0x39d134297838679bb5fd8d8ed12fbdea67c777...
    Side: NO, Shares: 3850.00
    Entry: $0.0060, Exit: $0.0000
    Cost: $23.10
    Outcome: 1  ← Database shows trader WON
    PnL Net: $3,826.44 (16,564.67%)

    ❓ Expected PnL (manual calc): $-23.10
    🚨 Difference: $3,849.54 (16664.7%)
```

### Analysis

Trade details:
- Wallet bought **NO** at $0.006 per share (3,850 shares = $23.10 cost)
- Market resolved to **outcome=1** (YES won, meaning NO lost)
- **Expected result**: Trader should LOSE -$23.10 (their full stake)
- **Actual enrichment**: Shows outcome=1 (won) with PnL of +$3,826

### The Math

Working backwards from enriched PnL:
```
pnl_gross = outcome === 1 ? (shares - usd_value) : -usd_value
$3,826.90 = 3,850 - $23.10
```

This means `outcome === 1` (trader won), but:
- They bet NO
- Market resolved YES (outcome=1)
- They should have LOST!

### Root Cause Location

File: `scripts/build-resolution-map-and-enrich.ts`
Lines: 216-222

```typescript
const outcome = trade.side === 'YES'
  ? (trade.resolved_outcome === 1 ? 1 : 0)
  : (trade.resolved_outcome === 0 ? 1 : 0)

const pnl_gross = outcome === 1
  ? trade.shares - trade.usd_value
  : -trade.usd_value
```

### The Bug

The outcome calculation logic **appears correct**, but the `trade.resolved_outcome` data being joined from `market_resolution_map` is either:
1. **Wrong in the resolution map** (market classified incorrectly)
2. **Corrupted during join** (wrong market matched)
3. **Inverted in interpretation** (YES/NO swapped somewhere)

## Goldsky vs Enrichment Comparison

### Goldsky (CORRECT - with 13.2399 correction):
- Total PnL: **$115.87**
- Position Count: 1,000
- Top position P&L: **$31.89**

### Our Enrichment (BROKEN):
- Total PnL: **$563,244**
- Trade Count: 8,286 (8x duplication)
- Top trade P&L: **$3,826** (inverted outcome)

## Impact

### Strategy System
All 11 strategies broken - percentile rankings will be completely wrong:
- Elite wallet criteria (top 10% Omega) will select wrong wallets
- Crowd vs elite divergence signals will be inverted
- Follow-the-whale features will track wrong traders

### Current Status
- **28,248 trades enriched** (1.24% of 2.27M total)
- **All enriched data is CORRUPTED**
- **Must fix bugs before continuing enrichment**

## Recommended Fix

### Priority 1: Fix Outcome Inversion
1. Investigate `market_resolution_map` data quality
2. Validate resolution logic in `buildResolutionMap()` (lines 76-113)
3. Check if outcomePrices interpretation is correct:
   ```typescript
   const yesPrice = parseFloat(outcomePrices[0])  // Is index 0 really YES?
   const noPrice = parseFloat(outcomePrices[1])   // Is index 1 really NO?
   ```
4. Test with known resolved markets to verify correctness

### Priority 2: Fix Trade Duplication
1. Add UNIQUE constraint on `trades_raw.trade_id`
2. Use INSERT IGNORE or UPSERT to prevent duplicates
3. Investigate why same transaction_hash appears multiple times
4. Clear and re-sync trades after fixing duplication

### Priority 3: Re-enrichment
1. **DELETE all enriched data** (pnl_gross, pnl_net, outcome values)
2. Re-run enrichment with fixes
3. Validate against Goldsky on sample wallets before full enrichment

## Validation Test

Use `scripts/validate-top-50-wallets.ts` to verify fixes:
```bash
npx tsx scripts/validate-top-50-wallets.ts
```

**Success criteria:**
- Average difference < 5%
- At least 80% of wallets show GOOD or PERFECT match quality
- No systematic inflation or deflation

## Files Involved

### Bug Source
- `scripts/build-resolution-map-and-enrich.ts` (enrichment logic)
- `lib/sync/wallet-trade-sync-utils.ts` (trade syncing, possible duplication source)

### Validation Scripts
- `scripts/validate-top-50-wallets.ts` (compare enrichment vs Goldsky)
- `scripts/debug-enrichment-inflation.ts` (detailed trade-level analysis)
- `scripts/check-enrichment-status.ts` (progress monitoring)

### Output Files
- `validation-comparison-table.json` (50 wallets comparison)
- `wallet-scores-upserts-staged.json` (DO NOT USE - data is corrupted)
- `wallet-scores-upserts-staged.sql` (DO NOT EXECUTE)

## Next Steps for User

1. **STOP Path B enrichment** - do not enrich more trades until bugs fixed
2. **Review this report** - understand both bugs
3. **Fix outcome inversion** - validate resolution map data
4. **Fix trade duplication** - add constraints and clean duplicates
5. **Clear corrupted data** - reset all enriched trades
6. **Re-run enrichment** - with fixes in place
7. **Validate again** - confirm match with Goldsky before proceeding

## Status

- ✅ Bugs identified and documented
- ✅ Validation framework in place
- ❌ Enrichment BLOCKED until bugs fixed
- ❌ Cannot proceed with wallet scoring
- ❌ Cannot use Path B data for strategies

---

Generated: 2025-10-26
Analysis by: Claude (Sonnet 4.5)
Validation script: `scripts/validate-top-50-wallets.ts`
