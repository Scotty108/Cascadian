# Market Metadata Schema Reference

**Last Updated**: November 10, 2025
**Purpose**: Reference for market metadata tables (dimensions, API staging, gamma markets)

---

## Overview

Three tables provide market metadata and human-readable information:

| Table | Rows | Purpose | Coverage |
|-------|------|---------|----------|
| **dim_markets** | 318,535 | Consolidated analytics dimension | 50% metadata complete |
| **gamma_markets** | 149,907 | Gamma API market data | 100% questions, sparse categories |
| **api_markets_staging** | 161,180 | Polymarket Data API snapshot | 100% core fields |

**Key Field**: `condition_id` (or `condition_id_norm`) - used to join with trades_raw and resolutions

---

## Table 1: dim_markets

**Purpose**: Consolidated market dimension table for analytics
**Rows**: 318,535
**Primary Key**: `condition_id_norm`

### Schema

| Column | Type | Coverage | Notes |
|--------|------|----------|-------|
| condition_id_norm | String | 100% ✅ | Normalized condition ID (64-char hex, no 0x) |
| market_id | String | 48% ❌ | Empty for 166K rows - needs backfill |
| question | String | 44% ❌ | Empty for 179K rows - critical gap |
| category | String | 1% ❌ | Empty for 314K rows - very sparse |
| outcomes | Array(String) | 100% ✅ | Outcome labels (e.g., ["Yes", "No"]) |
| end_date | DateTime64(3) | 50% ⚠️ | Nullable, missing for 158K rows |
| resolved_at | DateTime | 42% ❌ | Nullable, missing for 185K rows |
| closed | UInt8 | 100% ✅ | 0 = open, 1 = closed |
| description | String | 51% ⚠️ | Empty for 157K rows |
| volume | Float64 | 100% ✅ | Total trading volume |
| liquidity | Float64 | 100% ✅ | Current liquidity |
| event_id | String | 0% ❌ | Empty for all rows - not populated |
| tags | Array(String) | 100% ✅ | Market tags (may be empty array) |
| primary_source | String | 100% ✅ | Data source identifier |
| updated_at | DateTime | 100% ✅ | Last update timestamp |

### Data Quality Issues

**CRITICAL**:
- ❌ **market_id**: 52% empty (166,692 rows) - blocks joins with other systems
- ❌ **question**: 56% empty (179,328 rows) - can't display market name
- ❌ **category**: 99% empty (314,330 rows) - essentially unused
- ❌ **event_id**: 100% empty - not populated

**WARNINGS**:
- ⚠️ **end_date**: 50% missing - affects time-based filters
- ⚠️ **description**: 49% missing - reduces context
- ⚠️ **resolved_at**: 58% missing - hard to determine resolution timing

### Recommended Use

**Good for**:
- Volume/liquidity analytics (100% coverage)
- Outcome structure (100% coverage)
- Closed status checks (100% coverage)

**Avoid using for**:
- Market ID lookups (52% gap)
- Question display (56% gap)
- Category filtering (99% gap)

**Backfill needed**: market_id, question, category, event_id

---

## Table 2: gamma_markets

**Purpose**: Gamma API market data (human-readable metadata)
**Rows**: 149,907
**Primary Key**: `condition_id`

### Schema

| Column | Type | Coverage | Notes |
|--------|------|----------|-------|
| condition_id | String | 100% ✅ | Condition ID (may have 0x prefix) |
| token_id | String | 99.9% ⚠️ | ERC1155 token ID (136 empty) |
| question | String | 100% ✅ | Human-readable market question |
| description | String | 100% ✅ | Full market description |
| outcome | String | 100% ✅ | Single outcome label (for this token) |
| outcomes_json | String | 100% ✅ | JSON array of all outcomes |
| end_date | String | 99% ⚠️ | ISO date string (1,919 empty) |
| category | String | 6% ❌ | Empty for 141,497 rows |
| tags_json | String | 100% ✅ | JSON array of tags (may be empty) |
| closed | UInt8 | 100% ✅ | 0 = open, 1 = closed |
| archived | UInt8 | 100% ✅ | 0 = active, 1 = archived |
| fetched_at | DateTime | 100% ✅ | Data fetch timestamp |

### Data Quality

**EXCELLENT**:
- ✅ **question**: 100% - best source for market titles
- ✅ **description**: 100% - best source for context
- ✅ **outcomes_json**: 100% - reliable outcome structure

**ISSUES**:
- ❌ **category**: 94% empty (141,497 rows) - very sparse
- ⚠️ **end_date**: 1% missing (1,919 rows)

### Recommended Use

**Best for**:
- Market title display (100% coverage)
- Market descriptions (100% coverage)
- Outcome labels (100% coverage)

**Join pattern**:
```sql
SELECT
  t.condition_id,
  g.question,
  g.description
FROM trades_raw t
INNER JOIN gamma_markets g
  ON lower(replaceAll(t.condition_id, '0x', '')) = lower(replaceAll(g.condition_id, '0x', ''))
WHERE length(replaceAll(t.condition_id, '0x', '')) = 64
```

---

## Table 3: api_markets_staging

**Purpose**: Polymarket Data API snapshot (live market data)
**Rows**: 161,180
**Primary Key**: `condition_id`

### Schema

