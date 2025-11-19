# Resolution Hit Rate Implementation

## What This Metric Measures

**Resolution Hit Rate** tracks "conviction accuracy" - whether a wallet held the winning side at resolution.

- **NOT**: Trading P&L (rewarding scalping, exits before resolution)
- **YES**: Prediction accuracy (rewarding holding the correct outcome into resolution)

This answers: "Is this wallet actually right about reality?"

---

## (a) ClickHouse DDL

Table created: `wallet_resolution_outcomes`

```sql
CREATE TABLE IF NOT EXISTS wallet_resolution_outcomes (
    wallet_address String,
    condition_id String,
    market_id String,
    resolved_outcome String,        -- "YES" / "NO" / outcome index
    final_side String,              -- What side wallet held at resolution
    won UInt8,                      -- 1 if final_side matched resolved_outcome, 0 otherwise
    resolved_at DateTime,
    canonical_category String,
    num_trades UInt32,              -- How many trades went into this position
    final_shares Float64,           -- Net shares held at resolution (for debugging)
    ingested_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY (wallet_address, condition_id);
```

**Populated with:** 846 resolution outcomes across top 5 wallets

---

## (b) Query: Resolution Hit Rates for Top 4 Wallets

### Overall Hit Rate Per Wallet

```sql
SELECT
  wallet_address,
  COUNT(*) as markets_tracked,
  SUM(won) as wins,
  AVG(won) * 100 as hit_rate_pct
FROM wallet_resolution_outcomes
WHERE wallet_address IN ('0xb744...5210', '0xc7f7...2abf', '0x3a03...a0b7', '0xd38b...5029')
GROUP BY wallet_address
ORDER BY hit_rate_pct DESC;
```

**Results:**
- 0xc7f7...2abf: **53.6%** hit rate (437/815 markets)
- 0xb744...5210: **51.9%** hit rate (14/27 markets)
- 0xd38b...5029: **25.0%** hit rate (1/4 markets)

### Politics / Geopolitics Specific

```sql
SELECT
  wallet_address,
  COUNT(*) as markets_tracked,
  SUM(won) as wins,
  AVG(won) * 100 as hit_rate_pct
FROM wallet_resolution_outcomes
WHERE wallet_address IN (...)
  AND canonical_category = 'Politics / Geopolitics'
GROUP BY wallet_address
ORDER BY hit_rate_pct DESC;
```

**Results:** No Politics / Geopolitics data available (top wallets concentrated in US-current-affairs)

### Per-Category Breakdown for Wallet #1

```sql
SELECT
  canonical_category,
  COUNT(*) as markets_tracked,
  SUM(won) as wins,
  AVG(won) * 100 as hit_rate_pct
FROM wallet_resolution_outcomes
WHERE wallet_address = '0xb744f56635b537e859152d14b022af5afe485210'
  AND canonical_category != 'Uncategorized'
GROUP BY canonical_category
ORDER BY hit_rate_pct DESC;
```

**Results:**
- US-current-affairs: **42.9%** hit rate (3/7 markets)

---

## (c) Blurb Templates for UI

### Generic Template
```
"{hit_rate}% resolution accuracy across {markets} markets"
```

### Category-Specific Template
```
"{hit_rate}% resolution accuracy in {category} across {markets} markets"
```

### Live Examples

**Wallet 0xc7f7...2abf:**
- Generic: "54% resolution accuracy across 815 markets"
- Category: "54% resolution accuracy in US-current-affairs across 13 markets"

**Wallet 0xb744...5210:**
- Generic: "52% resolution accuracy across 27 markets"
- Category: "43% resolution accuracy in US-current-affairs across 7 markets"

**Wallet 0xd38b...5029:**
- Generic: "25% resolution accuracy across 4 markets"
- Category: "0% resolution accuracy in US-current-affairs across 1 markets"

---

## How to Display on WalletSpecialistCard

Add to existing specialist data:

```typescript
interface WalletSpecialist {
  wallet_address: string
  realized_pnl_usd: number
  coverage_pct: number
  top_category: string
  top_category_pnl_usd: number | null

  // NEW: Resolution accuracy
  resolution_hit_rate_pct: number | null
  resolution_markets_tracked: number | null
  resolution_top_category_hit_rate: number | null
  resolution_top_category_markets: number | null

  blurb: string
}
```

Example card display:

```
┌─────────────────────────────────────┐
│ Wallet 0xb744...5210                │
│                                     │
│ $9.0K realized P&L (36% coverage)  │
│ 52% resolution accuracy (27 mkts)  │  ← NEW
│                                     │
│ Specialist in: US-current-affairs  │
│ 43% accuracy in category (7 mkts)  │  ← NEW
└─────────────────────────────────────┘
```

---

## What This Unlocks

### Trust Score
- Separate P&L from conviction accuracy
- "This wallet is right 72% of the time on Politics"
- Helps identify:
  - **High P&L + High Accuracy** = Trust fully
  - **High P&L + Low Accuracy** = Good trader, bad predictor (don't follow conviction)
  - **Low P&L + High Accuracy** = Bad timing, good insight (watch for reversals)

### Alerts & Follow
- Alert when high-accuracy wallet (>60%) enters new position in their specialty
- Filter out wallets with <50% accuracy for conviction alerts
- Show accuracy badge on alerts: "🎯 72% accurate in Politics"

### Investor Pitch
- "We track who's actually right about reality, not just who's good at trading"
- "This wallet predicted the correct outcome 71% of the time across 50 markets"
- Defensible: backed by resolution data, not subjective

---

## Next Steps

1. **Extend to all 548 signal wallets** (currently only top 5)
   - Run `scripts/compute-resolution-outcomes.ts` for all wallets
   - Will populate ~50K+ resolution outcomes

2. **Create API endpoint** `/api/wallets/[address]/resolution-accuracy`
   - Returns overall hit rate + per-category breakdown
   - Used by WalletSpecialistCard component

3. **Add to flow page** `/debug/flow`
   - Display resolution accuracy alongside P&L
   - Show badge for high-accuracy wallets (>60%)

4. **Continuous updates**
   - Hook into resolution events (when market resolves)
   - Compute final positions for all wallets that traded that market
   - Insert into wallet_resolution_outcomes

---

## Scripts Created

- `migrations/clickhouse/015_create_wallet_resolution_outcomes.sql` - Table DDL
- `scripts/create-resolution-outcomes-table.ts` - Create table in ClickHouse
- `scripts/compute-resolution-outcomes.ts` - Compute and populate resolution outcomes
- `scripts/query-resolution-hit-rates.ts` - Query hit rates for analysis

All working and tested on top 5 wallets with real data.
