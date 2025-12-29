# Essential Schema Reference

> **The ONLY schema document you need to read.**
> Last updated: 2025-11-29 | Production tables only | No legacy cruft

---

## Quick Facts

- **Production PnL Engine:** V11_POLY (stable, validated)
- **Total Tables:** 18 (only ~8 actively used)
- **Total Views:** 35 (most are legacy/orphaned)
- **Critical Deduplication:** pm_trader_events_v2 requires `GROUP BY event_id`
- **Array Indexing:** ClickHouse arrays are 1-indexed (use `outcome_index + 1`)

---

## Essential Tables

### 1. pm_trader_events_v2
**Purpose:** CLOB order fills from Polymarket exchange (deduplicated externally)

**Key Columns:**
```
event_id         String         -- Unique event identifier (PRIMARY)
trader_wallet    String         -- User wallet address
condition_id     String         -- Market condition ID (64-char hex, no 0x)
side             String         -- 'BUY' or 'SELL'
outcome_index    UInt8          -- 0 or 1 for binary markets
token_amount     Int64          -- Shares (divide by 1e6 for actual)
usdc_amount      Int64          -- USDC (divide by 1e6 for actual)
trade_time       DateTime64(3)  -- Execution timestamp
is_deleted       UInt8          -- 0 = active, 1 = deleted
```

**Sort Key:** `(trader_wallet, trade_time)`
**Engine:** SharedMergeTree (NOT ReplacingMergeTree)

**CRITICAL:** Contains duplicates from historical backfills. ALWAYS use deduplication pattern:

```sql
SELECT ... FROM (
  SELECT
    event_id,
    any(trader_wallet) as trader_wallet,
    any(condition_id) as condition_id,
    any(side) as side,
    any(outcome_index) as outcome_index,
    any(token_amount) / 1000000.0 as shares,
    any(usdc_amount) / 1000000.0 as usdc,
    any(trade_time) as trade_time
  FROM pm_trader_events_v2
  WHERE is_deleted = 0
  GROUP BY event_id  -- REQUIRED for accurate counts
) AS deduplicated
WHERE trader_wallet = '0xabc...'
ORDER BY trade_time
```

**Why:** Sort key doesn't include event_id, causing duplicate rows. Fixing requires expensive full-table scan.

---

### 2. pm_ctf_events
**Purpose:** Conditional Token Framework (CTF) blockchain events for splits/merges/redemptions

**Key Columns:**
```
event_id         String         -- Blockchain event ID
wallet           String         -- User wallet
condition_id     String         -- Market condition (64-char hex)
event_type       String         -- 'PositionSplit', 'PositionMerge', 'PayoutRedemption'
token_amounts    Array(Int64)   -- Per-outcome amounts (1-indexed!)
timestamp        DateTime64(3)  -- Block timestamp
```

**Sort Key:** `(wallet, timestamp)`
**Engine:** ReplacingMergeTree

**Sample Query:**
```sql
SELECT
  wallet,
  condition_id,
  event_type,
  arrayElement(token_amounts, 1) / 1000000.0 as outcome_0_shares,
  arrayElement(token_amounts, 2) / 1000000.0 as outcome_1_shares,
  timestamp
FROM pm_ctf_events
WHERE wallet = '0xabc...'
  AND event_type = 'PayoutRedemption'
ORDER BY timestamp DESC
LIMIT 100
```

---

### 3. pm_erc1155_transfers
**Purpose:** Raw ERC1155 token transfers from blockchain (388M+ transfers indexed)

**Key Columns:**
```
event_id         String         -- Blockchain transaction + log index
from_wallet      String         -- Sender (0x000...000 for mints)
to_wallet        String         -- Receiver (0x000...000 for burns)
token_id         String         -- ERC1155 token ID (256-bit hex)
amount           Int64          -- Transfer amount (divide by 1e6)
timestamp        DateTime64(3)  -- Block timestamp
```

**Sort Key:** `(to_wallet, timestamp)`
**Engine:** ReplacingMergeTree

**Sample Query:**
```sql
SELECT
  from_wallet,
  to_wallet,
  token_id,
  amount / 1000000.0 as shares,
  timestamp
FROM pm_erc1155_transfers
WHERE to_wallet = '0xabc...'
  AND from_wallet != '0x0000000000000000000000000000000000000000'
ORDER BY timestamp DESC
LIMIT 100
```

---

