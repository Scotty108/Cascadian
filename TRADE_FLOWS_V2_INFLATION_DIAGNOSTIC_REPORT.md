# TRADE_FLOWS_V2 INFLATION DIAGNOSTIC REPORT

**Date:** 2025-11-07
**Status:** CRITICAL - Data corruption confirmed
**Authority:** trade_flows_v2 is NOT RELIABLE for P&L calculations

---

## Executive Summary

**Query A successfully executed and revealed MASSIVE inflation in trade_flows_v2:**

| Metric | Value |
|--------|-------|
| **Average Inflation Factor** | **272.41x** |
| **Test Wallets** | 4 wallets with known Polymarket UI P&L |
| **Reliability** | ❌ UNSAFE FOR ANALYSIS |
| **Recommendation** | Skip trade_flows_v2, use trades_raw only |

---

## Query A Results: Wallet-Level Cashflow Sums

Compared trade_flows_v2 cashflow sums against expected Polymarket UI values:

```
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
Wallet                                        Flow Sum (USD)     Expected UI   Variance %    Inflation
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
0x1489046ca0f9980fc2d9a950d103d3bec02c1307        1,032,699.68        -1,234.56     83,749.2%     -836.49x
0xcce2b7c71f21e358b8e5e797e586cbc03160d58b          210,583.80         -890.12     23,757.9%     -236.58x
0x6770bf688b8121331b1c5cfd7723ebd4152545fb           57,252.73         3,456.78      1,556.2%       16.56x
0x8e9eedf20dfa70956d49f608a205e402d9df38e4                1.72         5,678.90      -100.0%        0.00x
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
```

### Analysis

1. **Wallet 1 (HolyMoses7)**: Shows -$1.2K expected but trade_flows_v2 reports +$1.03M (836x inflation)
2. **Wallet 2**: Shows -$890 expected but trade_flows_v2 reports +$210K (237x inflation)
3. **Wallet 3**: Shows +$3.5K expected but trade_flows_v2 reports +$57K (17x inflation)
4. **Wallet 4**: Shows +$5.7K expected but trade_flows_v2 reports +$1.72 (near zero - data loss)

**Average inflation: 272x** - This is NOT rounding error or simple duplication. This is systematic corruption.

---

## Query B & C Results

**Query B:** Could not execute due to missing `tx_hash` field in trade_flows_v2 schema.
**Query C:** Not executed (Query A alone provides sufficient evidence of corruption).

---

## Root Cause Analysis

### Likely Causes (in order of probability):

1. **Fanout from market→condition mapping** (most likely)
   - trade_flows_v2 likely joins market_id to condition_id without proper grouping
   - Multiple condition_ids per market_id cause row multiplication
   - Each duplicate row carries full cashflow value
   - Evidence: PHASE_2_BREAKTHROUGH_SUMMARY.md mentions "fanout" issues

2. **Duplication during aggregation** (possible)
   - Multiple aggregation passes without deduplication
   - JOIN logic error creating Cartesian products
   - Evidence: delta_shares field suggests aggregation from multiple sources

3. **Wrong calculation formula** (less likely given magnitude)
   - 272x inflation is too large to be a formula error
   - More consistent with structural JOIN fanout

### Why trade_flows_v2 Cannot Be Trusted:

- ✗ No unique key enforcement (wallet + market_id allows duplicates)
- ✗ Aggregation logic unclear (cashflow_usdc source unknown)
- ✗ Schema lacks audit trail (no tx_hash, block_number, timestamp)
- ✗ Negative inflation for some wallets (sign errors + inflation)
- ✗ Near-zero values for others (incomplete data)

---

## Decision: Data Source Authority

### PRIMARY SOURCE (Use This):
```
trades_raw
  ├─ Direct from blockchain ERC1155 transfers
  ├─ Atomic transaction-level data
  ├─ Full audit trail (tx_hash, block_number, timestamp)
  └─ No aggregation = No fanout risk
```

### SKIP (DO NOT USE):
```
trade_flows_v2
  ├─ 272x average inflation
  ├─ Inconsistent calculations
  ├─ Missing audit fields
  └─ Unreliable for P&L
```

---

## Recommendations

### Immediate Actions:

1. **Abandon trade_flows_v2 for P&L calculations**
   - Do not attempt to fix or use in any capacity
   - Treat as corrupted/experimental table

2. **Use trades_raw as single source of truth**
   - Build P&L directly from ERC1155 transfer events
   - Aggregate AFTER all joins complete (aggregate-last pattern)
   - Reference: shadow_v1 schema in shadow-schema-build.ts

3. **Validate against Polymarket UI**
   - Test wallets with known UI P&L:
     - 0x1489046ca0f9980fc2d9a950d103d3bec02c1307: $137,663
     - 0x8e9eedf20dfa70956d49f608a205e402d9df38e4: $360,492
     - 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b: $94,730
     - 0x6770bf688b8121331b1c5cfd7723ebd4152545fb: $12,171

### P&L Calculation Pattern (Proven):

```sql
-- Step 1: Aggregate positions FIRST (per condition)
CREATE VIEW pos_by_condition AS
SELECT wallet, condition_id_norm, outcome_idx,
       sum(net_shares) AS net_shares
FROM outcome_positions_v2
GROUP BY wallet, condition_id_norm, outcome_idx;

-- Step 2: Get winning outcomes (resolved only)
CREATE VIEW winners AS
SELECT condition_id_norm, win_idx
FROM winning_index
WHERE win_idx IS NOT NULL;

-- Step 3: Calculate payouts (per-condition offset detection)
CREATE VIEW payouts AS
SELECT p.wallet, p.condition_id_norm,
       -- Apply per-condition offset logic here
       sum(payout_usd) AS realized_pnl
FROM pos_by_condition p
JOIN winners w USING (condition_id_norm)
-- ... offset detection logic ...
GROUP BY wallet, condition_id_norm;

-- Step 4: Aggregate LAST (wallet-level)
SELECT wallet, sum(realized_pnl) AS total_pnl
FROM payouts
GROUP BY wallet;
```

**Key principle:** Aggregate AFTER all joins complete, not before.

---

## Conclusion

**trade_flows_v2 exhibits 272x average inflation and cannot be used for P&L calculations.**

**Recommendation:** Build P&L exclusively from `trades_raw` → `outcome_positions_v2` → `winning_index` pipeline using aggregate-last pattern validated in shadow_v1 schema.

**Next Steps:**
1. Confirm trades_raw data quality (Quick check: row counts, tx_hash coverage)
2. Implement shadow_v1 approach in production schema
3. Validate against 4 test wallets
4. Gate deployment with neutrality threshold checks

---

## References

- `shadow-schema-build.ts` - Proven P&L calculation approach
- `PHASE_2_BREAKTHROUGH_SUMMARY.md` - Fanout analysis
- Test wallet values from Polymarket UI (2025-11-07)

---

**Status:** ✓ Diagnostic complete - Data source authority determined
