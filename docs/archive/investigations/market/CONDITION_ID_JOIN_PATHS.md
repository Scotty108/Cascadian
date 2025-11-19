# Condition_ID Join Paths: Visual Reference

**Purpose:** Quick visual guide to connecting trades to resolutions  
**Date:** November 7, 2025

---

## QUICKSTART: The 3-Step Join Path

```
┌────────────────────────────────────────────────────────────┐
│ Step 1: GET TRADES                                         │
├────────────────────────────────────────────────────────────┤
│ trades_raw (159.5M rows)                                   │
│ ├─ trade_id: unique trade identifier                       │
│ ├─ wallet_address: trader wallet                           │
│ ├─ market_id: polymarket ID (100% populated)               │
│ ├─ condition_id: CTF condition (33% populated, recoverable)│
│ ├─ outcome_index: 0-based outcome position                 │
│ └─ shares: number of shares traded                         │
└────────────────────────────────────────────────────────────┘
         ↓
    [JOIN ON market_id]
         ↓
┌────────────────────────────────────────────────────────────┐
│ Step 2: MAP CONDITION_ID                                   │
├────────────────────────────────────────────────────────────┤
│ condition_market_map (151.8K rows) ⭐ FASTEST             │
│ ├─ market_id: input                                        │
│ └─ condition_id: output (recover missing)                  │
│                                                             │
│ OR (fallback)                                              │
│                                                             │
│ gamma_markets (149.9K rows)                                │
│ ├─ market_id: input                                        │
│ ├─ condition_id: output (recover missing)                  │
│ └─ outcomes[]: outcome labels                              │
└────────────────────────────────────────────────────────────┘
         ↓
  [NORMALIZE condition_id]
    lower(replaceAll(condition_id, '0x', ''))
         ↓
┌────────────────────────────────────────────────────────────┐
│ Step 3: GET RESOLUTION                                     │
├────────────────────────────────────────────────────────────┤
│ market_resolutions_final (223.9K rows) ⭐ AUTHORITATIVE   │
│ ├─ condition_id_norm: (lowercase, no 0x)                  │
│ ├─ winning_outcome_index: 0-based winner                   │
│ ├─ winner: outcome label                                   │
│ ├─ is_resolved: 1 if closed, 0 if open                    │
│ └─ payout_numerators[]: settlement values                  │
└────────────────────────────────────────────────────────────┘
         ↓
   [COMPARE outcome_index]
    IF outcome_index == winning_outcome_index
       THEN: WINNER
       ELSE: LOSER
```

---

## DETAILED JOIN PATTERNS

### Pattern A: Direct Join (When condition_id Present)

```sql
SELECT 
  t.trade_id,
  t.outcome_index,
  r.winning_outcome_index,
  IF(t.outcome_index = r.winning_outcome_index, 'WIN', 'LOSS') as result

FROM trades_raw t

JOIN market_resolutions_final r
  ON lower(replaceAll(r.condition_id, '0x', '')) = 
     lower(replaceAll(t.condition_id, '0x', ''))

WHERE t.condition_id IS NOT NULL AND t.condition_id != ''
  AND r.is_resolved = 1
```

**When to use:** When condition_id is already populated in trades_raw (33% of trades)

---

### Pattern B: Recover Via Market_ID (RECOMMENDED)

```sql
SELECT 
  t.trade_id,
  t.outcome_index,
  r.winning_outcome_index,
  IF(t.outcome_index = r.winning_outcome_index, 'WIN', 'LOSS') as result,
  m.condition_id as recovered_condition_id

FROM trades_raw t

-- Step 1: Recover condition_id from market_id
LEFT JOIN condition_market_map m
  ON t.market_id = m.market_id

-- Step 2: Join to resolution using normalized condition_id
LEFT JOIN market_resolutions_final r
  ON lower(replaceAll(m.condition_id, '0x', '')) = 
     lower(replaceAll(r.condition_id, '0x', ''))

WHERE r.is_resolved = 1
  AND t.market_id IS NOT NULL AND t.market_id != ''
```

**When to use:** Standard pattern, covers 98%+ of trades (recommended)

---

### Pattern C: With Outcome Labels

```sql
SELECT 
  t.trade_id,
  t.wallet_address,
  
  -- Get outcome label
  g.outcomes[t.outcome_index + 1] as outcome_label,
  t.outcome_index,
  
  -- Get resolution
  g.outcomes[r.winning_outcome_index + 1] as winning_label,
  r.winning_outcome_index,
  
  -- Determine result
  IF(t.outcome_index = r.winning_outcome_index, 1, 0) as was_winner,
  
  -- Category context
  g.category,
  g.question

FROM trades_raw t

LEFT JOIN condition_market_map m ON t.market_id = m.market_id

LEFT JOIN gamma_markets g 
  ON lower(replaceAll(g.condition_id, '0x', '')) = 
     lower(replaceAll(m.condition_id, '0x', ''))

LEFT JOIN market_resolutions_final r
  ON lower(replaceAll(m.condition_id, '0x', '')) = 
     lower(replaceAll(r.condition_id, '0x', ''))

WHERE r.is_resolved = 1
```

