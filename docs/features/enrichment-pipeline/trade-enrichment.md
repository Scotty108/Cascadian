# Trade Enrichment Pipeline

## Overview

The trade enrichment pipeline solves a critical data gap in the analytics system: raw trade data enters ClickHouse with basic fields but lacks the calculated metrics needed for wallet scoring and analytics.

## The Problem

**What sync scripts populate:**
- `trade_id`, `wallet_address`, `market_id`, `condition_id`
- `timestamp`, `side`, `entry_price`, `shares`, `usd_value`
- `transaction_hash`, `created_at`

**What they DON'T populate (critical for metrics):**
- `outcome` (1 = YES won, 0 = NO won, NULL = unresolved)
- `is_closed` (boolean)
- `close_price` (YES price at resolution)
- `pnl_gross` (P&L before fees)
- `pnl_net` (P&L after fees)
- `hours_held` (duration from entry to exit/resolution)
- `return_pct` (return as % of capital)
- `fee_usd` (transaction fees)

Without these fields, we cannot calculate:
- Omega scores
- Win rates
- Sharpe ratios
- P&L metrics
- Any wallet analytics

## The Solution

The enrichment pipeline (`scripts/enrich-trades.ts`) fills this gap by:

1. **Fetching market resolutions** from Supabase `markets` table
2. **Matching trades to markets** by `condition_id`
3. **Calculating all metric fields** based on market outcomes
4. **Updating ClickHouse** in efficient batches

## Architecture

```
┌─────────────────┐
│   Supabase      │
│   markets       │
│   (resolved)    │
└────────┬────────┘
         │
         │ 1. Fetch resolved markets
         │    with outcomes & prices
         ▼
┌─────────────────────────────────────────┐
│  Trade Enrichment Pipeline              │
│                                         │
│  • Match by condition_id                │
│  • Calculate outcome (won/lost)         │
│  • Calculate P&L (gross & net)          │
│  • Calculate fees                       │
│  • Calculate hours held                 │
│  • Calculate return %                   │
└────────┬────────────────────────────────┘
         │
         │ 2. Batch UPDATE queries
         │    (10k trades per batch)
         ▼
┌─────────────────┐
│   ClickHouse    │
│   trades_raw    │
│   (enriched)    │
└─────────────────┘
```

## Data Flow

### Input: Raw Trade
```json
{
  "trade_id": "0x123...",
  "wallet_address": "0xabc...",
  "market_id": "market_123",
  "condition_id": "0xdef...",
  "timestamp": 1698765432,
  "side": "YES",
  "entry_price": 0.65,
  "shares": 100,
  "usd_value": 65.00,
  "outcome": null,           // ← NULL
  "pnl_net": 0,              // ← 0
  "is_closed": false         // ← false
}
```

### Processing: Market Resolution
```json
{
  "market_id": "market_123",
  "condition_id": "0xdef...",
  "closed": true,
  "current_price": 1.0,      // ← YES won (price = $1)
  "end_date": "2024-11-01T12:00:00Z",
  "raw_polymarket_data": {
    "resolvedOutcome": 1     // ← 1 = YES won
  }
}
```

### Output: Enriched Trade
```json
{
  "trade_id": "0x123...",
  "wallet_address": "0xabc...",
  "market_id": "market_123",
  "condition_id": "0xdef...",
  "timestamp": 1698765432,
  "side": "YES",
  "entry_price": 0.65,
  "shares": 100,
  "usd_value": 65.00,
  "outcome": 1,              // ← 1 (YES won, trade won)
  "is_closed": true,         // ← true
  "close_price": 1.0,        // ← Final YES price
  "pnl_gross": 35.00,        // ← (100 * $1) - $65 = $35
  "pnl_net": 33.70,          // ← $35 - (2% fees) = $33.70
  "fee_usd": 1.30,           // ← 2% of $65
  "hours_held": 72.5,        // ← 3 days
  "return_pct": 51.85        // ← ($33.70 / $65) * 100 = 51.85%
}
```

