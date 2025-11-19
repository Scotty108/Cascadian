# Phase 1: Global ID Repair Strategy for pm_trades_canonical_v2

**Date:** 2025-11-16
**Agent:** C1 - Global Coverage & Indexer Architect
**Mission:** Design set-based SQL queries to repair 48.67% null market_ids and 49.15% null condition_ids across 157.5M trades

---

## Problem Statement

**Current State (vw_trades_canonical):**
- 157,541,131 trades
- **76,673,859 trades (48.67%) have null market_id_norm**
- **77,431,480 trades (49.15%) have null condition_id_norm**

**Root Cause:** Upstream ingestion from CLOB fills and ERC1155 transfers did not properly decode/map token IDs to human-readable market/condition identifiers.

**Constraint:** Must use ONLY existing ClickHouse data. No external API calls until PnL v2 is validated.

---

## Available Repair Sources

### Source 1: clob_fills (39M fills, 100% asset_id coverage)

**Schema:**
```
fill_id         String
proxy_wallet    String              ← Proxy address
user_eoa        String              ← Actual EOA (wallet)
market_slug     String              ← Often empty
condition_id    String              ← Hex with 0x prefix
asset_id        String              ← Decimal tokenId (can decode!)
outcome         String
side            String              ← 'BUY' / 'SELL'
price           Float64
size            Float64
timestamp       DateTime
tx_hash         String
```

**Sample Data:**
```json
{
  "user_eoa": "0x01e8139026726b55b45b131873e2a5dcb6c7ce3b",
  "condition_id": "0x1e7db4f6ca3919aa41887f9701605568da64287e1e1662aa7558a749ec61146c",
  "asset_id": "105392100504032111304134821100444646936144151941404393276849684670593970547907",
  "side": "BUY",
  "price": 0.48,
  "size": 592730000,
  "timestamp": "2022-12-18 01:03:12",
  "tx_hash": "0x793cb22e63b4f859eb2fc6341f8bfb2b145645659c3a5f7da9d095ef2464624f"
}
```

**Repair Potential:**
- ✅ Can decode `asset_id` (decimal) to `condition_id` + `outcome_index`
- ✅ Already has `condition_id` field (can cross-validate)
- ✅ Has `user_eoa` to match wallet_address_norm
- ✅ Has `tx_hash` + `timestamp` to match trades
- ❌ `market_slug` often empty - cannot repair market_id from this

**Decoding Logic:**
```sql
-- Convert asset_id (decimal string) to tokenId (bigint)
-- Then decode: condition_id = tokenId >> 2, outcome_index from lower 2 bits
```

---

### Source 2: erc1155_transfers (61.4M transfers, 100% token_id coverage)

**Schema:**
```
tx_hash           String
log_index         UInt32
block_timestamp   DateTime
token_id          String              ← 256-bit hex (can decode!)
from_address      String
to_address        String
value             String
```

**Sample Data:**
```json
{
  "tx_hash": "0x...",
  "token_id": "0xe92d69a80b2bb6b02f71f9fc73f4d2be3dc8b70838f49af74eac4e8a8dfd7043",
  "from_address": "0x0000000000000000000000000000000000000000",
  "to_address": "0x01e8139026726b55b45b131873e2a5dcb6c7ce3b",
  "value": "1000000000000000000",
  "block_timestamp": "2022-12-18 01:03:12"
}
```

**Repair Potential:**
- ✅ Can decode `token_id` (hex) to `condition_id` + `outcome_index`
- ✅ Has `to_address` / `from_address` to match wallet
- ✅ Has `tx_hash` + `block_timestamp` to match trades
- ❌ Cannot repair market_id from this

**Decoding Logic:**
```typescript
function decodeTokenId(tokenIdHex: string): { conditionId: string; outcomeIndex: number } {
  const tokenId = BigInt(tokenIdHex);

  // Extract condition ID (first 254 bits → 64 hex chars)
  const conditionId = (tokenId >> 2n).toString(16).padStart(64, '0');

  // Extract outcome index from lower 2 bits (for binary markets)
  const collectionId = tokenId & 0x3n;
  const outcomeIndex = collectionId === 1n ? 0 : 1;

  return { conditionId, outcomeIndex };
}
```

**ClickHouse Implementation:**
```sql
-- Decode token_id to condition_id
bitShiftRight(
  reinterpretAsUInt256(unhex(substring(token_id, 3))),  -- Remove 0x prefix
  2
) AS condition_id_raw,
lpad(hex(condition_id_raw), 64, '0') AS condition_id_norm,

-- Decode outcome_index from lower 2 bits
bitAnd(
  reinterpretAsUInt256(unhex(substring(token_id, 3))),
  3
) = 1 ? 0 : 1 AS outcome_index
```

