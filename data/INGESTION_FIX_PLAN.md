# Market ID Ingestion Fix Plan

**Last Updated:** October 27, 2025
**Status:** 🔴 CRITICAL - 86% of trades missing market_id
**Priority:** #1 Blocker for Full P&L Coverage

---

## Executive Summary

**The Problem:** 86% of trades in `trades_raw` (2.1M out of 2.5M) have missing or invalid `market_id`. This caps wallet coverage at ~11% and completely blocks category-level P&L attribution.

**Root Cause:** The data ingestion pipeline writes trades with only `condition_id`, never resolving `condition_id → market_id` at insert time.

**Impact:**
- Wallet P&L coverage stuck at 2-35% (should be >90%)
- Category attribution impossible (can't map trades to Sports/Politics/Crypto)
- Trust scores unreliable (based on incomplete data)
- 42,421 distinct conditions need external API lookup

**Solution:** Fix ingestion pipeline to populate `market_id` at insert time using Polymarket API lookups with caching.

---

## Current State Analysis

### Data Quality Metrics

```
Total trades:                 2,455,151
Missing market_id:            2,109,192 (85.91%)
Valid market_id:                345,959 (14.09%)

Distinct conditions:            46,095
Conditions missing market_id:   44,047 (95.56%)
Conditions with market_id:       2,048 (4.44%)
```

### Backfill Analysis Results

**Local Sources Checked:**
- `data/markets_dim_seed.json`: 4,961 mappings
- `data/expanded_resolution_map.json`: 2,858 mappings
- **Total unique mappings:** 6,620

**Backfill Outcome:**
- **Conditions recoverable from local sources:** 1,626
- **Recovery rate:** 3.69%
- **⚠️ Critical:** All 1,626 "recoverable" mappings have `market_id: "unknown"` (not real IDs)
- **Actual recovery rate:** 0%

**Remaining Work:**
- **42,421 conditions** need external Polymarket API lookups
- **96%+ of missing conditions** cannot be backfilled without API calls

---

## Why This Is Our #1 Blocker

### 1. Coverage Ceiling

**Current:** Only 11% of conditions have valid `market_id`
**Impact:** Wallet coverage capped at 2-35% even for best wallets
**Target:** >95% coverage after fix

### 2. Category Attribution Blocked

**Problem:**
```
condition_id → market_id → event_id → category
     ❌              ❌           ✅           ✅
```

Without `market_id`, we cannot:
- Map trades to categories (Sports, Politics, Crypto)
- Calculate per-category win rates
- Filter signals by category
- Build category-specific trust scores

### 3. Event/Market Metadata Lost

**Missing Data:**
- Market titles/questions
- Event associations
- Resolution dates
- Market quality scores

### 4. Wallet Trust Scores Unreliable

**Example:**
- Wallet shows 6.77% coverage
- Actual: has 100+ trades, we can only see 7
- Trust score based on 7 trades is meaningless

---

## Root Cause: Ingestion Pipeline Gap

### Current Ingestion Flow (BROKEN)

```
Blockchain Event / Polymarket Fill
           ↓
    Extract Data:
      - condition_id ✅
      - wallet_address ✅
      - side ✅
      - shares ✅
      - entry_price ✅
      - timestamp ✅
      - market_id ❌ (missing or 'unknown')
           ↓
    INSERT INTO trades_raw
           ↓
    85% of trades have no market_id
```

### Why market_id Is Missing

**Hypothesis 1: Data Source Limitation**
- Blockchain events only contain `condition_id` (contract-level identifier)
- Polymarket's fill events may not include `market_id` (platform-level identifier)
- Ingestion pulls directly from blockchain without enrichment

**Hypothesis 2: API Response Structure**
- Polymarket's fills API may return `condition_id` but not `market_id`
- No validation step to ensure `market_id` exists before insert

**Hypothesis 3: Legacy Design**
- Original ETL assumed `market_id` would always be present
- When it wasn't, wrote '' or 'unknown' instead of failing/logging

---

## Solution: Fix Ingestion Pipeline

### Phase 1: Immediate Fix (Forward-Looking)

**Goal:** Ensure all NEW trades get valid `market_id` at insert time

#### 1.1 Add Lookup Step Before Insert

```typescript
// BEFORE (Current - BROKEN)
async function ingestTrade(fill: PolymarketFill) {
  await db.insert('trades_raw', {
    condition_id: fill.conditionId,
    wallet_address: fill.wallet,
    side: fill.side,
    shares: fill.shares / 128,
    entry_price: fill.price,
    timestamp: fill.timestamp,
    market_id: fill.marketId || 'unknown' // ❌ Often 'unknown'
  })
}

// AFTER (Fixed - CORRECT)
async function ingestTrade(fill: PolymarketFill) {
  let marketId = fill.marketId

  // If market_id missing, look it up
  if (!marketId || marketId === 'unknown' || marketId === '') {
    marketId = await resolveMarketId(fill.conditionId)
  }

  // Still missing after lookup? Log and mark for retry
  if (!marketId) {
    await logFailedLookup(fill.conditionId, 'market_id_not_found')
    marketId = 'pending_lookup' // NOT 'unknown'
  }

  await db.insert('trades_raw', {
    condition_id: fill.conditionId,
    wallet_address: fill.wallet,
    side: fill.side,
    shares: fill.shares / 128,
    entry_price: fill.price,
    timestamp: fill.timestamp,
    market_id: marketId // ✅ Always valid or 'pending_lookup'
  })
}
```

#### 1.2 Implement resolveMarketId() with Caching

```typescript
// In-memory cache (Redis in production)
const marketIdCache = new Map<string, string>()

async function resolveMarketId(conditionId: string): Promise<string | null> {
  // 1. Check cache first (avoid API calls)
  if (marketIdCache.has(conditionId)) {
    return marketIdCache.get(conditionId)!
  }

  // 2. Check local mapping tables
  const localMapping = await db.query(`
    SELECT market_id FROM markets_dim WHERE condition_id = ?
  `, [conditionId])

  if (localMapping && localMapping.market_id !== 'unknown') {
    marketIdCache.set(conditionId, localMapping.market_id)
    return localMapping.market_id
  }

  // 3. Call Polymarket API
  try {
    const response = await fetch(
      `https://gamma-api.polymarket.com/markets?condition_id=${conditionId}`,
      { timeout: 5000 }
    )

    if (response.ok) {
      const market = await response.json()
      const marketId = market.id || market.market_id

      if (marketId) {
        // Cache for 30 days (markets don't change after creation)
        marketIdCache.set(conditionId, marketId)
        await db.insert('condition_to_market_cache', {
          condition_id: conditionId,
          market_id: marketId,
          cached_at: new Date()
        })
        return marketId
      }
    }
  } catch (error) {
    console.error(`Failed to resolve market_id for ${conditionId}:`, error)
  }

  return null
}
```

#### 1.3 Create Persistent Cache Table

```sql
-- ClickHouse cache table
CREATE TABLE IF NOT EXISTS condition_to_market_cache (
  condition_id String,
  market_id String,
  cached_at DateTime,
  last_verified DateTime DEFAULT now()
) ENGINE = MergeTree()
ORDER BY (condition_id)
TTL cached_at + INTERVAL 30 DAY;

