# ERC-1155 Token Mapping Plan

**Date:** 2025-11-15 (PST)
**Terminal:** Claude C1
**Status:** Design Complete - Ready for Implementation

---

## Objective

Create `pm_erc1155_token_map` to bridge blockchain ERC-1155 token IDs (from `erc1155_transfers`) to canonical market identifiers (`condition_id` + `outcome_index`), enabling full coverage analysis of on-chain activity.

---

## Background

### The Two ID Systems (CONFIRMED ARCHITECTURE)

**Critical Finding:** After extensive testing, confirmed that erc1155_transfers.token_id and ctf_token_map.token_id are **two separate ID systems** that CANNOT be numerically converted.

1. **ERC-1155 Token ID** (On-Chain World)
   - Source: `erc1155_transfers.token_id`
   - Format: HEX string (66 chars with 0x prefix)
   - Encoding: Proprietary (not standard CTF keccak256)
   - Example: `0x178498138ed7a64427675d152d46c6d4b97a181f7d1d4178f5756ca353009359`
   - Used for: Blockchain transfers, settlements, AMM interactions
   - Authoritative tables: `erc1155_transfers`, CTF event tables

2. **Asset ID** (Exchange/CLOB World)
   - Source: `ctf_token_map.token_id` (misnamed, should be `asset_id`)
   - Format: DECIMAL string (76-78 chars)
   - Example: `100000293804690815023609597660894660801582658691...`
   - Used for: CLOB fills, Gamma API, order book trading
   - Authoritative tables: `ctf_token_map`, `gamma_markets`, `gamma_resolved`

### Canonical Bridge: condition_id + outcome

**These ID systems converge at:**
- `condition_id` (32-byte hex, normalized: no 0x, lowercase)
- `outcome_index` (0-based integer) OR `outcome_label` (string: "Yes", "No", etc.)

**Join Pattern:**
```
On-Chain World                  Canonical Anchors              CLOB/Gamma World
─────────────────              ──────────────────              ─────────────────
erc1155_transfers              condition_id                    ctf_token_map
  .token_id (hex)    ────────> + outcome_index    <────────     .token_id (asset_id)
                                + outcome_label                  .condition_id_norm
                                                                 .outcome
```

**Success Criteria:** Measured at condition_id + outcome level, NOT token_id equality.

---

## ~~CTF Encoding~~ (DEPRECATED)

**Update 2025-11-16:** Standard CTF encoding (keccak256) testing resulted in 0% match rate. Polymarket uses a proprietary encoding that cannot be reverse-engineered from conditions alone.

**Decision:** Abandon formula-based generation. Use existing bridge tables instead.

---

## Implementation Strategy (UPDATED)

### Chosen Approach: Map from Observed Transfers

**Strategy:** Start from erc1155_transfers (observed on-chain token_ids), join to existing bridge tables to attach condition_id + outcome metadata.

**Key Principle:** Map **observed** token_ids to conditions, don't try to **generate** token_ids from conditions.

**Process:**
```sql
1. erc1155_transfers (source of truth for on-chain token_ids)
   ↓
2. JOIN existing bridge tables:
   - ctf_to_market_bridge_mat (275K rows) - best coverage
   - api_ctf_bridge (157K rows) - API market linkage
   - condition_market_map (151K rows) - condition metadata
   - erc1155_condition_map (41K rows) - use cautiously, filter corrupted
   ↓
3. Extract: condition_id, outcome_index, outcome_label
   ↓
4. Build pm_erc1155_token_map with canonical anchors
```

**Advantages:**
- ✅ Works with actual data (no encoding assumptions)
- ✅ Uses existing bridge infrastructure
- ✅ Can validate against ctf_token_map via condition_id
- ✅ Incremental: add new bridges as discovered

**Disadvantages:**
- ⚠️ Coverage limited to existing bridge data
- ⚠️ May miss some token_ids without bridge entries
- ⚠️ Dependent on bridge table quality

---

## Schema Design

### pm_erc1155_token_map

