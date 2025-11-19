# Resolution & Payout Data Schema

**Quick Reference for C2/C3 P&L Calculations**

---

## ✅ ClickHouse Access Confirmed

**Credentials (in `.env.local`):**
```bash
CLICKHOUSE_HOST=https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=8miOkWI~OhsDb
CLICKHOUSE_DATABASE=default
```

**Status:** Tested and working ✅

---

## Primary Payout Table

### `token_per_share_payout`

**Purpose:** Per-share payout amounts for each outcome of a condition

**Columns:**
```sql
condition_id_ctf  FixedString(64)        -- 64-char hex condition ID
pps               Array(Nullable(Float64)) -- Payout per share for each outcome
```

**Data:**
- **Rows:** 118,662 conditions
- **Coverage:** 100%

**Example:**
```json
{
  "condition_id_ctf": "000000074ba83ff8fb5b39ebbe2d366bcf1a537b31bdd53...",
  "pps": [0, 1]  // Outcome 0 pays 0, Outcome 1 pays 1 USDC
}
```

**Usage:**
```sql
-- Get payout for outcome 0 (YES)
SELECT arrayElement(pps, 1) AS yes_payout FROM token_per_share_payout;

-- Get payout for outcome 1 (NO)
SELECT arrayElement(pps, 2) AS no_payout FROM token_per_share_payout;

-- ⚠️ CRITICAL: ClickHouse arrays are 1-indexed!
-- For 0-indexed outcome_index from trades:
SELECT arrayElement(pps, outcome_index + 1) AS payout FROM token_per_share_payout;
```

---

## Primary Resolution Table

### `market_resolutions_final`

**Purpose:** Winning outcomes and resolution metadata

**Columns:**
```sql
condition_id_norm   FixedString(64)        -- 64-char hex condition ID (PRIMARY KEY)
winning_outcome     LowCardinality(String) -- "Yes", "No", "Up", "Down", etc.
winning_index       UInt16                 -- 0 = first outcome, 1 = second outcome
payout_numerators   Array(UInt8)           -- E.g., [1, 0] means first outcome pays 1
payout_denominator  UInt8                  -- Usually 1
outcome_count       UInt8                  -- Number of outcomes (e.g., 2)
resolved_at         Nullable(DateTime)     -- Resolution timestamp
updated_at          DateTime               -- Version timestamp
source              LowCardinality(String) -- "bridge_clob", "api", etc.
version             UInt8                  -- Resolution version
```

**Data:**
- **Rows:** 157,319 resolutions
- **Engine:** SharedReplacingMergeTree (use `FINAL` for deduplication)

**Example:**
```json
{
  "condition_id_norm": "0000a3aa2ac9a909841538e97750d8cf5ef95fdf46b74a3...",
  "winning_outcome": "Yes",
  "winning_index": 0,
  "payout_numerators": [1, 0],
  "payout_denominator": 1,
  "outcome_count": 2,
  "resolved_at": "2025-08-01 00:00:00",
  "updated_at": "2025-11-05 06:24:26",
  "source": "bridge_clob",
  "version": 28
}
```

**Usage:**
```sql
-- ⚠️ Always use FINAL for deduplication
SELECT
  condition_id_norm,
  winning_outcome,
  winning_index,
  resolved_at
FROM market_resolutions_final FINAL
WHERE condition_id_norm = 'your_condition_id';
```

---

## Join Pattern

**Combine trades, resolutions, and payouts:**

```sql
SELECT
  t.wallet_address,
  t.condition_id_norm_v3 AS condition_id,
  t.outcome_index_v3 AS outcome_index,
  t.shares,
  t.usd_value,
  t.fee,
  r.winning_outcome,
  r.winning_index,
  r.resolved_at,
  -- Get payout for this trade's outcome
  arrayElement(p.pps, t.outcome_index_v3 + 1) AS payout_per_share,
  -- Calculate settlement proceeds
  t.shares * arrayElement(p.pps, t.outcome_index_v3 + 1) AS settlement_amount
FROM pm_trades_canonical_v3 t
LEFT JOIN market_resolutions_final r FINAL
  ON t.condition_id_norm_v3 = r.condition_id_norm
LEFT JOIN token_per_share_payout p
  ON t.condition_id_norm_v3 = p.condition_id_ctf
WHERE r.condition_id_norm IS NOT NULL;  -- Only resolved positions
```