-- Index for fast lookups
ALTER TABLE condition_to_market_cache
  ADD INDEX idx_condition condition_id TYPE bloom_filter(0.01) GRANULARITY 1;
```

#### 1.4 Failed Lookup Logging

```typescript
async function logFailedLookup(
  conditionId: string,
  reason: 'api_404' | 'api_timeout' | 'api_error' | 'market_id_not_found'
) {
  // Write to JSONL for analysis
  const logEntry = {
    timestamp: new Date().toISOString(),
    condition_id: conditionId,
    reason,
    retry_count: 0
  }

  fs.appendFileSync(
    'runtime/failed_market_id_lookups.jsonl',
    JSON.stringify(logEntry) + '\n'
  )
}
```

---

### Phase 2: Backfill Historical Data

**Goal:** Fix the 2.1M trades already in `trades_raw`

#### 2.1 Batch Lookup Script (Already Created)

**Script:** `scripts/backfill-market-ids.ts`
**Status:** ✅ Complete (read-only analysis done)

**Results:**
- Identified 44,047 conditions needing lookup
- Only 1,626 recoverable from local sources (but all have `market_id: 'unknown'`)
- **42,421 conditions** need external API lookups

#### 2.2 Batch API Lookup Job

**New Script Needed:** `scripts/batch-lookup-missing-market-ids.ts`

```typescript
/**
 * Batch lookup missing market_ids from Polymarket API
 *
 * Process:
 * 1. Load backfilled_market_ids.json
 * 2. For each condition_id in still_missing_condition_ids:
 *    - Call Polymarket API: /markets?condition_id={cid}
 *    - Extract market_id if found
 *    - Cache result
 * 3. Write results to market_id_lookup_results.json
 * 4. Generate UPDATE SQL statements
 *
 * Rate Limiting:
 * - 100 requests/min (Polymarket limit)
 * - 5 parallel workers
 * - 1.2s delay between requests
 * - Estimated time: 42,421 ÷ 5 ÷ 50 = ~170 minutes (~3 hours)
 */
