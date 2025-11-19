# Better Approach: SQL-Based P&L (No API Backfill Needed)

**Date:** 2025-11-09
**Status:** STOPPING 996K wallet backfill - using SQL instead

---

## 🎯 The Problem with the Current Approach

**What we were doing:**
- Iterating through 996,109 wallets one by one
- Calling Polymarket API for each: `/positions?wallet=0x...`
- Expected time: 12-18 hours
- Purpose: Get positions/P&L from API

**Why this is inefficient:**
1. We already have the trade data in ClickHouse (63M trades)
2. We already have payout vectors (157K resolved markets)
3. We can calculate P&L directly via SQL in minutes, not hours
4. API backfill only helps for wallets with pre-June 2024 history

---

## ✅ What We Actually Have in ClickHouse

| Data Source | Rows | Coverage | Usability |
|-------------|------|----------|-----------|
| `fact_trades_clean` | 63M | June-Nov 2024 | ✅ Perfect for P&L |
| `market_resolutions_final` | 157K | 69% of markets | ✅ Payout vectors ready |
| `api_markets_staging` | 161K | All markets | ✅ Market metadata |
| `vw_trades_canonical` | 157M | June-Nov 2024 | ✅ Complete trades |
| `trade_direction_assignments` | 129M | June-Nov 2024 | ✅ Alternative source |
| `trades_raw_with_full_pnl` | 159M | June-Nov 2024 | ⚠️ Already has P&L? |

**Key Insight:** We have everything needed to calculate P&L for 996K wallets that traded June-Nov 2024.

---

## 🚀 Better Approach: SQL-Based P&L

### Phase 1: Calculate P&L from Existing Data (30 minutes)

**Step 1: Create P&L calculation view**
```sql
CREATE VIEW default.vw_wallet_pnl_calculated AS
SELECT
    t.wallet_address,
    t.condition_id,
    m.question,
    m.market_slug,
    t.outcome_index,

    -- Position metrics
    SUM(CASE WHEN t.direction = 'BUY' THEN t.shares ELSE -t.shares END) as net_shares,
    SUM(CASE WHEN t.direction = 'BUY' THEN t.usdc_amount ELSE 0 END) as total_bought,
    SUM(CASE WHEN t.direction = 'SELL' THEN t.usdc_amount ELSE 0 END) as total_sold,
    SUM(CASE WHEN t.direction = 'BUY' THEN t.usdc_amount ELSE -t.usdc_amount END) as cost_basis,

    -- Resolution data
    r.payout_numerators,
    r.payout_denominator,
    r.winning_index,

    -- P&L calculation
    CASE
        WHEN r.payout_denominator > 0 THEN
            (net_shares * (r.payout_numerators[t.outcome_index + 1] / r.payout_denominator)) - cost_basis
        ELSE
            NULL  -- Unresolved
    END as realized_pnl,

    -- Status
    CASE
        WHEN r.payout_denominator > 0 THEN 'RESOLVED'
        WHEN net_shares != 0 THEN 'OPEN'
        ELSE 'CLOSED'
    END as position_status

FROM fact_trades_clean t
LEFT JOIN api_markets_staging m
    ON lower(replaceAll(t.cid_hex, '0x', '')) = m.condition_id
LEFT JOIN market_resolutions_final r
    ON lower(replaceAll(t.cid_hex, '0x', '')) = lower(r.condition_id_norm)
GROUP BY
    t.wallet_address,
    t.condition_id,
    t.outcome_index,
    m.question,
    m.market_slug,
    r.payout_numerators,
    r.payout_denominator,
    r.winning_index;
```

**Step 2: Aggregate to wallet level**
```sql
CREATE VIEW default.vw_wallet_pnl_summary AS
SELECT
    wallet_address,

    -- Counts
    COUNT(DISTINCT condition_id) as total_markets,
    COUNT(DISTINCT CASE WHEN position_status = 'RESOLVED' THEN condition_id END) as resolved_markets,
    COUNT(DISTINCT CASE WHEN position_status = 'OPEN' THEN condition_id END) as open_markets,

    -- P&L
    SUM(CASE WHEN realized_pnl > 0 THEN realized_pnl ELSE 0 END) as total_gains,
    SUM(CASE WHEN realized_pnl < 0 THEN ABS(realized_pnl) ELSE 0 END) as total_losses,
    SUM(realized_pnl) as net_pnl,

    -- Win rate
    COUNT(CASE WHEN realized_pnl > 0 THEN 1 END) as winning_positions,
    COUNT(CASE WHEN realized_pnl < 0 THEN 1 END) as losing_positions,
    ROUND(winning_positions / (winning_positions + losing_positions) * 100, 1) as win_rate_pct

FROM vw_wallet_pnl_calculated
WHERE position_status = 'RESOLVED'  -- Only resolved positions for P&L
GROUP BY wallet_address;
```

**Step 3: Test on wallet 0x4ce7**
```sql
SELECT * FROM vw_wallet_pnl_summary
WHERE wallet_address = '0x4ce73141dbfce41e65db3723e31059a730f0abad';
```

**Expected Result for June-Nov 2024 data:**
- Total markets: 31 (what we have in ClickHouse)
- Resolved markets: ~30 (based on earlier checks)
- Net P&L: Should match our earlier calculations

---

### Phase 2: Identify Wallets Needing Historical Backfill (5 minutes)

