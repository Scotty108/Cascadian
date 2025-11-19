# PROPER DATABASE ARCHITECTURE - Star Schema Design

**Date:** November 10, 2025
**Purpose:** Define ONE source of truth for each data type

---

## 🎯 THE PROBLEM

You currently have:
- **5 different trade tables** (157M, 130M, 82M, 63M, 35M rows)
- **Unclear relationships** (which joins to which?)
- **Broken data** (condition IDs all 0x0000...)
- **No single source of truth**

You're right: **This is unusable.**

---

## ✅ THE SOLUTION - Star Schema

```
              ┌─────────────────────────┐
              │   FACT_TRADES           │ ← ONE CANONICAL FACT TABLE
              │   (130M+ rows)          │
              ├─────────────────────────┤
              │ trade_id (PK)           │
              │ wallet_address          │───┐
              │ condition_id_norm       │───┼───┐
              │ timestamp               │   │   │
              │ direction (BUY/SELL)    │   │   │
              │ outcome_index           │   │   │
              │ shares                  │   │   │
              │ price                   │   │   │
              │ usd_value               │   │   │
              │ tx_hash                 │   │   │
              │ source                  │   │   │
              └─────────────────────────┘   │   │
                                            │   │
         ┌──────────────────────────────────┘   │
         │                                      │
         ▼                                      ▼
┌─────────────────────┐              ┌─────────────────────┐
│ DIM_WALLETS         │              │ DIM_MARKETS         │
│ (996K rows)         │              │ (233K rows)         │
├─────────────────────┤              ├─────────────────────┤
│ wallet_address (PK) │              │ condition_id (PK)   │
│ wallet_type         │              │ market_id           │
│ first_trade_date    │              │ question            │
│ total_trades        │              │ category            │
│ total_volume        │              │ outcomes[]          │
│ pnl_total           │              │ created_at          │
└─────────────────────┘              │ closed_at           │
                                     └─────────────────────┘
                                              │
                                              │
                                              ▼
                                     ┌─────────────────────┐
                                     │ DIM_RESOLUTIONS     │
                                     │ (157K rows)         │
                                     ├─────────────────────┤
                                     │ condition_id (PK)   │
                                     │ winning_index       │
                                     │ payout_numerators[] │
                                     │ payout_denominator  │
                                     │ resolved_at         │
                                     │ winning_outcome     │
                                     └─────────────────────┘
```

---

## 📊 GROUND TRUTH - Source Data (DON'T TOUCH)

### 1. **Raw Blockchain Data** (Immutable)

| Table | Rows | Purpose | Status |
|-------|------|---------|--------|
| **erc20_transfers_staging** | 388M | Raw USDC movements | ✅ Complete |
| **erc1155_transfers** | 291K | Raw conditional token movements | ❌ 2.9% complete |

**Relationship:**
```
One trade = 2 ERC20 transfers + 1 ERC1155 transfer
  - ERC20 transfer #1: Wallet → Exchange (USDC out)
  - ERC20 transfer #2: Exchange → Wallet (USDC in) OR vice versa
  - ERC1155 transfer: Outcome token movement (tells us WHICH market)
```

**Why 388M USDC transfers becomes ~130M trades:**
- Each trade generates 2-4 USDC transfer events (maker, taker, fees)
- Group by tx_hash to get atomic trades
- 388M / 3 average transfers per trade ≈ 130M trades ✓

---

## 🏗️ DERIVED DATA - Built from Source (CAN REBUILD)

### 2. **Intermediate Processing Tables**

| Table | Rows | Purpose | Source | Keep? |
|-------|------|---------|--------|-------|
| **trade_direction_assignments** | 130M | USDC → BUY/SELL direction | erc20_transfers_staging | ✅ GOOD |
| **trade_cashflows_v3** | 35.8M | Aggregated cashflows | trade_direction_assignments | ✅ GOOD |
| erc20_transfers_decoded | 21M | Decoded USDC transfers | erc20_transfers_staging | ⚠️ Optional |
| pm_erc1155_flats | 206K | Flattened ERC1155 | erc1155_transfers | ⚠️ Optional |

**Processing Pipeline:**
```
erc20_transfers_staging (388M)
  ↓ (group by tx_hash, infer BUY/SELL)
trade_direction_assignments (130M)
  ↓ (aggregate by wallet + condition)
trade_cashflows_v3 (35.8M)
```

---

## ⚠️ BROKEN DATA - Must Rebuild

### 3. **Tables with Invalid Condition IDs**