```

**Key Features:**
- Checkpoint saves every 1,000 lookups (resume if interrupted)
- Exponential backoff on API errors
- Cache successful lookups to avoid re-querying
- Generate SQL UPDATE statements for ClickHouse

#### 2.3 Apply Backfill to ClickHouse

```sql
-- After batch lookup completes, apply updates
-- (Generated by batch-lookup-missing-market-ids.ts)

-- Example:
UPDATE trades_raw
SET market_id = '537888'
WHERE condition_id = '0x640938ae...'
  AND (market_id = '' OR market_id = 'unknown' OR market_id = 'pending_lookup');

-- Repeat for all 42,421 conditions
-- Use batch UPDATEs (1,000 at a time) for performance
```

#### 2.4 Verify Backfill Results

```sql
-- Check coverage after backfill
SELECT
  COUNT(*) as total_trades,
  SUM(CASE WHEN market_id NOT IN ('', 'unknown', 'pending_lookup') THEN 1 ELSE 0 END) as with_market_id,
  (SUM(CASE WHEN market_id NOT IN ('', 'unknown', 'pending_lookup') THEN 1 ELSE 0 END) * 100.0 / COUNT(*)) as coverage_pct
FROM trades_raw;

-- Expected after backfill: >95% coverage
```

---

### Phase 3: Continuous Monitoring

**Goal:** Ensure this never happens again

#### 3.1 Daily Health Check

**Script:** `scripts/check-market-id-coverage.ts`

```typescript
/**
 * Daily health check for market_id coverage
 *
 * Checks:
 * 1. % of trades with valid market_id (target: >95%)
 * 2. # of new 'pending_lookup' entries (should be <1% of daily volume)
 * 3. Failed lookup log size (should not grow continuously)
 *
 * Alerts:
 * - If coverage drops below 90%: PAGE INFRA TEAM
 * - If pending_lookup > 5% of daily trades: INVESTIGATE API ISSUES
 * - If failed_lookups growing >100/day: CHECK POLYMARKET API CHANGES
 */
```

#### 3.2 Dashboard Metrics

**Add to monitoring dashboard:**

```
Market ID Coverage
==================
Total trades:              2,455,151
With valid market_id:      2,331,394 (95.0%) ✅
Missing market_id:           123,757 (5.0%)  ⚠️

Today's Ingestion
==================
Trades ingested:              12,450
Got market_id immediately:    11,935 (95.9%) ✅
Resolved via API:                487 (3.9%)  ✅
Still pending:                    28 (0.2%)  ✅
```

#### 3.3 Automated Retry Job (Daily Cron)

```typescript
/**
 * Daily batch job: Retry pending lookups
 *
 * SELECT DISTINCT condition_id
 * FROM trades_raw
 * WHERE market_id = 'pending_lookup'
 *
 * For each:
 * - Retry Polymarket API lookup
 * - If found: UPDATE trades_raw
 * - If still missing: Increment retry_count
 * - If retry_count > 7: Mark as 'lookup_failed' (stop retrying)
 */