**When to use:** Need human-readable outcome labels and market context

---

### Pattern D: With Position Validation

```sql
SELECT 
  t.trade_id,
  t.wallet_address,
  t.outcome_index,
  r.winning_outcome_index,
  
  -- What did wallet actually hold?
  p.total_shares as position_at_resolution,
  
  -- Did position match outcome?
  IF(t.outcome_index = r.winning_outcome_index, 'MATCH', 'MISMATCH') as validation

FROM trades_raw t

LEFT JOIN condition_market_map m ON t.market_id = m.market_id

LEFT JOIN market_resolutions_final r
  ON lower(replaceAll(m.condition_id, '0x', '')) = 
     lower(replaceAll(r.condition_id, '0x', ''))

LEFT JOIN outcome_positions_v2 p
  ON t.wallet_address = p.wallet_address
  AND lower(replaceAll(m.condition_id, '0x', '')) = p.condition_id_norm

WHERE r.is_resolved = 1
  AND p.total_shares > 0
```

**When to use:** Validating P&L (ensures wallet held position at resolution)

---

### Pattern E: With ERC1155 Transfers

```sql
SELECT 
  -- Transfer details
  f.from_addr as seller,
  f.to_addr as buyer,
  f.amount as shares_transferred,
  
  -- Map to market
  t.outcome as outcome_name,
  t.market_id,
  t.condition_id_norm,
  
  -- Get resolution
  r.winning_outcome_index,
  r.winner,
  
  -- Determine result
  IF(t.outcome_index = r.winning_outcome_index, 'WIN', 'LOSS') as result

FROM pm_erc1155_flats f

-- Map token to condition
LEFT JOIN ctf_token_map t ON f.token_id = t.token_id

-- Get resolution
LEFT JOIN market_resolutions_final r
  ON t.condition_id_norm = lower(replaceAll(r.condition_id, '0x', ''))

WHERE r.is_resolved = 1
```

**When to use:** Tracking position movements from ERC1155 transfers

---

## TABLE DEPENDENCY MATRIX

```
┌─────────────┐
│ trades_raw  │  Source data (159.5M trades)
└──────┬──────┘
       │
       ├─→ [NEEDS: condition_id or market_id]
       │
       │   If condition_id empty:
       │   └─→ Use market_id to JOIN ↓
       │
       └─→ condition_market_map  (151.8K mappings)
           │
           └─→ condition_id (recovered)
               │
               ├─→ NORMALIZE: lower(replaceAll(..., '0x', ''))
               │
               └─→ market_resolutions_final (223.9K resolutions)
                   │
                   ├─→ winning_outcome_index (who won)
                   ├─→ is_resolved (market closed?)
                   ├─→ payout_numerators (settlement amount)
                   │
                   └─→ [MATCH with trade.outcome_index]
                       │
                       └─→ WINNER or LOSER

Optional enrichment:

gamma_markets (149.9K definitions)
    ├─ outcomes[]: human-readable labels
    ├─ category: market category
    └─ question: market question
        │
        └─→ outcomes[outcome_index + 1] = outcome_label

outcome_positions_v2 (2M position snapshots)
    ├─ wallet_address: which wallet
    ├─ condition_id_norm: which market
    ├─ outcome_index: which outcome they held
    └─ total_shares: how many shares
        │
        └─→ Validate wallet held position at resolution
```

---

## NORMALIZATION CHEAT SHEET

### Always Apply These Transformations:

```sql
-- Step 1: Remove "0x" prefix
lower(replaceAll(condition_id, '0x', ''))

-- Step 2: Result should be:
--   - 64 characters long
--   - All lowercase (a-f, 0-9)
--   - No "0x" prefix

-- Examples:
'0x1234ABCD...' → '1234abcd...' ✅
'1234ABCD...'   → '1234abcd...' ✅  (already normalized)
'0x0000...'     → '0000...'     ✅  (valid, though unresolved)
NULL            → NULL          ✅  (skip these)
''              → ''            ✅  (skip these)
```

### Check Normalization Works:

```sql
SELECT 
  CASE 
    WHEN length(lower(replaceAll(condition_id, '0x', ''))) = 64 
      AND lower(replaceAll(condition_id, '0x', '')) REGEXP '^[0-9a-f]{64}$'
    THEN 'VALID'
    ELSE 'INVALID'
  END as validation,
  condition_id
FROM (SELECT DISTINCT condition_id FROM trades_raw WHERE condition_id != '')
LIMIT 10;
```