## Calculation Logic

### Outcome Determination

```typescript
function calculateOutcome(market: ResolvedMarket, tradeSide: 'YES' | 'NO'): number | null {
  // Priority 1: Explicit outcome from Polymarket API
  if (market.raw_polymarket_data?.resolvedOutcome !== undefined) {
    const resolvedOutcome = market.raw_polymarket_data.resolvedOutcome
    // resolvedOutcome: 0 = NO won, 1 = YES won
    if (resolvedOutcome === 1) {
      return tradeSide === 'YES' ? 1 : 0  // YES trade won if YES won
    } else {
      return tradeSide === 'NO' ? 1 : 0   // NO trade won if NO won
    }
  }

  // Priority 2: Infer from final price
  const finalPrice = market.current_price
  if (finalPrice >= 0.98) {
    // YES won (price settled at ~$1.00)
    return tradeSide === 'YES' ? 1 : 0
  } else if (finalPrice <= 0.02) {
    // NO won (price settled at ~$0.00)
    return tradeSide === 'NO' ? 1 : 0
  }

  // Ambiguous - skip for now
  return null
}
```

### P&L Calculation

For binary outcome markets where winners get $1 per share:

```typescript
function calculatePnL(
  side: 'YES' | 'NO',
  outcome: number,
  shares: number,
  entryPrice: number,
  usdValue: number
) {
  let pnl_gross = 0

  if (outcome === 1) {
    // Trade won - get $1 per share
    // Profit = shares_value_at_resolution - amount_paid
    pnl_gross = shares - usdValue
  } else {
    // Trade lost - lose entire investment
    pnl_gross = -usdValue
  }

  // Fees (2% assumption)
  const fee_usd = usdValue * 0.02

  // Net P&L
  const pnl_net = pnl_gross - fee_usd

  // Return percentage
  const return_pct = (pnl_net / usdValue) * 100

  return { pnl_gross, pnl_net, fee_usd, return_pct }
}
```

**Example 1: Winning Trade**
- Buy 100 YES shares at $0.65 = $65 invested
- Market resolves YES (outcome = 1)
- Get 100 × $1.00 = $100
- Gross P&L = $100 - $65 = $35
- Fees = $65 × 2% = $1.30
- Net P&L = $35 - $1.30 = $33.70
- Return = ($33.70 / $65) × 100 = 51.85%

**Example 2: Losing Trade**
- Buy 100 NO shares at $0.35 = $35 invested
- Market resolves YES (outcome = 0 for NO trades)
- Get 100 × $0.00 = $0
- Gross P&L = -$35
- Fees = $35 × 2% = $0.70
- Net P&L = -$35 - $0.70 = -$35.70
- Return = (-$35.70 / $35) × 100 = -102%

### Hours Held

```typescript
function calculateHoursHeld(tradeTimestamp: number, resolutionDate: string): number {
  const tradeDate = new Date(tradeTimestamp * 1000)
  const resolveDate = new Date(resolutionDate)
  const diffMs = resolveDate.getTime() - tradeDate.getTime()
  return diffMs / (1000 * 60 * 60) // Convert to hours
}
```

## Usage

### Basic Usage

```bash
# Enrich all trades
npx tsx scripts/enrich-trades.ts
```

### Testing Mode

```bash
# Process first 1,000 trades (for testing)
npx tsx scripts/enrich-trades.ts --limit 1000
```

### Single Market

```bash
# Enrich trades for a specific market
npx tsx scripts/enrich-trades.ts --condition-id 0x1234567890abcdef...
```

### Help

```bash
npx tsx scripts/enrich-trades.ts --help
```

## Performance

- **Batch size**: 10,000 trades per fetch batch
- **Update batch size**: 5,000 trades per UPDATE query
- **Rate**: ~1,000-2,000 trades/sec (depending on ClickHouse performance)
- **Memory**: Processes in streaming batches, low memory footprint
- **Idempotent**: Safe to re-run (only updates trades where `outcome IS NULL`)