### 4. pm_condition_resolutions
**Purpose:** Market resolution outcomes and payouts

**Key Columns:**
```
condition_id      String              -- Market condition (64-char hex)
resolved_at       DateTime64(3)       -- Resolution timestamp
payout_numerators Array(Nullable(UInt256)) -- Per-outcome payouts (1-indexed)
resolution_status String              -- 'resolved', 'pending', etc.
```

**Sort Key:** `(condition_id)`
**Engine:** ReplacingMergeTree

**Sample Query:**
```sql
SELECT
  condition_id,
  resolved_at,
  arrayElement(payout_numerators, 1) as outcome_0_payout,
  arrayElement(payout_numerators, 2) as outcome_1_payout,
  resolution_status
FROM pm_condition_resolutions
WHERE condition_id = '0abc...'
```

**Note:** `payout_numerators` contains NULL for losing outcomes, non-NULL (usually 1) for winners.

---

### 5. pm_market_metadata
**Purpose:** Market catalog with human-readable names, categories, icons

**Key Columns:**
```
condition_id      String         -- Market condition (64-char hex)
market_slug       String         -- URL-friendly slug
question          String         -- Market question text
category          String         -- 'Politics', 'Sports', 'Crypto', etc.
outcomes          String         -- JSON array of outcome labels
icon              String         -- Market icon URL
end_date          DateTime64(3)  -- Market close time
```

**Sort Key:** `(condition_id)`
**Engine:** ReplacingMergeTree

**Sample Query:**
```sql
SELECT
  condition_id,
  question,
  category,
  outcomes,
  end_date
FROM pm_market_metadata
WHERE category = 'Politics'
  AND end_date > now()
ORDER BY end_date ASC
LIMIT 50
```

---

### 6. pm_token_to_condition_map_v3
**Purpose:** Maps ERC1155 token IDs to condition IDs + outcome indices

**Key Columns:**
```
token_id         String    -- ERC1155 token ID (256-bit hex)
condition_id     String    -- Market condition (64-char hex)
outcome_index    UInt8     -- 0 or 1 for binary markets
```

**Sort Key:** `(token_id)`
**Engine:** ReplacingMergeTree

**Sample Query:**
```sql
SELECT
  token_id,
  condition_id,
  outcome_index
FROM pm_token_to_condition_map_v3
WHERE condition_id = '0abc...'
```

**Join Pattern:**
```sql
-- Link ERC1155 transfers to markets
SELECT
  t.from_wallet,
  t.to_wallet,
  t.amount / 1000000.0 as shares,
  m.condition_id,
  m.outcome_index,
  t.timestamp
FROM pm_erc1155_transfers t
INNER JOIN pm_token_to_condition_map_v3 m
  ON t.token_id = m.token_id
WHERE t.to_wallet = '0xabc...'
ORDER BY t.timestamp DESC
```

---

### 7. pm_unified_ledger_v5
**Purpose:** Unified ledger combining CLOB + CTF events for retail wallet PnL

**Key Columns:**
```
ledger_id        String         -- Unique ledger entry ID
wallet           String         -- User wallet
condition_id     String         -- Market condition
outcome_index    UInt8          -- 0 or 1
event_type       String         -- 'trade', 'split', 'merge', 'redemption'
shares_delta     Float64        -- Change in shares held
usdc_delta       Float64        -- Change in USDC spent/received
timestamp        DateTime64(3)  -- Event timestamp
source_event_id  String         -- Original event ID (CLOB or CTF)
```

**Sort Key:** `(wallet, timestamp)`
**Engine:** ReplacingMergeTree

**Sample Query:**
```sql
SELECT
  wallet,
  condition_id,
  outcome_index,
  event_type,
  shares_delta,
  usdc_delta,
  timestamp
FROM pm_unified_ledger_v5
WHERE wallet = '0xabc...'
ORDER BY timestamp DESC
LIMIT 100
```

**Use Case:** Retail wallet PnL calculation (combines all event types in chronological order)

---

## Essential Views

### vw_pm_retail_wallets_v1
**Purpose:** Identifies retail wallets (vs smart money, market makers, bots)

**Definition:**
```sql
CREATE VIEW vw_pm_retail_wallets_v1 AS
SELECT DISTINCT trader_wallet as wallet
FROM pm_trader_events_v2
WHERE is_deleted = 0
  AND trader_wallet NOT IN (
    SELECT wallet FROM pm_smart_money_wallets
  )
  -- Add additional filtering for bots, MM, etc.
```