---

## FAILURE TROUBLESHOOTING

### Problem: "No rows returned" from join

**Likely cause:** Normalization mismatch

```sql
-- Debug: Check if normalized values actually match
SELECT DISTINCT
  lower(replaceAll(t.condition_id, '0x', '')) as t_norm,
  lower(replaceAll(r.condition_id, '0x', '')) as r_norm
FROM trades_raw t
CROSS JOIN market_resolutions_final r
LIMIT 5;

-- If no matches, values don't align:
-- Option 1: Check character count
SELECT length(lower(replaceAll(condition_id, '0x', ''))) as len
FROM trades_raw WHERE condition_id != ''
GROUP BY len;

-- Option 2: Check for encoding issues
SELECT 
  condition_id,
  hex(condition_id) as hex_value
FROM trades_raw WHERE condition_id != ''
LIMIT 5;
```

---

### Problem: "Wrong results" - Win/loss incorrect

**Likely cause:** Array indexing off-by-one

```sql
-- Remember: ClickHouse arrays are 1-indexed
-- outcome_index in trades_raw is 0-based
-- So use: outcomes[outcome_index + 1]

-- WRONG:
g.outcomes[t.outcome_index] -- gives wrong label

-- RIGHT:
g.outcomes[t.outcome_index + 1] -- correct!
```

---

### Problem: Wallets have missing data

**Likely cause:** Unresolved markets

```sql
-- markets still open don't have resolutions:
SELECT COUNT(*) FROM trades_raw t
LEFT JOIN market_resolutions_final r ON ...
WHERE r.market_id IS NULL;  -- These are unresolved

-- This is EXPECTED, not a bug:
-- ~75% of markets still open on Polymarket
```

---

## PERFORMANCE TIPS

### Tip 1: Use Bloom Filters for Joins

```sql
-- ClickHouse automatically uses bloom filters if created:
ALTER TABLE condition_market_map
  ADD INDEX idx_market ON market_id TYPE bloom_filter(0.01) GRANULARITY 1;

ALTER TABLE market_resolutions_final
  ADD INDEX idx_condition ON condition_id TYPE bloom_filter(0.01) GRANULARITY 1;
```

### Tip 2: Partition Queries by Date

```sql
-- Trades are partitioned by timestamp, use this:
SELECT ...
WHERE t.timestamp >= '2024-01-01' AND t.timestamp < '2025-01-01'
-- Much faster than scanning all data
```

### Tip 3: Pre-compute Common Joins

```sql
-- For frequently used joins, create materialized view:
CREATE MATERIALIZED VIEW trades_with_outcome AS
SELECT 
  t.trade_id,
  t.wallet_address,
  t.outcome_index,
  r.winning_outcome_index,
  IF(t.outcome_index = r.winning_outcome_index, 1, 0) as was_winner
FROM trades_raw t
LEFT JOIN condition_market_map m ON t.market_id = m.market_id
LEFT JOIN market_resolutions_final r ON ...;
```

---

## COMPLETE REFERENCE: All 6 Data Sources

| # | Table | Rows | Primary Use | How to Access condition_id |
|---|-------|------|-------------|----------------------------|
| 1 | **trades_raw** | 159.5M | Source trades | Field: condition_id (33% populated) OR JOIN market_id |
| 2 | **condition_market_map** | 151.8K | Map market→condition | Field: condition_id (100% populated) |
| 3 | **market_resolutions_final** | 223.9K | Get winners | Field: condition_id_norm (normalized, 100% populated) |
| 4 | **gamma_markets** | 149.9K | Get outcomes & labels | Field: condition_id (100% populated) |
| 5 | **ctf_token_map** | 41.1K | Map token→condition | Field: condition_id_norm (100% populated) |
| 6 | **outcome_positions_v2** | 2M | Validate positions | Field: condition_id_norm (100% populated) |

---

## SUMMARY CHECKLIST

Before writing a query:

- [ ] I have trades_raw with some condition_ids missing
- [ ] I'll join trades_raw.market_id to condition_market_map.market_id
- [ ] I'll normalize condition_id: lower(replaceAll(..., '0x', ''))
- [ ] I'll join normalized value to market_resolutions_final.condition_id_norm
- [ ] I'll check is_resolved = 1 to ensure market is closed
- [ ] I'll compare outcome_index to winning_outcome_index (0-based indexing)
- [ ] I'll use +1 when accessing outcomes array: outcomes[index + 1]
- [ ] I'll validate with outcome_positions_v2 if needed
- [ ] I'll use String type for condition_id joins (not FixedString)

✅ Ready to query!