| Column | Type | Coverage | Notes |
|--------|------|----------|-------|
| condition_id | String | 100% ✅ | Condition ID (normalized) |
| market_slug | String | 100% ✅ | URL-friendly market identifier |
| question | String | 100% ✅ | Market question |
| description | String | 100% ✅ | Full description |
| outcomes | Array(String) | 100% ✅ | Outcome labels |
| active | Bool | 100% ✅ | Trading is active |
| closed | Bool | 100% ✅ | Market closed (no more trades) |
| resolved | Bool | 100% ✅ | Market resolved (outcome decided) |
| winning_outcome | UInt8 | 0% ❌ | Nullable, all NULL (not populated) |
| end_date | DateTime | 99% ⚠️ | Nullable, 1,087 missing |
| volume | Float64 | 100% ✅ | Total trading volume |
| liquidity | Float64 | 100% ✅ | Current liquidity |
| timestamp | DateTime | 100% ✅ | Last update time |

### Data Quality

**EXCELLENT**:
- ✅ All core fields 100% populated (question, description, outcomes, status)
- ✅ Volume/liquidity 100% coverage
- ✅ Market slug 100% (useful for URLs)

**ISSUES**:
- ❌ **winning_outcome**: 100% NULL - use market_resolutions_final instead
- ⚠️ **end_date**: 1% missing (1,087 rows)

### Recommended Use

**Best for**:
- Market status checks (active, closed, resolved)
- Volume/liquidity analytics
- Market slugs for URL generation
- Recent market snapshots

**Join pattern**:
```sql
SELECT
  t.condition_id,
  a.question,
  a.active,
  a.closed,
  a.resolved
FROM trades_raw t
INNER JOIN api_markets_staging a
  ON lower(replaceAll(t.condition_id, '0x', '')) = a.condition_id
WHERE length(replaceAll(t.condition_id, '0x', '')) = 64
```

---

## Comparison Matrix

| Feature | dim_markets | gamma_markets | api_markets_staging |
|---------|-------------|---------------|---------------------|
| **Rows** | 318,535 | 149,907 | 161,180 |
| **Question** | 44% ❌ | 100% ✅ | 100% ✅ |
| **Description** | 51% ⚠️ | 100% ✅ | 100% ✅ |
| **Category** | 1% ❌ | 6% ❌ | N/A |
| **Market ID** | 48% ❌ | N/A | N/A |
| **Slug** | N/A | N/A | 100% ✅ |
| **Volume** | 100% ✅ | N/A | 100% ✅ |
| **Status** | Closed only | Closed+Archived | Active+Closed+Resolved ✅ |
| **Resolutions** | 42% ⚠️ | N/A | 0% ❌ |

---

## Recommended Strategy

### For Market Display (Question/Description):
1. **Primary**: gamma_markets (100% coverage, 150K markets)
2. **Fallback**: api_markets_staging (100% coverage, 161K markets)
3. **Avoid**: dim_markets (44% coverage)

### For Market Status:
1. **Best**: api_markets_staging (active, closed, resolved)
2. **Alternative**: gamma_markets (closed, archived)

### For Volume/Liquidity:
1. **Primary**: dim_markets or api_markets_staging (100% coverage)

### For Resolutions:
1. **Use**: market_resolutions_final table (not these metadata tables)
2. **Reason**: dim_markets has 58% gap, api_markets_staging has 100% NULL

---

## Join Recommendations

### Safe Join (Maximizes Coverage):

```sql
SELECT
  t.wallet,
  lower(replaceAll(t.condition_id, '0x', '')) as cid_norm,
  COALESCE(g.question, a.question, 'Unknown') as question,
  COALESCE(g.description, a.description, '') as description,
  a.active,
  a.closed,
  a.resolved
FROM trades_raw t
LEFT JOIN gamma_markets g
  ON lower(replaceAll(t.condition_id, '0x', '')) = lower(replaceAll(g.condition_id, '0x', ''))
LEFT JOIN api_markets_staging a
  ON lower(replaceAll(t.condition_id, '0x', '')) = a.condition_id
WHERE length(replaceAll(t.condition_id, '0x', '')) = 64
```

### Performance Join (Smaller Table First):

```sql
-- Use gamma_markets (150K rows) as primary
SELECT
  t.*,
  g.question,
  g.description
FROM trades_raw t
INNER JOIN gamma_markets g
  ON lower(replaceAll(t.condition_id, '0x', '')) = lower(replaceAll(g.condition_id, '0x', ''))
WHERE length(replaceAll(t.condition_id, '0x', '')) = 64
```

---

## Backfill Priorities

### HIGH PRIORITY:
1. **dim_markets.question** (179K missing) - critical for display
2. **dim_markets.market_id** (167K missing) - blocks integrations

### MEDIUM PRIORITY:
3. **dim_markets.category** (314K missing) - useful for filtering
4. **gamma_markets.category** (141K missing) - useful for filtering

### LOW PRIORITY:
5. **dim_markets.event_id** (318K missing) - feature not used yet
6. **api_markets_staging.winning_outcome** (161K NULL) - use market_resolutions_final instead

---

## See Also

- `docs/reference/query-filters-token-exclusion.md` - Token filter pattern
- `HANDOFF_CLAUDE1_TO_CLAUDE2.md` - Database status and fixes
- `reports/sessions/2025-11-10-session-1.md` - Repair session details