---

### Source 3: market_resolutions_final (157K resolutions)

**Schema:**
```
condition_id_norm      FixedString(64)    ← Normalized 64-char hex
payout_numerators      Array(UInt8)
payout_denominator     UInt8
outcome_count          UInt8
winning_outcome        String             ← 'Yes' / 'No'
winning_index          UInt16             ← 0 or 1
source                 String
resolved_at            DateTime
```

**Repair Potential:**
- ✅ Can validate condition_id_norm after decode
- ❌ Does NOT have market_id - cannot repair market_id from this table
- ❌ Only covers resolved markets (~157K out of millions of markets)

**Usage:** Validation only, not primary repair source.

---

## Global Repair Strategy (SQL Implementation)

### Step 1: Decode condition_id from clob_fills asset_id

```sql
CREATE TABLE pm_trades_condition_repair_clob AS
SELECT
  cf.tx_hash,
  cf.user_eoa AS wallet_address,
  cf.timestamp,

  -- Decode asset_id (decimal string) to condition_id + outcome_index
  -- asset_id is stored as decimal string, need to convert to bigint then decode
  lpad(
    hex(
      bitShiftRight(
        CAST(cf.asset_id AS UInt256),
        2
      )
    ),
    64,
    '0'
  ) AS condition_id_decoded,

  -- Decode outcome_index from lower 2 bits
  bitAnd(CAST(cf.asset_id AS UInt256), 3) = 1 ? 0 : 1 AS outcome_index_decoded,

  -- Also capture existing condition_id for cross-validation
  lower(replaceAll(cf.condition_id, '0x', '')) AS condition_id_original,

  'clob_asset_id_decode' AS repair_source

FROM clob_fills cf
WHERE cf.asset_id IS NOT NULL AND cf.asset_id != '';
```

**Expected Coverage:** ~39M fills

---

### Step 2: Decode condition_id from erc1155_transfers token_id

```sql
CREATE TABLE pm_trades_condition_repair_erc1155 AS
SELECT
  t.tx_hash,
  t.to_address AS wallet_address,  -- Assuming "to" is the buyer
  t.block_timestamp AS timestamp,

  -- Decode token_id (hex string) to condition_id + outcome_index
  lpad(
    hex(
      bitShiftRight(
        reinterpretAsUInt256(unhex(substring(t.token_id, 3))),  -- Remove 0x
        2
      )
    ),
    64,
    '0'
  ) AS condition_id_decoded,

  -- Decode outcome_index from lower 2 bits
  bitAnd(
    reinterpretAsUInt256(unhex(substring(t.token_id, 3))),
    3
  ) = 1 ? 0 : 1 AS outcome_index_decoded,

  'erc1155_token_id_decode' AS repair_source

FROM erc1155_transfers t
WHERE t.token_id IS NOT NULL AND t.token_id != '';
```

**Expected Coverage:** ~61.4M transfers

---

### Step 3: Create pm_trades_canonical_v2 with repaired IDs

```sql
CREATE TABLE pm_trades_canonical_v2 (
  trade_id                  String,
  wallet_address            String,
  market_id                 String,
  condition_id              String,
  outcome_index             UInt8,
  trade_direction           Enum8('BUY'=1, 'SELL'=2, 'UNKNOWN'=3),
  shares                    Decimal(18,8),
  price                     Decimal(18,8),
  usd_value                 Decimal(18,2),
  fee                       Decimal(18,2),
  timestamp                 DateTime,
  transaction_hash          String,
  source                    Enum8('clob'=0, 'erc1155'=1, 'canonical'=2),

  -- Repair tracking
  condition_id_repair_source  Enum8('original'=0, 'clob_decode'=1, 'erc1155_decode'=2, 'null'=3),
  market_id_repair_source     Enum8('original'=0, 'external_needed'=1, 'null'=2),
  is_orphan                   UInt8 DEFAULT 0,
  orphan_reason               Nullable(String),

  version                   DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (wallet_address, condition_id, timestamp, trade_id);
```