| Table | Rows | Valid IDs | Status | Action |
|-------|------|-----------|--------|--------|
| vw_trades_canonical | 157M | 0% | ❌ BROKEN | Rebuild after ERC1155 |
| trades_with_direction | 82M | 0% | ❌ BROKEN | Rebuild after ERC1155 |
| fact_trades_clean | 63M | 0% | ❌ BROKEN | Rebuild after ERC1155 |

**Why they're broken:**
- Built BEFORE ERC1155 data was available
- Tried to join 388M USDC transfers to 291K ERC1155 (only 0.07% coverage!)
- Filled missing condition IDs with 0x0000... placeholders

---

## 🎯 THE ONE TRUE FACT TABLE

### **FACT_TRADES** (The Single Source of Truth)

**Built from:**
```sql
CREATE TABLE fact_trades AS
SELECT
  -- Identity
  tda.tx_hash || '-' || tda.wallet_address AS trade_id,
  tda.tx_hash,

  -- Who
  tda.wallet_address,

  -- What (market context from ERC1155)
  erc.condition_id_norm,
  erc.outcome_index,

  -- When
  tda.created_at AS timestamp,

  -- Direction & amounts
  tda.direction,                    -- BUY/SELL/UNKNOWN
  tda.confidence,                   -- HIGH/MEDIUM/LOW
  cf.cashflow_usdc,                 -- Net USDC (negative = spent)
  cf.shares,                        -- Token amount
  cf.price,                         -- Entry price

  -- Metadata
  tda.has_both_legs,                -- Quality flag
  'erc20+erc1155' AS source

FROM trade_direction_assignments tda

  -- Join to ERC1155 to get market context
  LEFT JOIN erc1155_transfers erc
    ON tda.tx_hash = erc.tx_hash
    AND tda.wallet_address IN (erc.from_address, erc.to_address)

  -- Join to cashflows for amounts
  LEFT JOIN trade_cashflows_v3 cf
    ON tda.wallet_address = cf.wallet
    AND tda.condition_id_norm = cf.condition_id_norm
```

**Row count after ERC1155 backfill:**
- Base: 130M rows (from trade_direction_assignments)
- With condition IDs: ~125M rows (96% will have valid market context)
- Unmapped: ~5M rows (3-4% legacy/edge cases)

---

## 📋 DIMENSION TABLES

### **DIM_MARKETS** (Market Master Data)

**Source:** Multiple tables combined
```sql
CREATE TABLE dim_markets AS
SELECT DISTINCT
  condition_id_norm,
  market_id,
  question,
  category,
  outcomes,
  created_at,
  closed_at
FROM (
  SELECT condition_id, market_id, NULL as question FROM condition_market_map
  UNION ALL
  SELECT condition_id, NULL, question FROM market_key_map
  UNION ALL
  SELECT condition_id, NULL, question FROM gamma_markets
)
GROUP BY condition_id_norm
```

**Tables to merge:**
- condition_market_map (152K) - condition → market mapping
- market_key_map (157K) - market metadata
- gamma_markets (150K) - full metadata
- api_markets_staging (161K) - API data

**Final count:** ~233K unique markets

---

### **DIM_RESOLUTIONS** (Resolution Master Data)

**Source:** Already clean!
```sql
-- Use existing table (it's already good)
ALTER TABLE market_resolutions_final RENAME TO dim_resolutions;
```

**Rows:** 157K resolved markets (67% of traded markets)

**Supplements:**
- api_ctf_bridge (134K with human-readable outcomes)
- Use for UI display: "Yes" instead of "index: 0"

---

### **DIM_WALLETS** (Wallet Dimension)

**Source:** Already exists
```sql
-- Use existing
SELECT * FROM wallet_metrics; -- 996K wallets
```

---

## 🔄 THE JOINS (How It All Connects)

### **Query: Get wallet P&L**

```sql
-- Realized P&L (resolved markets)
SELECT
  t.wallet_address,
  SUM(
    t.shares *
    arrayElement(r.payout_numerators, t.outcome_index + 1) / r.payout_denominator
    - t.usd_value
  ) as realized_pnl
FROM fact_trades t
JOIN dim_resolutions r
  ON t.condition_id_norm = r.condition_id_norm
WHERE r.winning_index IS NOT NULL
GROUP BY t.wallet_address;

-- Unrealized P&L (open markets)
SELECT
  t.wallet_address,
  SUM(
    t.shares * p.close_price - t.usd_value
  ) as unrealized_pnl
FROM fact_trades t
LEFT JOIN dim_resolutions r
  ON t.condition_id_norm = r.condition_id_norm
JOIN market_candles_5m p
  ON t.condition_id_norm = p.condition_id_norm
WHERE r.condition_id_norm IS NULL  -- Only unresolved
GROUP BY t.wallet_address;

-- Total P&L
-- realized_pnl + unrealized_pnl
```

