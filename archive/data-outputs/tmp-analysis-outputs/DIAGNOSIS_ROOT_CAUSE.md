# P&L Calculation Root Cause Analysis

**Wallet Investigated:** 0x1699e13609a154eabe8234ff078f1000ea5980e2

## Ground Truth (Polymarket UI)
- **P&L:** -$14,009.48 (LOSS)
- **Volume:** $1,655,178.61
- **Closed trades:** ~70

## Our Calculation
- **P&L:** +$99,914.99 (PROFIT) ❌
- **Volume:** $105,868 ❌
- **Markets:** 30 ❌

## Discrepancies
- **Sign flip:** Showing profit instead of loss
- **Magnitude:** 7x off ($100K vs $14K)
- **Volume:** Missing 94% ($105K vs $1.66M)
- **Trades:** Missing 57% (30 vs 70)

---

## Investigation Results

### ✅ CLOB → Cashflows Transformation: WORKING
```
CLOB fills table:       33 fills, 30 conditions, $105,868 volume
trade_cashflows_v3:     33 flows, 30 markets,    $105,868 volume
```
**Coverage: 100%** - No data loss in transformation

### ❌ CLOB Data Ingestion: INCOMPLETE
```
CLOB fills:       33 fills
Polymarket UI:    ~70 trades
Missing:          37 trades (53%)

CLOB volume:      $105,868
Polymarket volume: $1,655,178
Missing:          $1,549,310 (93.6%)
```

---

## Root Cause

**The CLOB ingestion pipeline is only capturing ~50% of this wallet's trades.**

### Possible Causes:
1. **Proxy wallet resolution incomplete** - Wallet may trade through multiple proxies not mapped
2. **Time range gaps** - Backfill may not cover full history
3. **CLOB API pagination issues** - May have stopped early
4. **Filtering logic** - May be excluding valid trades

### Secondary Issues:
1. **P&L formula sign error** - Once we get full data, formula still needs fixing (showing +$100K instead of -$14K)
2. **Unrealized P&L contamination** - May be including open positions

---

## Next Steps

### Priority 1: Fix CLOB Ingestion (High Impact)
- [ ] Check proxy wallet mapping for 0x1699e13609a154eabe8234ff078f1000ea5980e2
- [ ] Verify CLOB backfill time range covers all trades
- [ ] Check CLOB API pagination limits
- [ ] Compare against Dome API for missing fill IDs

### Priority 2: Fix P&L Formula (After data is complete)
- [ ] Investigate sign flip (showing profit instead of loss)
- [ ] Verify cost basis calculation
- [ ] Ensure only counting resolved markets
- [ ] Validate against more wallets

---

## Validation Strategy

1. **Fix CLOB ingestion first** - Get to 70 fills
2. **Rerun P&L calculation** - Should now be closer to -$14K
3. **Compare against Dome API** - Validate 100 random wallets
4. **Measure accuracy** - Target: 95% within 2% error

---

## Technical Details

### Working Tables:
- `clob_fills` - Has 33 fills (incomplete)
- `trade_cashflows_v3` - Has 33 flows (correctly derived from incomplete CLOB)
- `realized_pnl_by_market_final` - Has 30 markets (correctly derived)

### CLOB Schema:
```sql
fill_id, proxy_wallet, user_eoa, market_slug, condition_id, asset_id,
outcome, side, price, size, fee_rate_bps, timestamp, order_hash, tx_hash
```

### Query for This Wallet:
```sql
SELECT * FROM clob_fills
WHERE proxy_wallet = '0x1699e13609a154eabe8234ff078f1000ea5980e2'
   OR user_eoa = '0x1699e13609a154eabe8234ff078f1000ea5980e2'
```

---

**Diagnosis Date:** 2025-11-11
**Analyst:** Claude-3.7-sonnet