```sql
CREATE TABLE pm_erc1155_token_map (
    -- Token Identification
    erc1155_token_id_hex    String,        -- Normalized: no 0x, lowercase, 64 chars
    erc1155_token_id_uint   UInt256,       -- Numeric form for joins

    -- Canonical Anchors
    condition_id            String,        -- Normalized: no 0x, lowercase, 64 chars
    outcome_index           UInt8,         -- 0-based index (0="Yes", 1="No", etc.)
    index_set               UInt256,       -- Bitmap representation

    -- Metadata
    outcome_label           String,        -- "Yes", "No", outcome name
    question                String,        -- Market question
    market_slug             String,        -- API market ID (if known)

    -- Event Metadata (for deduplication and debugging)
    first_seen_block        UInt64,        -- First block where this token appeared
    first_seen_timestamp    DateTime,      -- Timestamp of first appearance
    first_seen_tx           String,        -- Transaction hash of first appearance

    -- Verification
    is_generated            UInt8,         -- 1=computed from condition, 0=observed only
    match_confirmed         UInt8,         -- 1=matched to erc1155_transfers, 0=unmatched

    -- Housekeeping
    created_at              DateTime DEFAULT now(),
    updated_at              DateTime DEFAULT now()

) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (condition_id, outcome_index);
```

**Index Strategy:**
- Primary: `(condition_id, outcome_index)` - For canonical lookups
- Secondary index on `erc1155_token_id_hex` via materialized view if needed

**Storage:** ReplacingMergeTree for idempotent updates during backfills

---

## Data Sources

### Conditions

**Primary:** `api_ctf_bridge` (157K rows)
- Has `condition_id` (normalized, no 0x)
- Links to `api_market_id` (slug)
- Includes resolution data

**Secondary:** `market_key_map` (157K rows)
- Similar coverage
- Has `market_id` (slug)
- Use as fallback

**Schema to Check:**
```sql
SELECT
    condition_id,
    question,
    outcomes_json
FROM ctf_token_map
WHERE condition_id = '<normalized_condition_id>'
LIMIT 1
```

### Outcome Counts

**Source:** `ctf_token_map.outcomes_json`
- Parse JSON array: `["Yes", "No"]` → 2 outcomes
- Generate index_sets: `[0x01, 0x02]`

**Edge Cases:**
- Multi-outcome markets (3+ outcomes)
- Single outcome markets (rare, but possible)

### Verification

**Source:** `erc1155_transfers` (61.4M rows)
- Join on `erc1155_token_id_hex`
- Mark `match_confirmed = 1` for found tokens
- Extract `first_seen_block`, `first_seen_timestamp`, `first_seen_tx`

---

## Build Process

### Phase 1: Generate Token Map from Conditions

```sql
-- Step 1: Get all conditions with outcome counts
WITH conditions AS (
    SELECT DISTINCT
        condition_id_norm as condition_id,
        question,
        outcomes_json
    FROM ctf_token_map
    WHERE condition_id_norm != ''
),

-- Step 2: Parse outcome counts
condition_outcomes AS (
    SELECT
        condition_id,
        question,
        outcomes_json,
        length(JSONExtractArrayRaw(outcomes_json)) as outcome_count
    FROM conditions
),

-- Step 3: Generate index_sets for binary markets
token_candidates AS (
    SELECT
        condition_id,
        question,
        outcome_count,
        0 as outcome_index,
        1 as index_set,  -- 0x01 for outcome 0
        JSONExtractString(outcomes_json, 1) as outcome_label
    FROM condition_outcomes
    WHERE outcome_count >= 1

    UNION ALL

    SELECT
        condition_id,
        question,
        outcome_count,
        1 as outcome_index,
        2 as index_set,  -- 0x02 for outcome 1
        JSONExtractString(outcomes_json, 2) as outcome_label
    FROM condition_outcomes
    WHERE outcome_count >= 2
)

-- Step 4: Compute token IDs
-- NOTE: ClickHouse doesn't have keccak256, so this needs TypeScript
SELECT
    condition_id,
    outcome_index,
    index_set,
    outcome_label,
    question
FROM token_candidates
ORDER BY condition_id, outcome_index;
```

**Implementation:** TypeScript script using ethers.js for keccak256:

```typescript
import { ethers } from 'ethers';

function computeTokenId(conditionId: string, indexSet: number): string {
    // Ensure condition_id is 32 bytes (no 0x)
    const conditionIdHex = conditionId.replace('0x', '').padStart(64, '0');

    // Convert index_set to 32 bytes
    const indexSetHex = indexSet.toString(16).padStart(64, '0');

    // Concatenate and hash
    const packed = '0x' + conditionIdHex + indexSetHex;
    const tokenId = ethers.keccak256(packed);

    // Return normalized (no 0x, lowercase)
    return tokenId.replace('0x', '').toLowerCase();
}
```

### Phase 2: Match Against ERC1155 Transfers

```sql
-- Join generated tokens with actual transfers
INSERT INTO pm_erc1155_token_map
SELECT
    gen.erc1155_token_id_hex,
    reinterpretAsUInt256(unhex(gen.erc1155_token_id_hex)) as erc1155_token_id_uint,
    gen.condition_id,
    gen.outcome_index,
    gen.index_set,
    gen.outcome_label,
    gen.question,
    gen.market_slug,

    -- Event metadata from first transfer
    min(erc.block_number) as first_seen_block,
    min(erc.block_timestamp) as first_seen_timestamp,
    argMin(erc.tx_hash, erc.block_number) as first_seen_tx,

    1 as is_generated,
    CASE WHEN erc.token_id IS NOT NULL THEN 1 ELSE 0 END as match_confirmed,

    now() as created_at,
    now() as updated_at

FROM generated_token_ids AS gen
LEFT JOIN erc1155_transfers AS erc
    ON lower(replaceAll(erc.token_id, '0x', '')) = gen.erc1155_token_id_hex
GROUP BY
    gen.erc1155_token_id_hex,
    gen.condition_id,
    gen.outcome_index,
    gen.index_set,
    gen.outcome_label,
    gen.question,
    gen.market_slug;
```

### Phase 3: Coverage Analysis

```sql
-- Overall coverage
SELECT
    COUNT(*) as total_generated_tokens,
    SUM(match_confirmed) as matched_tokens,
    ROUND(SUM(match_confirmed) * 100.0 / COUNT(*), 2) as coverage_pct
FROM pm_erc1155_token_map;

-- Coverage by condition
SELECT
    COUNT(DISTINCT condition_id) as total_conditions,
    COUNT(DISTINCT CASE WHEN match_confirmed = 1 THEN condition_id END) as matched_conditions,
    ROUND(COUNT(DISTINCT CASE WHEN match_confirmed = 1 THEN condition_id END) * 100.0 /
          COUNT(DISTINCT condition_id), 2) as condition_coverage_pct
FROM pm_erc1155_token_map;

-- Unmatched transfers (potential missing conditions)
SELECT
    COUNT(*) as unmatched_transfers
FROM erc1155_transfers erc
LEFT JOIN pm_erc1155_token_map map
    ON lower(replaceAll(erc.token_id, '0x', '')) = map.erc1155_token_id_hex
WHERE map.erc1155_token_id_hex IS NULL
    AND erc.token_id != '0x0000000000000000000000000000000000000000000000000000000000000000';
```

---

## Streaming Considerations

### Design for Real-Time Updates

1. **Incremental Token Generation**
   - When new conditions arrive in `ctf_token_map`, generate new tokens
   - Trigger: `ctf_token_map.created_at > last_processed_timestamp`

2. **Incremental Transfer Matching**
   - When new transfers arrive in `erc1155_transfers`, update match status
   - Use `INSERT ... SELECT ... WHERE token_id NOT IN (SELECT ...)` pattern

3. **Materialized View Alternative**
   ```sql
   CREATE MATERIALIZED VIEW pm_erc1155_token_map_live
   ENGINE = ReplacingMergeTree(updated_at)
   ORDER BY (condition_id, outcome_index)
   AS
   SELECT ... -- Same query as Phase 2
   ```

4. **Deduplication Strategy**
   - `ReplacingMergeTree` handles duplicates by `updated_at`
   - Periodic `OPTIMIZE TABLE ... FINAL` to collapse duplicates

---

## Expected Coverage

### Conservative Estimate

**Assumptions:**
- 157K conditions (from `api_ctf_bridge`)
- Average 2 outcomes per condition
- Binary markets dominate (>90%)