```

---

## Expected Outcomes

### Immediate (After Phase 1)

✅ All NEW trades get valid `market_id` at insert time
✅ <1% of new trades require async lookup
✅ Failed lookups logged for investigation
✅ No more 'unknown' market_ids written

### Short-Term (After Phase 2)

✅ 2.1M historical trades backfilled with market_ids
✅ Coverage rises from 14% to >95%
✅ Category attribution unlocked
✅ Wallet coverage jumps from 2-35% to >90%

### Long-Term (After Phase 3)

✅ Sustained >95% market_id coverage
✅ Automated monitoring catches regressions
✅ Failed lookups handled gracefully
✅ Full category-level P&L attribution at scale

---

## Implementation Timeline

| Phase | Task | Duration | Owner | Status |
|-------|------|----------|-------|--------|
| 1.1 | Add lookup step to ingestion | 2 days | Infra | ⏳ Not started |
| 1.2 | Implement caching layer | 1 day | Infra | ⏳ Not started |
| 1.3 | Create cache table | 1 hour | Infra | ⏳ Not started |
| 1.4 | Failed lookup logging | 2 hours | Infra | ⏳ Not started |
| **Phase 1 Total** | **Forward fix** | **3 days** | | |
| 2.1 | Backfill analysis | - | Data | ✅ Complete |
| 2.2 | Batch API lookup script | 1 day | Data | ⏳ Not started |
| 2.3 | Run batch lookup (42K conditions) | 3 hours | Data | ⏳ Not started |
| 2.4 | Apply backfill to ClickHouse | 1 hour | Data | ⏳ Not started |
| 2.5 | Verify backfill results | 1 hour | Data | ⏳ Not started |
| **Phase 2 Total** | **Historical backfill** | **2 days** | | |
| 3.1 | Daily health check script | 4 hours | Data | ⏳ Not started |
| 3.2 | Dashboard metrics | 2 hours | Frontend | ⏳ Not started |
| 3.3 | Automated retry job | 4 hours | Infra | ⏳ Not started |
| **Phase 3 Total** | **Monitoring** | **2 days** | | |
| **TOTAL** | | **7 days** | | |

---

## Risk & Mitigation

### Risk 1: Polymarket API Rate Limits

**Risk:** Batch lookup of 42K conditions could hit rate limits
**Mitigation:**
- Use 5 parallel workers max (stays under 100 req/min limit)
- Implement exponential backoff on 429 errors
- Spread lookups over 3 hours (not all at once)
- Cache aggressively to avoid re-lookups

### Risk 2: Some Conditions May Not Have market_id

**Risk:** Polymarket API may not return market_id for some condition_ids
**Mitigation:**
- Accept that some conditions are unresolvable
- Mark as 'lookup_failed' after 7 retries
- Focus on maximizing coverage (target >95%, not 100%)
- Document unresolvable conditions for investigation

### Risk 3: Ingestion Pipeline Not Identified

**Risk:** We don't know where trades are currently inserted
**Mitigation:**
- Search codebase for "INSERT INTO trades_raw"
- Check ETL pipeline documentation
- Interview team members who built ingestion
- Worst case: instrument ClickHouse query logs to find INSERT source

### Risk 4: Backfill May Take Longer Than Expected

**Risk:** 3-hour estimate for 42K lookups could be optimistic
**Mitigation:**
- Implement checkpoint saves (resume if interrupted)
- Run during off-peak hours (weekend)
- Monitor progress and adjust worker count if needed
- Be prepared for 6-8 hour run time

---

## Success Criteria

✅ **Forward Ingestion:** <1% of new trades have `market_id = 'pending_lookup'`
✅ **Historical Backfill:** >95% of trades have valid market_id
✅ **Category Attribution:** Wallet category breakdown shows non-zero categories
✅ **Wallet Coverage:** Top wallets show >80% coverage_pct
✅ **Monitoring:** Daily health check runs successfully for 7 days

---

## Next Actions (Priority Order)

1. **Create batch lookup script:** `scripts/batch-lookup-missing-market-ids.ts`
2. **Run batch lookup:** Fetch market_ids for 42,421 conditions (~3 hours)
3. **Apply backfill:** UPDATE trades_raw with discovered market_ids
4. **Verify results:** Run coverage check, expect >95%
5. **Identify ingestion pipeline:** Find where trades are inserted
6. **Implement Phase 1:** Add lookup step to ingestion code
7. **Deploy forward fix:** Ensure all NEW trades get market_id
8. **Implement Phase 3:** Monitoring and automated retry

---

## References

- **Backfill Analysis:** `data/backfilled_market_ids.json`
- **Backfill Script:** `scripts/backfill-market-ids.ts`
- **Current Coverage:** 14.09% (345,959 out of 2,455,151 trades)
- **Target Coverage:** >95% (2,331,000+ trades)
- **API Endpoint:** `https://gamma-api.polymarket.com/markets?condition_id={cid}`

---

**Document Status:** ✅ Complete
**Last Updated:** October 27, 2025
**Owner:** Data Team
**Review Date:** November 3, 2025