**Population Query:**
```sql
INSERT INTO pm_trades_canonical_v2
SELECT
  vt.trade_id,
  vt.wallet_address_norm AS wallet_address,

  -- market_id: Keep original (null for now, external API needed)
  CASE
    WHEN vt.market_id_norm IS NOT NULL AND vt.market_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      THEN vt.market_id_norm
    ELSE NULL
  END AS market_id,

  -- condition_id: Repair from CLOB or ERC1155 decode
  COALESCE(
    -- Priority 1: Use original if valid
    CASE
      WHEN vt.condition_id_norm IS NOT NULL AND vt.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        THEN vt.condition_id_norm
      ELSE NULL
    END,
    -- Priority 2: Decode from CLOB asset_id (match on tx_hash + wallet + timestamp)
    clob.condition_id_decoded,
    -- Priority 3: Decode from ERC1155 token_id (match on tx_hash + wallet + timestamp)
    erc.condition_id_decoded
  ) AS condition_id,

  -- outcome_index: Repair from decode or keep original
  COALESCE(
    vt.outcome_index,
    clob.outcome_index_decoded,
    erc.outcome_index_decoded
  ) AS outcome_index,

  vt.trade_direction,
  vt.shares,
  vt.entry_price AS price,
  vt.usd_value,
  0 AS fee,  -- TODO: Calculate from fee_rate_bps if available
  vt.timestamp,
  vt.transaction_hash,

  -- Determine source
  CASE
    WHEN clob.tx_hash IS NOT NULL THEN 'clob'
    WHEN erc.tx_hash IS NOT NULL THEN 'erc1155'
    ELSE 'canonical'
  END AS source,

  -- Track repair source
  CASE
    WHEN vt.condition_id_norm IS NOT NULL AND vt.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      THEN 'original'
    WHEN clob.condition_id_decoded IS NOT NULL THEN 'clob_decode'
    WHEN erc.condition_id_decoded IS NOT NULL THEN 'erc1155_decode'
    ELSE 'null'
  END AS condition_id_repair_source,

  CASE
    WHEN vt.market_id_norm IS NOT NULL AND vt.market_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      THEN 'original'
    ELSE 'external_needed'
  END AS market_id_repair_source,

  -- Mark as orphan if condition_id still null after all repairs
  CASE
    WHEN COALESCE(
      CASE WHEN vt.condition_id_norm IS NOT NULL AND vt.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000' THEN vt.condition_id_norm ELSE NULL END,
      clob.condition_id_decoded,
      erc.condition_id_decoded
    ) IS NULL THEN 1
    ELSE 0
  END AS is_orphan,

  CASE
    WHEN COALESCE(
      CASE WHEN vt.condition_id_norm IS NOT NULL AND vt.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000' THEN vt.condition_id_norm ELSE NULL END,
      clob.condition_id_decoded,
      erc.condition_id_decoded
    ) IS NULL THEN 'no_matching_decode'
    ELSE NULL
  END AS orphan_reason,

  now() AS version

FROM vw_trades_canonical vt

-- LEFT JOIN to CLOB repairs (match on tx_hash + wallet + timestamp window)
LEFT JOIN pm_trades_condition_repair_clob clob
  ON vt.transaction_hash = clob.tx_hash
  AND vt.wallet_address_norm = clob.wallet_address
  AND abs(toUnixTimestamp(vt.timestamp) - toUnixTimestamp(clob.timestamp)) < 60  -- Within 1 minute

-- LEFT JOIN to ERC1155 repairs (match on tx_hash + wallet + timestamp window)
LEFT JOIN pm_trades_condition_repair_erc1155 erc
  ON vt.transaction_hash = erc.tx_hash
  AND vt.wallet_address_norm = erc.wallet_address
  AND abs(toUnixTimestamp(vt.timestamp) - toUnixTimestamp(erc.timestamp)) < 60;
```

---

### Step 4: Separate orphan trades into dedicated table

```sql
CREATE TABLE pm_trades_orphaned_v2 AS
SELECT *
FROM pm_trades_canonical_v2
WHERE is_orphan = 1;

-- Remove orphans from canonical v2 (atomic swap)
CREATE TABLE pm_trades_canonical_v2_clean AS
SELECT *
FROM pm_trades_canonical_v2
WHERE is_orphan = 0;

-- Atomic rename
RENAME TABLE pm_trades_canonical_v2 TO pm_trades_canonical_v2_backup,
             pm_trades_canonical_v2_clean TO pm_trades_canonical_v2;
```

---

## Expected Repair Rates

### Optimistic Scenario (Good Join Matches)

**Condition ID Repair:**
- Original valid: ~50% (80M trades)
- CLOB decode: ~25% (20M of 77M nulls)
- ERC1155 decode: ~15% (12M of 77M nulls)
- **Remaining orphans:** ~10% (8M trades)

**Market ID Repair:**
- Original valid: ~51% (81M trades)
- External API needed: ~49% (77M trades)

**Total Usable for PnL v2:**
- Trades with valid condition_id: ~90% (142M trades)
- Orphan rate: ~10% (15M trades)

