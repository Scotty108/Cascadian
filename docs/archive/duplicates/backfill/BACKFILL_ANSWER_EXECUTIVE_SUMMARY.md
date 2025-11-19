# Can We Backfill from Existing ClickHouse Tables?

## Answer: NO

### The Facts

**Wallet:** `0x4ce73141dbfce41e65db3723e31059a730f0abad`
**Polymarket Claims:** 2,816 predictions
**ClickHouse Has:** 30-31 markets
**Missing:** 2,785 markets (98.9%)

### Why Not?

I systematically analyzed **148 tables** containing **1.2 billion+ rows** across your entire ClickHouse cluster.

**Key Tables Checked:**
- `erc20_transfers_staging` - 387M rows
- `vw_trades_canonical` - 157M rows
- `trade_direction_assignments` - 129M rows
- `trades_with_direction` - 82M rows
- `fact_trades_clean` - 63M rows
- `erc1155_transfers` - 291K rows

**Result:** Every table with this wallet shows the **same 30-31 markets**.

### The Smoking Gun

All the `fact_trades` tables have a `source` column showing `"VW_CANONICAL"` - meaning they were **derived from** the canonical view, not the other way around. They don't contain any additional data.

**Date Coverage:** June 2, 2024 to Nov 6, 2024 (only 5 months)

The missing 2,785 markets simply **don't exist** in ClickHouse.

---

## What To Do Instead

### Recommended: Polymarket API Backfill (Option C - Hybrid)

**Step 1: Query API for wallet positions**
```bash
curl https://clob.polymarket.com/positions?wallet=0x4ce73141dbfce41e65db3723e31059a730f0abad \
  -H "Authorization: Bearer ${CLOB_API_KEY}"
```

Expected: ~2,816 markets with full trade history

**Step 2: Create API backfill table**
```sql
CREATE TABLE default.api_wallet_positions (
  wallet String,
  market_id String,
  condition_id String,
  outcome_index Int32,
  shares Decimal(18,8),
  avg_entry_price Decimal(18,8),
  unrealized_pnl Decimal(18,2),
  last_updated DateTime,
  source String DEFAULT 'API_BACKFILL'
) ENGINE = ReplacingMergeTree()
ORDER BY (wallet, condition_id, outcome_index)
```

**Step 3: Insert API data**
- Map market slugs → condition_ids using existing `condition_market_map` table
- Normalize wallet addresses
- Store with proper source attribution

**Step 4: Merge with canonical view**
```sql
CREATE OR REPLACE VIEW default.vw_trades_complete AS
SELECT * FROM default.vw_trades_canonical
UNION ALL
SELECT
  generateUUIDv4() as trade_key,
  -- Map API positions to canonical schema...
FROM default.api_wallet_positions
WHERE (wallet, condition_id) NOT IN (
  SELECT wallet_address_norm, condition_id_norm
  FROM default.vw_trades_canonical
)
```

**Estimated Time:** 2-4 hours

**Expected Outcome:**
- Complete coverage: 2,816 markets
- Full trade history: 2020-2025
- Ready for PnL calculations

---

## Alternative Options

### Option A: API Only (Fast)
- Query Polymarket API
- Insert directly into ClickHouse
- **Time:** 1-2 hours
- **Completeness:** High
- **Verification:** None

### Option B: Blockchain Reconstruction (Slow)
- Query Polygon blockchain for all ERC1155 transfers since 2020
- Decode and map to trades
- **Time:** 8-24 hours
- **Completeness:** High
- **Cost:** High (RPC credits)
- **Verification:** Native (on-chain)

---

## Why We're Missing Data

**Most Likely Reason:** Incomplete historical backfill

Your ClickHouse database only contains trades from **June 2024 onward**. If this wallet has been trading since Polymarket launched in 2020, you're missing **4+ years** of history.

**Evidence:**
- 31 markets in 5 months ≈ 6.2 markets/month
- To accumulate 2,816 markets at this rate would take **454 months = 38 years**
- Obviously impossible → wallet was much more active in earlier periods

---

## Detailed Investigation

For complete findings, see:
- **Full Report:** `/Users/scotty/Projects/Cascadian-app/BACKFILL_INVESTIGATION_FINAL_REPORT.md`
- **Raw Data:** `/Users/scotty/Projects/Cascadian-app/BACKFILL_INVESTIGATION_DATA.json`
- **Table Inventory:** All 148 tables documented with schemas, row counts, and coverage analysis

---

## Next Steps

1. ✅ **Query Polymarket API** for wallet positions (start here)
2. ✅ **Create backfill table** in ClickHouse
3. ✅ **Map API data** to condition_ids
4. ✅ **Insert and validate** - should get ~2,816 markets
5. ✅ **Merge with canonical view** for complete coverage
6. ✅ **Rebuild PnL** calculations with full data

**Bottom Line:** You need external API. The data isn't in ClickHouse.

---

**Investigation Date:** 2025-11-10
**Tables Analyzed:** 148
**Rows Scanned:** 1.2B+
**Conclusion:** EXTERNAL API REQUIRED