**Expected:**
- Generated tokens: ~314K (157K × 2)
- Matched tokens: ~300K (95%+ match rate)
- Total transfers: 61.4M

**Coverage:**
- Condition coverage: ~95% (matches condition count in api_ctf_bridge)
- Transfer coverage: ~90% (some transfers may be for unlisted markets)

### Edge Cases

1. **Multi-outcome markets** (>2 outcomes)
   - Need to generate all index_sets: `0x01, 0x02, 0x04, 0x08, ...`
   - Combinatorial for combined positions

2. **AMM positions**
   - May use different token IDs or combined positions
   - Will investigate separately after baseline coverage

3. **Unlisted markets**
   - Transfers for markets not in `ctf_token_map`
   - Can be discovered by analyzing unmatched transfers

---

## Implementation Scripts

### 1. generate-erc1155-token-map.ts

**Purpose:** Generate all possible token IDs from known conditions

**Steps:**
1. Query `ctf_token_map` for conditions + outcomes
2. For each condition, compute token IDs for each outcome
3. Insert into temporary table `pm_erc1155_token_map_generated`

### 2. match-erc1155-transfers.ts

**Purpose:** Match generated tokens against actual transfers

**Steps:**
1. Join `pm_erc1155_token_map_generated` with `erc1155_transfers`
2. Update `match_confirmed` flag
3. Extract `first_seen_*` metadata
4. Insert into final `pm_erc1155_token_map`

### 3. validate-erc1155-coverage.ts

**Purpose:** Report coverage statistics

**Steps:**
1. Overall token coverage
2. Condition coverage
3. Transfer coverage
4. Identify unmatched transfers
5. Identify unmatched conditions

---

## Success Criteria

1. **Token Generation:** Generate 300K+ token IDs from 157K conditions
2. **Match Rate:** Achieve 95%+ match rate against `erc1155_transfers`
3. **Condition Coverage:** Map 95%+ of conditions from `api_ctf_bridge`
4. **Transfer Coverage:** Explain 90%+ of transfers in `erc1155_transfers`
5. **Validation:** Cross-check with `ctf_token_map` for known markets

---

## Next Steps

1. ✅ Design complete (this document)
2. 🔄 Implement token generation script
3. 🔄 Test on sample conditions
4. 🔄 Build matching logic
5. 🔄 Run full backfill
6. 🔄 Validate coverage
7. 🔄 Update canonical schema docs

---

---

## DEPRECATION NOTICE (2025-11-15)

**Status:** This plan has been superseded by the two-ID-system architecture decision.

**Key Finding:** After implementation and testing, discovered that:
- `pm_erc1155_token_map` (built from `erc1155_condition_map`) contains **DECIMAL CLOB asset IDs**, not hex ERC-1155 tokens
- This table is effectively a duplicate of `ctf_token_map` functionality
- Real hex ERC-1155 coverage: only 6.5% via `legacy_token_condition_map`

**Replacement Architecture:**

1. **CLOB/Asset Mapping** (PRIMARY - 100% coverage)
   - Table: `pm_asset_token_map` (view backed by `ctf_token_map`)
   - Format: Decimal strings (76-78 chars)
   - Use: Canonical trades, PnL, all CLOB analytics
   - Coverage: ~100% of Gamma markets

2. **ERC-1155 Hex Mapping** (AUDIT ONLY - 6.5% coverage)
   - Table: `pm_erc1155_token_map_hex` (built from `legacy_token_condition_map`)
   - Format: Hex strings (64 chars, no 0x)
   - Use: Blockchain verification, limited audits
   - Coverage: ~6.5% of on-chain token IDs

**Migration Notes:**
- `pm_erc1155_token_map` table remains but is NOT used for ERC-1155 hex bridging
- Downstream code should reference `pm_asset_token_map` for CLOB work
- Deeper ERC-1155 decoding deferred to future work

**See:** `TASK_D_ROOT_CAUSE_REPORT.md` for full analysis

---

**Original Signed:** Claude C1
**Original Date:** 2025-11-15 23:55 PST
**Deprecation Date:** 2025-11-15 (PST)