---

## Realized P&L Formula

```sql
realized_pnl = settlement_proceeds + net_cashflow - total_fees

WHERE:
  settlement_proceeds = net_shares * arrayElement(pps, outcome_index + 1)
  net_cashflow = sum(CASE WHEN buy THEN -cost ELSE proceeds END)
  total_fees = sum(all fees paid)
```

**Full Example:**
```sql
WITH positions AS (
  SELECT
    wallet_address,
    condition_id_norm_v3,
    outcome_index_v3,
    sum(shares) AS net_shares,
    sum(CASE WHEN trade_direction = 'BUY' THEN -usd_value ELSE usd_value END) AS net_cashflow,
    sum(fee) AS total_fees
  FROM pm_trades_canonical_v3
  WHERE wallet_address = 'target_wallet'
  GROUP BY wallet_address, condition_id_norm_v3, outcome_index_v3
)
SELECT
  p.condition_id_norm_v3,
  p.outcome_index_v3,
  p.net_shares,
  p.net_cashflow,
  p.total_fees,
  arrayElement(t.pps, p.outcome_index_v3 + 1) AS payout_per_share,
  p.net_shares * arrayElement(t.pps, p.outcome_index_v3 + 1) AS settlement_proceeds,
  (p.net_shares * arrayElement(t.pps, p.outcome_index_v3 + 1)) + p.net_cashflow - p.total_fees AS realized_pnl
FROM positions p
LEFT JOIN token_per_share_payout t
  ON p.condition_id_norm_v3 = t.condition_id_ctf
WHERE t.condition_id_ctf IS NOT NULL;
```

---

## Field Name Mapping (⚠️ CRITICAL)

**Same data, different field names across tables:**

| Table | Condition ID Field | Format |
|-------|-------------------|--------|
| `token_per_share_payout` | `condition_id_ctf` | FixedString(64) |
| `market_resolutions_final` | `condition_id_norm` | FixedString(64) |
| `pm_trades_canonical_v3` | `condition_id_norm_v3` | String |
| `wallet_token_flows` | `condition_id_ctf` | String |

**Join correctly:**
```sql
-- Trades → Resolutions
ON pm_trades_canonical_v3.condition_id_norm_v3 = market_resolutions_final.condition_id_norm

-- Trades → Payouts
ON pm_trades_canonical_v3.condition_id_norm_v3 = token_per_share_payout.condition_id_ctf

-- Flows → Payouts
ON wallet_token_flows.condition_id_ctf = token_per_share_payout.condition_id_ctf
```

---

## Common Pitfalls

### ❌ Array Indexing
```sql
-- WRONG: 0-indexed array access
pps[outcome_index]

-- CORRECT: Add 1 to outcome index
arrayElement(pps, outcome_index + 1)
```

### ❌ Missing FINAL
```sql
-- WRONG: May return duplicates
SELECT * FROM market_resolutions_final WHERE ...

-- CORRECT: Use FINAL for deduplication
SELECT * FROM market_resolutions_final FINAL WHERE ...
```

### ❌ Field Name Confusion
```sql
-- WRONG: Inconsistent field names
ON trades.condition_id = resolutions.condition_id

-- CORRECT: Use correct field names from schema
ON trades.condition_id_norm_v3 = resolutions.condition_id_norm
```

---

## Quick Validation

**Test ClickHouse access:**
```typescript
import { clickhouse } from '@/lib/clickhouse/client';

const result = await clickhouse.query({
  query: 'SELECT count() FROM token_per_share_payout',
  format: 'JSONEachRow'
});
const data = await result.json();
console.log(data); // [{ "count()": "118662" }]
```

**Test payout data:**
```sql
SELECT
  condition_id_ctf,
  pps,
  arrayElement(pps, 1) AS outcome_0_payout,
  arrayElement(pps, 2) AS outcome_1_payout
FROM token_per_share_payout
LIMIT 5;
```

---

**Status:** ✅ Ready for P&L calculations
**Verified:** November 17, 2025 (PST)
**Agent:** C1 (Database)