**Usage:**
```sql
-- Get retail wallet activity
SELECT
  r.wallet,
  count(*) as trade_count,
  sum(e.usdc_amount) / 1000000.0 as total_volume
FROM vw_pm_retail_wallets_v1 r
INNER JOIN (
  SELECT event_id, any(trader_wallet) as trader_wallet, any(usdc_amount) as usdc_amount
  FROM pm_trader_events_v2
  WHERE is_deleted = 0
  GROUP BY event_id
) e ON r.wallet = e.trader_wallet
GROUP BY r.wallet
ORDER BY total_volume DESC
```

---

## Join Patterns

### Pattern 1: CLOB Trades → Market Metadata
```sql
SELECT
  t.trader_wallet,
  t.side,
  t.shares,
  t.usdc,
  m.question,
  m.category,
  t.trade_time
FROM (
  SELECT
    event_id,
    any(trader_wallet) as trader_wallet,
    any(condition_id) as condition_id,
    any(side) as side,
    any(token_amount) / 1000000.0 as shares,
    any(usdc_amount) / 1000000.0 as usdc,
    any(trade_time) as trade_time
  FROM pm_trader_events_v2
  WHERE is_deleted = 0
  GROUP BY event_id
) t
INNER JOIN pm_market_metadata m
  ON t.condition_id = m.condition_id
WHERE t.trader_wallet = '0xabc...'
ORDER BY t.trade_time DESC
```

### Pattern 2: CLOB Trades → Resolutions (Realized PnL)
```sql
SELECT
  t.trader_wallet,
  t.condition_id,
  t.outcome_index,
  sum(CASE WHEN t.side = 'BUY' THEN t.shares ELSE -t.shares END) as net_shares,
  sum(CASE WHEN t.side = 'BUY' THEN -t.usdc ELSE t.usdc END) as net_usdc,
  r.resolved_at,
  arrayElement(r.payout_numerators, t.outcome_index + 1) as payout
FROM (
  SELECT
    event_id,
    any(trader_wallet) as trader_wallet,
    any(condition_id) as condition_id,
    any(outcome_index) as outcome_index,
    any(side) as side,
    any(token_amount) / 1000000.0 as shares,
    any(usdc_amount) / 1000000.0 as usdc
  FROM pm_trader_events_v2
  WHERE is_deleted = 0
  GROUP BY event_id
) t
INNER JOIN pm_condition_resolutions r
  ON t.condition_id = r.condition_id
WHERE t.trader_wallet = '0xabc...'
  AND r.resolution_status = 'resolved'
GROUP BY t.trader_wallet, t.condition_id, t.outcome_index, r.resolved_at, payout
```

### Pattern 3: ERC1155 Transfers → Market Mapping
```sql
SELECT
  e.to_wallet,
  e.amount / 1000000.0 as shares,
  m.condition_id,
  m.outcome_index,
  meta.question,
  e.timestamp
FROM pm_erc1155_transfers e
INNER JOIN pm_token_to_condition_map_v3 m
  ON e.token_id = m.token_id
INNER JOIN pm_market_metadata meta
  ON m.condition_id = meta.condition_id
WHERE e.to_wallet = '0xabc...'
ORDER BY e.timestamp DESC
```

---

## Common Pitfalls

### 1. Forgetting pm_trader_events_v2 Deduplication
**WRONG:**
```sql
SELECT count(*) FROM pm_trader_events_v2 WHERE trader_wallet = '0xabc...'
-- Returns 2-3x actual count due to duplicates
```

**CORRECT:**
```sql
SELECT count(DISTINCT event_id) FROM pm_trader_events_v2 WHERE trader_wallet = '0xabc...'
-- OR use GROUP BY pattern (preferred for aggregations)
```

### 2. Array Indexing Off-By-One
**WRONG:**
```sql
arrayElement(payout_numerators, outcome_index)  -- ClickHouse arrays are 1-indexed!
```

**CORRECT:**
```sql
arrayElement(payout_numerators, outcome_index + 1)
```

### 3. condition_id Format Mismatches
**Standards:**
- **Storage:** Lowercase, no '0x' prefix, 64 characters
- **Input:** Normalize before querying: `lower(replace(condition_id, '0x', ''))`

**Example:**
```sql
-- Normalize input
SELECT * FROM pm_market_metadata
WHERE condition_id = lower(replace('0xABC123...', '0x', ''))
```