---

### Realistic Scenario (Moderate Join Matches)

**Condition ID Repair:**
- Original valid: ~50% (80M trades)
- CLOB decode: ~15% (12M of 77M nulls)
- ERC1155 decode: ~10% (8M of 77M nulls)
- **Remaining orphans:** ~25% (20M trades)

**Market ID Repair:**
- Original valid: ~51% (81M trades)
- External API needed: ~49% (77M trades)

**Total Usable for PnL v2:**
- Trades with valid condition_id: ~75% (118M trades)
- Orphan rate: ~25% (39M trades)

---

## Market ID Repair - External API Required

**Problem:** None of our existing tables have a reliable `condition_id → market_id` mapping.

**Options:**

### Option A: Use Goldsky Indexer (After PnL v2 validated)
```graphql
query GetMarketsByCondition($conditionIds: [String!]!) {
  markets(where: { condition_id_in: $conditionIds }) {
    market_id
    condition_id
    market_slug
    title
  }
}
```

**Pros:** Official source, batch queries supported
**Cons:** External API call (violates current constraint)
**When:** After PnL v2 validated with condition_id-only calculations

---

### Option B: Extract from CLOB market_slug field
```sql
-- Check if market_slug has useful data
SELECT
  COUNT(*) as total_fills,
  COUNT(CASE WHEN market_slug IS NOT NULL AND market_slug != '' THEN 1 END) as non_empty_slugs,
  COUNT(DISTINCT market_slug) as unique_slugs
FROM clob_fills;
```

**If market_slug has good coverage:**
- Create `market_slug → market_id` mapping table
- Use slug as proxy for market_id initially

**Expected:** Likely low coverage based on sample data showing empty `market_slug`

---

## Validation Queries

### Check repair coverage

```sql
SELECT
  condition_id_repair_source,
  COUNT(*) as trades,
  COUNT(*) / (SELECT COUNT(*) FROM pm_trades_canonical_v2) * 100 as pct
FROM pm_trades_canonical_v2
GROUP BY condition_id_repair_source
ORDER BY trades DESC;
```

**Expected Output:**
```
original         80,000,000    50.8%
clob_decode      20,000,000    12.7%
erc1155_decode   15,000,000     9.5%
null             42,000,000    26.7%  ← Orphan rate
```

---

### Check orphan rate

```sql
SELECT
  is_orphan,
  COUNT(*) as trades,
  COUNT(*) / (SELECT COUNT(*) FROM pm_trades_canonical_v2) * 100 as pct
FROM pm_trades_canonical_v2
GROUP BY is_orphan;
```

---

### Validate decoded condition_ids against resolutions

```sql
SELECT
  COUNT(*) as decoded_trades,
  COUNT(CASE WHEN r.condition_id_norm IS NOT NULL THEN 1 END) as matches_resolution,
  COUNT(CASE WHEN r.condition_id_norm IS NOT NULL THEN 1 END) / COUNT(*) * 100 as match_rate
FROM pm_trades_canonical_v2 t
LEFT JOIN market_resolutions_final r
  ON t.condition_id = r.condition_id_norm
WHERE t.condition_id_repair_source IN ('clob_decode', 'erc1155_decode');
```

**Expected:** >90% match rate (validates decode logic is correct)

---

## Implementation Checklist

- [x] Phase 1, Step 1.1: Analyze trade sources (COMPLETE)
- [x] Phase 1, Step 1.2: Complete schema analysis (COMPLETE)
- [ ] Phase 1, Step 1.3: Test decode logic on 1000 rows
- [ ] Phase 1, Step 1.4: Create repair tables (clob + erc1155)
- [ ] Phase 1, Step 1.5: Create pm_trades_canonical_v2 table
- [ ] Phase 1, Step 1.6: Validate repair coverage (target >70%)
- [ ] Phase 1, Step 1.7: Separate orphan trades
- [ ] Phase 1, Step 1.8: Document orphan patterns

---

## Success Criteria

**Phase 1 Complete When:**
- pm_trades_canonical_v2 created with 157M trades
- Condition ID null rate reduced from 49% to <30%
- Orphan trades separated and documented
- Repair provenance tracked for all trades

**Phase 2 Ready When:**
- pm_wallet_market_pnl_v2 can calculate P&L using condition_id (market_id optional)
- xcnstrategy P&L computable (even without market_id)

---

**Signed:** Claude 1 (C1)
**Date:** 2025-11-16 (PST)
**Status:** Ready to implement repair queries - proceeding to Step 1.3 (test decode logic)