**No complex joins needed!** Everything joins on `condition_id_norm`.

---

## 📊 SUMMARY - What to Use

### **Source Data (Ground Truth)**
✅ **Keep as-is:**
- `erc20_transfers_staging` (388M USDC)
- `erc1155_transfers` (291K → backfill to 10M+)

### **Intermediate (Can rebuild)**
✅ **Use these:**
- `trade_direction_assignments` (130M) - Already has 50% valid condition IDs
- `trade_cashflows_v3` (35.8M) - Pre-computed amounts

### **Fact Table (Single source of truth)**
🔨 **BUILD THIS:**
- `fact_trades` (130M) - Combines direction + cashflows + ERC1155 market context

### **Dimension Tables**
✅ **Use these:**
- `dim_markets` (233K) - Merge existing market tables
- `dim_resolutions` (157K) - Rename market_resolutions_final
- `dim_wallets` (996K) - Use wallet_metrics

### **Delete These (Broken/Redundant)**
❌ **Discard:**
- `vw_trades_canonical` (157M with 0% valid IDs)
- `trades_with_direction` (82M with 0% valid IDs)
- `fact_trades_clean` (63M with 0% valid IDs)
- All `*_backup` tables

---

## 🚀 IMPLEMENTATION PLAN

### **Phase 1: Backfill ERC1155** (4-8 hours)
```bash
npx tsx backfill-all-goldsky-payouts.ts
```
**Result:** 291K → 10M+ ERC1155 transfers

### **Phase 2: Build dim_markets** (1 hour)
```bash
npx tsx build-dim-markets.ts
```
**Result:** 233K markets with full metadata

### **Phase 3: Build fact_trades** (2-4 hours)
```bash
npx tsx build-fact-trades.ts
```
**Result:** 130M trades with valid condition IDs (96%+ coverage)

### **Phase 4: Build P&L views** (1-2 hours)
```bash
npx tsx build-pnl-views.ts
```
**Result:** Realized + unrealized P&L for all wallets

### **Phase 5: Delete garbage** (30 min)
```bash
DROP TABLE vw_trades_canonical;
DROP TABLE trades_with_direction;
DROP TABLE fact_trades_clean;
-- + backups
```
**Result:** Clean, simple database

---

## 📐 FINAL DATABASE STRUCTURE

```
RAW DATA (Don't touch):
├── erc20_transfers_staging (388M USDC)
└── erc1155_transfers (10M tokens)

FACT TABLE (Analytics source):
└── fact_trades (130M trades)

DIMENSIONS (Master data):
├── dim_markets (233K)
├── dim_resolutions (157K)
└── dim_wallets (996K)

AGGREGATES (Optional):
├── wallet_pnl_summary (996K wallets)
├── market_stats (233K markets)
└── daily_volume (time series)
```

**Total tables: 9** (down from 61)
**Total complexity: Low**
**Query performance: Excellent** (single fact table + star joins)

---

## ❓ FAQ

**Q: Why not use vw_trades_canonical (157M rows)?**
A: ALL 157M condition IDs are `0x0000...` (invalid). Must rebuild.

**Q: Can we use trade_direction_assignments (130M)?**
A: YES! It's the BASE. 50% already have valid condition IDs. Join with ERC1155 to get the rest.

**Q: What about the 388M USDC transfers?**
A: That's the RAW source. Already processed into trade_direction_assignments (130M). Don't query directly.

**Q: Do we need multiple fact tables?**
A: NO! One fact_trades table. Everything else is dimensions or aggregates.

**Q: How do I query for wallet P&L?**
A: `fact_trades` JOIN `dim_resolutions` for realized, JOIN `market_candles_5m` for unrealized. Simple!

---

## 🎯 SUCCESS CRITERIA

After implementation:
- ✅ ONE fact table with 130M trades
- ✅ 96%+ have valid condition IDs
- ✅ Test wallet: 2,816 trades (not 31)
- ✅ P&L calculations work
- ✅ Queries are simple (no 5-way joins)
- ✅ Database is maintainable

**Timeline:** 12-20 hours total