### 4. Forgetting Unit Conversion
**All amounts are stored as integers (6 decimals):**
```sql
-- WRONG: usdc_amount returns 1000000 for $1
SELECT usdc_amount FROM pm_trader_events_v2

-- CORRECT: Divide by 1e6
SELECT usdc_amount / 1000000.0 as usdc_dollars FROM pm_trader_events_v2
```

### 5. Using LEFT JOIN Without Nullable Types
**WRONG:**
```sql
SELECT
  t.wallet,
  r.resolved_at  -- Returns epoch (1970-01-01) for unresolved markets!
FROM pm_trader_events_v2 t
LEFT JOIN pm_condition_resolutions r ON t.condition_id = r.condition_id
```

**CORRECT:**
```sql
SELECT
  t.wallet,
  r.resolved_at as Nullable(DateTime64(3))  -- Properly returns NULL
FROM pm_trader_events_v2 t
LEFT JOIN pm_condition_resolutions r ON t.condition_id = r.condition_id
```

### 6. Ignoring is_deleted Flag
**WRONG:**
```sql
SELECT * FROM pm_trader_events_v2 WHERE trader_wallet = '0xabc...'
-- Includes deleted/cancelled trades
```

**CORRECT:**
```sql
SELECT * FROM pm_trader_events_v2
WHERE trader_wallet = '0xabc...' AND is_deleted = 0
```

---

## PnL Engine Reference

### V11_POLY (Production)
**Status:** Stable, validated, production-ready
**Location:** `lib/pnl/v11-poly/`
**Documentation:** `/Users/scotty/Projects/Cascadian-app/docs/systems/database/PNL_V11_SPEC.md`

**Purpose:** Calculates wallet-level PnL across CLOB trades + CTF events

**Key Features:**
- FIFO position tracking
- Handles splits, merges, redemptions
- Supports both realized (closed positions) and unrealized (open positions) PnL
- Used by production dashboard

**Do NOT use:**
- V1-V10 engines (legacy, deprecated)
- Ad-hoc PnL calculations (use V11_POLY instead)

---

## Data Safety Rules

Before ANY destructive operation (DROP, TRUNCATE, REPLACE):

1. **Document current state:**
   ```sql
   SELECT count(*) FROM target_table;
   SHOW CREATE TABLE target_table;
   ```

2. **Create backup:**
   ```sql
   CREATE TABLE target_table_backup AS SELECT * FROM target_table;
   ```

3. **Test on subset:**
   ```sql
   -- Test new logic on 100 rows first
   SELECT * FROM new_logic LIMIT 100;
   ```

4. **Use atomic operations:**
   ```sql
   -- WRONG: ALTER TABLE (locks table)
   ALTER TABLE target_table UPDATE column = value WHERE condition;

   -- CORRECT: Atomic swap
   CREATE TABLE target_table_new AS SELECT ... (new logic);
   RENAME TABLE target_table TO target_table_old, target_table_new TO target_table;
   ```

5. **Read first:** `/Users/scotty/Projects/Cascadian-app/docs/operations/NEVER_DO_THIS_AGAIN.md`

---

## Quick Debugging Checklist

When a query returns unexpected results:

- [ ] Did you deduplicate pm_trader_events_v2 with `GROUP BY event_id`?
- [ ] Did you filter `is_deleted = 0`?
- [ ] Did you convert amounts from integers (`/ 1000000.0`)?
- [ ] Did you use `outcome_index + 1` for array access?
- [ ] Did you normalize condition_id format (lowercase, no 0x)?
- [ ] Did you use Nullable types for LEFT JOIN columns?
- [ ] Did you check DESCRIBE TABLE for actual column names?

---

## Next Steps

1. **For PnL work:** Read `/Users/scotty/Projects/Cascadian-app/docs/READ_ME_FIRST_PNL.md`
2. **For new queries:** Use patterns from this document
3. **For investigations:** Run Format Consistency Audit (per CLAUDE.md)
4. **For complex work:** Consult `/Users/scotty/Projects/Cascadian-app/docs/systems/database/STABLE_PACK_REFERENCE.md`

---

**Remember:**
- This is the ONLY schema doc you need for daily work
- All other docs are legacy unless explicitly referenced here
- When in doubt, DESCRIBE the table and check actual data

**Last Updated:** 2025-11-29
**Maintained By:** Database Architect Agent