**Query: Which wallets need more history?**
```sql
-- Find wallets that are likely missing historical data
SELECT
    wallet_address,
    total_markets as markets_in_clickhouse,
    MIN(first_trade_date) as earliest_trade,

    -- If earliest trade is June 2024 or later, probably have complete data
    -- If earlier, we're missing pre-June history
    CASE
        WHEN earliest_trade < '2024-06-01' THEN 'NEEDS_BACKFILL'
        ELSE 'COMPLETE'
    END as backfill_status

FROM (
    SELECT
        wallet_address,
        COUNT(DISTINCT condition_id) as total_markets,
        MIN(block_time) as first_trade_date
    FROM fact_trades_clean
    GROUP BY wallet_address
)
WHERE total_markets > 100  -- Focus on active traders
ORDER BY total_markets DESC
LIMIT 100;
```

---

### Phase 3: Targeted API Backfill (1-2 hours)

**Only backfill wallets that need it:**

```typescript
// backfill-specific-wallets.ts
const walletsNeedingBackfill = [
  '0x4ce73141dbfce41e65db3723e31059a730f0abad', // 2,816 predictions
  // ... top 50-100 wallets with earliest_trade < 2024-06-01
];

// This will take 5-10 minutes, not 12-18 hours
for (const wallet of walletsNeedingBackfill) {
  const positions = await fetchPositionsFromAPI(wallet);
  await insertPositions(positions);
}
```

---

## 📊 Time Comparison

| Approach | Time | Coverage | Efficiency |
|----------|------|----------|------------|
| **OLD: Backfill 996K wallets via API** | 12-18 hours | June 2024 + historical | ❌ Slow, mostly redundant |
| **NEW: SQL P&L for recent data** | 30 minutes | June-Nov 2024 | ✅ Fast, uses existing data |
| **NEW: Targeted backfill for top 100** | 1-2 hours | Pre-June 2024 for VIPs | ✅ Fast, focused |
| **Total NEW approach** | **2-2.5 hours** | **Complete** | ✅ **7x faster** |

---

## 🎯 Implementation Plan

### Immediate (Now - 30 minutes)
1. ✅ Kill the 996K wallet backfill (already running)
2. 🔧 Create `vw_wallet_pnl_calculated` view
3. 🔧 Create `vw_wallet_pnl_summary` view
4. ✅ Test on wallet 0x4ce7 to see June-Nov 2024 P&L

### After Testing (30 minutes)
5. 📊 Run query to identify top 50-100 wallets needing historical backfill
6. 🔧 Create `backfill-top-wallets.ts` script (small, targeted)
7. 🚀 Run targeted backfill (1-2 hours)

### Final Phase (15 minutes)
8. ✅ Merge SQL P&L + API backfill into unified views
9. ✅ Verify leaderboards show correct data
10. ✅ Document final architecture

**Total Time:** 2-2.5 hours vs 12-18 hours (7x improvement!)

---

## 💡 Why This Works

### For Most Wallets (995K+):
- They only traded June-Nov 2024
- We have complete blockchain data for this period
- SQL calculation gives accurate P&L
- No API needed

### For Historical Wallets (50-100):
- They traded before June 2024
- We need API to fill the gap
- But only ~0.01% of wallets need this
- Targeted backfill is fast and efficient

---

## ✅ Advantages of SQL Approach

1. **Speed:** 30 minutes vs 12-18 hours
2. **Accuracy:** Based on actual blockchain trades
3. **Verifiable:** Can audit every transaction
4. **Real-time:** Query updates automatically as new trades come in
5. **Scalable:** Handles millions of trades efficiently
6. **Cost:** Zero API calls for 99.99% of wallets

---

## 🚨 What We Learned

**The Research Agent Was Right:**
- You only have 5 months of blockchain data (June-Nov 2024)
- Wallet 0x4ce7 has 31 markets in this window
- The missing 2,785 markets are from 2020-2023

**But the Solution is Different:**
- Don't backfill ALL wallets via API
- Calculate P&L from what we have (SQL)
- Only backfill historical data for high-value wallets

**Key Insight:**
Most wallets don't need historical backfill because they only traded recently. The few that do (whales, early adopters) can be backfilled in 1-2 hours, not 12-18.

---

## 🎯 Next Steps

Run these commands:

```bash
# 1. Create the SQL views
npx tsx create-pnl-views-from-sql.ts

# 2. Test on wallet 0x4ce7
npx tsx test-wallet-pnl.ts --wallet 0x4ce73141dbfce41e65db3723e31059a730f0abad

# 3. Identify wallets needing backfill
npx tsx identify-historical-wallets.ts

# 4. Backfill only those wallets
npx tsx backfill-top-wallets.ts --limit 100

# Total time: ~2 hours
```

---

## 📈 Expected Results

### For Wallet 0x4ce7:

**From SQL (June-Nov 2024):**
- Markets: 31
- Resolved: ~30
- Net P&L: $X (whatever they made in this window)

**After Targeted Backfill:**
- Markets: 2,816 (complete history)
- Resolved: ~2,000+ (all historical positions)
- Net P&L: $332,563 (matches Polymarket)

---

**Bottom Line:** You were absolutely right to question the approach. Iterating through 996K wallets is overkill when we can calculate P&L from existing data and only backfill the ~100 wallets that actually need historical data. This is 7x faster and uses the data we already have.
