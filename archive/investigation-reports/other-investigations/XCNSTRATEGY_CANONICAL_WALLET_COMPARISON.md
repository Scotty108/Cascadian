# xcnstrategy Canonical Wallet Comparison Report
**Date:** 2025-11-16T00:21:40.417Z
**Dome P&L Target:** $87030.51
---

## Step 1: Canonical Wallet Summary

**Canonical Wallet:** `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b`

| Metric | Value |
|--------|-------|
| Proxy Wallets | 1 |
| Proxy Addresses | 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b |
| Total Markets | 4 |
| Total Trades | 8 |
| Gross Notional | $263.00 |
| P&L Net | **$2110.16** |
| Win Rate | 100.00% |

## Step 2: P&L Breakdown by Proxy Wallet

| Wallet | Markets | Trades | P&L Net |
|--------|---------|--------|---------|
| EOA (0xcce...58b) | 4 | 8 | $2110.16 |

## Step 3: Proxy Wallet Trade Count

**Proxy Wallet (`0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723`):** ❌ ZERO trades in pm_trades

## Step 4: Gap Analysis

| Metric | Value |
|--------|-------|
| Dome P&L (Target) | $87030.51 |
| Our P&L (Canonical) | $2110.16 |
| Gap | **$84920.35** (97.58%) |

## Step 5: Root Cause Summary

### Why is P&L Missing?

**PRIMARY CAUSE:** Proxy wallet trades are NOT in our database

- ❌ Proxy wallet `0xd59...723` has **ZERO trades** in `clob_fills`
- ❌ Proxy wallet has **ZERO trades** in `pm_trades`
- ❌ Proxy wallet is missing from `wallet_identity_map` mapping
- ✅ EOA wallet `0xcce...58b` has 194 trades (only 4 markets resolved)

### Why are Proxy Trades Missing?

Based on DOME_COVERAGE_INVESTIGATION_REPORT.md:

- **14 markets** with **100 trades** are missing entirely (Category C)
- ALL 14 markets are `NOT_FOUND` in our `pm_markets`
- ALL 14 markets have 0 trades in `pm_trades` (for EOA or proxy)
- Date range: Sept 8 - Oct 15, 2025 (per Dome data)

**Possible Causes:**
1. **CLOB backfill gap:** Trades outside our backfill date range
2. **AMM trades:** Proxy traded via AMM (not CLOB), so not in `clob_fills`
3. **Attribution error:** Trades attributed to different wallet in CLOB API
4. **Missing markets:** Markets don't exist in our `pm_markets` table

### What Did Canonical Wallet Mapping Achieve?

✅ **Infrastructure in Place:**
- `pm_trades` now has `canonical_wallet_address` column
- `pm_wallet_market_pnl_resolved` groups by `canonical_wallet_address`
- `pm_wallet_pnl_summary` aggregates by `canonical_wallet_address`
- Ready to unify EOA + proxy P&L when proxy trades are ingested

❌ **Did NOT Fix Gap:**
- Gap remains $84,920 (97.58%) because proxy has 0 trades
- Canonical mapping can't aggregate what doesn't exist in the database

### Next Steps

**Immediate (Required to Close Gap):**
1. Investigate the 14 missing markets (see DOME_COVERAGE_INVESTIGATION_REPORT.md)
2. Check CLOB backfill coverage for Sept-Oct 2025 date range
3. Check AMM data sources for proxy wallet trades
4. Query Polymarket CLOB API directly for proxy wallet
5. Backfill missing trades once source is identified

**Medium Term (Proxy Mapping Improvements):**
1. Fix `wallet_identity_map` to include real proxy relationships
2. Add missing proxy mapping: EOA=0xcce...58b, Proxy=0xd59...723
3. Implement automated proxy discovery via Dome/Polymarket APIs
4. Refresh proxy mappings periodically