## Output Example

```
═══════════════════════════════════════════════════════════
           TRADE ENRICHMENT PIPELINE
═══════════════════════════════════════════════════════════

📡 Fetching resolved markets from Supabase...
✅ Fetched 1,247 resolved markets
📊 Indexed 1,247 markets by condition_id

📡 Fetching trades to enrich from ClickHouse...
✅ Found 45,823 trades to enrich

🔄 Processing in batches of 10,000...

[Batch 1/5] Processing 10,000 trades...
   💾 [1/2] Updating 5,000 trades in ClickHouse...
   ✅ Batch 1/2 updated successfully
   💾 [2/2] Updating 5,000 trades in ClickHouse...
   ✅ Batch 2/2 updated successfully

📊 Progress Report:
   Processed: 10,000/45,823 trades
   Enriched: 9,234
   Skipped (no market): 523
   Skipped (unresolved): 243
   Errors: 0
   Rate: 1,847.2 trades/sec
   Elapsed: 5s
   ETA: 19s

[... continues for all batches ...]

🔍 Verifying enrichment...

📊 Enrichment Statistics:
   Total trades: 150,000
   Enriched trades: 45,234
   Winning trades: 23,456
   Losing trades: 21,778
   Average P&L: $12.34
   Total P&L: $558,234.56

📋 Sample Enriched Trades:
┌─────────┬──────────────────┬──────┬─────────────┬─────────┬──────────┬────────────┬────────────┐
│ trade_id│ wallet_address   │ side │ entry_price │ outcome │ pnl_net  │ return_pct │ hours_held │
├─────────┼──────────────────┼──────┼─────────────┼─────────┼──────────┼────────────┼────────────┤
│ 0x123...│ 0xabc...         │ YES  │ 0.65        │ 1       │ 33.70    │ 51.85      │ 72.5       │
│ 0x456...│ 0xdef...         │ NO   │ 0.35        │ 0       │ -35.70   │ -102.00    │ 48.2       │
└─────────┴──────────────────┴──────┴─────────────┴─────────┴──────────┴────────────┴────────────┘

═══════════════════════════════════════════════════════════
                     SUMMARY
═══════════════════════════════════════════════════════════

✅ Total trades processed: 45,823
✅ Successfully enriched: 45,234 (98.7%)
⚠️  Skipped (no market): 523
⚠️  Skipped (unresolved): 66
❌ Errors: 0
⏱️  Total time: 24s

📊 Next steps:
   1. Verify data: npx tsx scripts/verify-clickhouse-data.ts
   2. Calculate metrics: npx tsx scripts/calculate-wallet-metrics.ts
   3. Test queries: SELECT * FROM trades_raw WHERE outcome IS NOT NULL LIMIT 10
```

## Integration with Analytics Pipeline

### Before Enrichment
```sql
-- ❌ This query returns wrong results
SELECT
  wallet_address,
  COUNT(*) as trades,
  SUM(pnl_net) as total_pnl,           -- ← All zeros!
  AVG(return_pct) as avg_return        -- ← All zeros!
FROM trades_raw
GROUP BY wallet_address
```

### After Enrichment
```sql
-- ✅ This query returns accurate metrics
SELECT
  wallet_address,
  COUNT(*) as trades,
  SUM(pnl_net) as total_pnl,           -- ← Real P&L data
  AVG(return_pct) as avg_return,       -- ← Real returns
  COUNTIF(outcome = 1) / COUNT(*) as win_rate,
  SUM(CASE WHEN pnl_net > 0 THEN pnl_net ELSE 0 END) /
    SUM(CASE WHEN pnl_net <= 0 THEN ABS(pnl_net) ELSE 0 END) as omega_ratio
FROM trades_raw
WHERE outcome IS NOT NULL
GROUP BY wallet_address
```

## Maintenance

### Re-running Enrichment

The pipeline is **idempotent** - it only enriches trades where `outcome IS NULL`:

```bash
# Safe to re-run - will only process unenriched trades
npx tsx scripts/enrich-trades.ts
```

### Continuous Updates

For ongoing market resolutions, run the enrichment periodically:

```bash
# Cron job (daily at 2 AM)
0 2 * * * cd /path/to/app && npx tsx scripts/enrich-trades.ts
```

### Verification Query

Check enrichment status:

```sql
SELECT
  COUNT(*) as total_trades,
  COUNTIF(outcome IS NOT NULL) as enriched,
  COUNTIF(outcome IS NULL) as pending,
  ROUND(COUNTIF(outcome IS NOT NULL) * 100.0 / COUNT(*), 2) as pct_enriched
FROM trades_raw
```

## Error Handling

### Skipped Trades

Trades are skipped if:
1. **No market found** - `condition_id` doesn't match any market in Supabase
2. **Unresolved market** - Market is closed but outcome is ambiguous
3. **Invalid data** - Missing required fields

These trades remain with `outcome IS NULL` and can be retried later.

### Recovery

If enrichment fails mid-batch:

```bash
# Resume from where it left off (only enriches unenriched trades)
npx tsx scripts/enrich-trades.ts
```

## Schema Dependencies

This pipeline requires:

### ClickHouse Schema
- `migrations/clickhouse/001_create_trades_table.sql` - Base table
- `migrations/clickhouse/002_add_metric_fields.sql` - Metric columns
- `migrations/clickhouse/003_add_condition_id.sql` - Condition ID for joins

### Supabase Schema
- `markets` table with:
  - `condition_id` (for matching)
  - `closed` (resolution status)
  - `current_price` (final price)
  - `end_date` (resolution timestamp)
  - `raw_polymarket_data` (resolved outcome)

## Performance Tuning

### ClickHouse Optimization

```sql
-- Ensure condition_id index exists
ALTER TABLE trades_raw
  ADD INDEX IF NOT EXISTS idx_condition_id (condition_id)
  TYPE bloom_filter(0.01) GRANULARITY 1;

-- Optimize table after enrichment
OPTIMIZE TABLE trades_raw FINAL;
```

### Batch Size Tuning

Adjust batch sizes in the script for your environment:

```typescript
const BATCH_SIZE = 10000              // Trades fetched per batch
const CLICKHOUSE_BATCH_SIZE = 5000    // Trades updated per query
```

Smaller batches = slower but safer
Larger batches = faster but more memory

## Related Scripts

- `scripts/sync-wallet-trades.ts` - Ingests raw trade data
- `scripts/verify-clickhouse-data.ts` - Verifies data quality
- `scripts/calculate-wallet-metrics.ts` - Uses enriched data for metrics
- `scripts/calculate-omega-scores.ts` - Omega calculation (depends on enrichment)

## Troubleshooting

### No markets found
**Symptom**: "No resolved markets found in Supabase"
**Solution**: Run `npx tsx scripts/sync-markets-from-polymarket.ts` first

### No trades to enrich
**Symptom**: "No trades need enrichment. All done!"
**Solution**: Either all trades are enriched, or no raw trades exist. Run sync first.

### Low enrichment rate
**Symptom**: Many trades skipped (no market)
**Solution**: Markets may not be synced. Check `condition_id` matches between ClickHouse and Supabase.

### Ambiguous resolutions
**Symptom**: Many trades skipped (unresolved)
**Solution**: Markets closed but price didn't settle to $0 or $1. May need manual resolution.

## Future Enhancements

1. **Real-time enrichment** - Enrich trades as they're ingested
2. **WebSocket updates** - Listen for market resolutions and enrich immediately
3. **ML-based outcome prediction** - For markets with ambiguous resolutions
4. **Exit trade matching** - Track position lifecycle (entry → exit → P&L)
5. **Fee precision** - Get actual fees from transaction receipts instead of estimates
6. **Slippage calculation** - Compare execution price to mid price at trade time

## License

Part of the CASCADIAN analytics platform.
