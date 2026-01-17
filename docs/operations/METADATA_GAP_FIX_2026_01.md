# Metadata Gap Fix - January 2026

## Problem

The UI was showing **67,514 "Unknown Market"** labels because the `pm_market_metadata` table only contained 200,769 markets while the Gamma API had 400k+ markets.

## Root Cause

`scripts/ingest-market-metadata.ts` had a hardcoded **200k safety limit** (line 544) that stopped pagination early:

```typescript
if (totalInserted + batchBuffer.length > 200000) {
  console.log(`   ⚠️  Safety limit reached (200k markets)`);
  break;  // STOPPED HERE
}
```

## Solution

### 1. Increased Safety Limit (200k → 500k)

```typescript
if (totalInserted + batchBuffer.length > 500000) {
  console.log(`   ⚠️  Safety limit reached (500k markets)`);
  break;
}
```

### 2. Changed to Newest-First Fetch Order

Added `&order=id&ascending=false` to prioritize recent markets:

```typescript
const url = `${CONFIG.API_URL}?limit=${limit}&offset=${offset}&order=id&ascending=false`;
```

### 3. Changed to Additive Mode (No DROP TABLE)

The script now uses `CREATE TABLE IF NOT EXISTS` instead of dropping and recreating. ReplacingMergeTree handles duplicates automatically.

## Results

| Metric | Before | After |
|--------|--------|-------|
| Markets | 200,769 | 417,298 |
| Tokens | 412,462 | 1,365,610 |
| Unmapped (30d) | 67,514 | 0 |
| Coverage | ~60% | 100% |

## Commits

1. `73f145a` - refactor: change token map rebuild to additive mode
2. `e1105b6` - refactor: change metadata sync to newest-first with additive mode

## Cron Jobs

The following crons keep metadata in sync:

- **`sync-metadata`** - Runs every 30 min, fetches newest 1000 markets
- **`rebuild-token-map`** - Runs every 6 hours, adds new tokens to V5 map
- **`fix-unmapped-tokens`** - Runs daily, patches any gaps via API lookup

## Verification

```sql
-- Check unmapped tokens (should be 0)
SELECT count(DISTINCT t.token_id) as unmapped
FROM pm_trader_events_v2 t
LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
WHERE m.token_id_dec IS NULL AND t.is_deleted = 0 AND t.trade_time >= now() - INTERVAL 30 DAY;

-- Check metadata count
SELECT count() FROM pm_market_metadata;

-- Check token map count
SELECT count() FROM pm_token_to_condition_map_v5;
```

## Prevention

- Safety limit now at 500k (enough headroom for growth)
- Additive mode prevents accidental data loss
- Newest-first ordering ensures recent markets are always captured
- Cron jobs provide continuous sync
