# Trade Enrichment System

## Quick Start

### 1. Check Current Status
```bash
# See how many trades need enrichment
npx tsx scripts/verify-enrichment.ts
```

### 2. Run Enrichment
```bash
# Enrich all trades (recommended for first run)
npx tsx scripts/enrich-trades.ts

# Or test with limited trades first
npx tsx scripts/enrich-trades.ts --limit 1000
```

### 3. Verify Results
```bash
# Run comprehensive verification
npx tsx scripts/verify-enrichment.ts
```

## What Gets Enriched

The enrichment pipeline fills 8 critical fields:

| Field | Description | Example |
|-------|-------------|---------|
| `outcome` | 1 = trade won, 0 = trade lost, NULL = unresolved | `1` |
| `is_closed` | Boolean indicating if position is resolved | `true` |
| `close_price` | Final YES price at market resolution | `0.98` |
| `pnl_gross` | Profit/loss before fees | `$35.00` |
| `pnl_net` | Profit/loss after fees | `$33.70` |
| `fee_usd` | Transaction fees (2% of trade size) | `$1.30` |
| `hours_held` | Duration from entry to resolution | `72.5` |
| `return_pct` | Return as percentage of capital | `51.85%` |

## Common Workflows

### Initial Setup (First Time)
```bash
# 1. Sync markets from Polymarket
npx tsx scripts/sync-markets-from-polymarket.ts

# 2. Sync wallet trades
npx tsx scripts/sync-wallet-trades.ts 0xWALLET_ADDRESS

# 3. Enrich trades with market outcomes
npx tsx scripts/enrich-trades.ts

# 4. Verify enrichment quality
npx tsx scripts/verify-enrichment.ts
```

### Daily Maintenance
```bash
# 1. Sync new market resolutions
npx tsx scripts/sync-markets-from-polymarket.ts

# 2. Enrich newly resolved trades
npx tsx scripts/enrich-trades.ts

# 3. Quick verification
npx tsx scripts/verify-enrichment.ts
```

### Single Market Update
```bash
# Enrich trades for a specific market
npx tsx scripts/enrich-trades.ts --condition-id 0x1234567890abcdef...
```

## Data Pipeline Flow

```
1. INGEST (sync-wallet-trades.ts)
   ↓
   Goldsky → ClickHouse trades_raw
   • Basic fields populated
   • Metric fields are NULL

2. ENRICH (enrich-trades.ts)
   ↓
   Supabase markets → Calculate → ClickHouse UPDATE
   • Match by condition_id
   • Calculate outcome, P&L, fees
   • Update metric fields

3. VERIFY (verify-enrichment.ts)
   ↓
   ClickHouse → Validation checks → Report
   • Data integrity
   • Calculation accuracy
   • Statistical validation

4. ANALYZE (calculate-wallet-metrics.ts)
   ↓
   Enriched trades → Aggregate → Wallet scores
   • Omega ratio
   • Win rate
   • Sharpe ratio
   • Category performance
```

## Troubleshooting

### No Trades to Enrich
**Symptom:**
```
✅ Found 0 trades to enrich
```

**Solutions:**
1. Check if trades exist: `SELECT COUNT(*) FROM trades_raw`
2. Check if already enriched: `SELECT COUNT(*) FROM trades_raw WHERE outcome IS NOT NULL`
3. Check if condition_id is populated: `SELECT COUNT(*) FROM trades_raw WHERE condition_id != ''`

### Low Enrichment Rate
**Symptom:**
```
⚠️  Skipped (no market): 5,234
```

**Solution:**
Markets aren't synced. Run:
```bash
npx tsx scripts/sync-markets-from-polymarket.ts
```

### Ambiguous Resolutions
**Symptom:**
```
⚠️  Ambiguous resolution for market xyz (price: 0.55)
```

**Explanation:**
Market is closed but price didn't settle to $0 or $1. This happens with:
- Invalid markets
- Markets resolved to "N/A" or "Ambiguous"
- Markets still settling on-chain

**Solution:**
These trades remain unenriched. Check market manually on Polymarket.

### Verification Errors
**Symptom:**
```
❌ [P&L Calculation] Net P&L is greater than gross P&L
```

**Solution:**
This indicates a bug in calculation logic. File an issue with:
1. Full error output from verify-enrichment.ts
2. Sample trade_id showing the issue
3. Expected vs actual values

## Performance Expectations

### Enrichment Speed
- **Small datasets** (<10k trades): ~5-10 seconds
- **Medium datasets** (10k-100k trades): ~30-60 seconds
- **Large datasets** (100k-1M trades): ~5-10 minutes

### Resource Usage
- **Memory**: ~100-200 MB (processes in batches)
- **CPU**: Moderate (ClickHouse does heavy lifting)
- **Network**: Low (batch queries, not per-trade)

### Batch Sizes
Default configuration:
```typescript
const BATCH_SIZE = 10000              // Trades fetched per batch
const CLICKHOUSE_BATCH_SIZE = 5000    // Trades updated per query
```

For slower systems, reduce batch sizes:
```typescript
const BATCH_SIZE = 1000
const CLICKHOUSE_BATCH_SIZE = 500
```

## Advanced Usage

### Custom Fee Rates
Edit `scripts/enrich-trades.ts`:
```typescript
const FEE_RATE = 0.02  // Change to 0.01 for 1% fees
```

### Parallel Processing
Process multiple condition IDs in parallel:
```bash
# Terminal 1
npx tsx scripts/enrich-trades.ts --condition-id 0xabc...

# Terminal 2
npx tsx scripts/enrich-trades.ts --condition-id 0xdef...
```

### SQL Queries for Manual Checks

**Check enrichment status:**
```sql
SELECT
  COUNT(*) as total,
  COUNTIF(outcome IS NOT NULL) as enriched,
  COUNTIF(outcome IS NULL) as pending
FROM trades_raw
```

**Find top wallets by P&L:**
```sql
SELECT
  wallet_address,
  COUNT(*) as trades,
  SUM(pnl_net) as total_pnl,
  AVG(return_pct) as avg_return,
  COUNTIF(outcome = 1) * 100.0 / COUNT(*) as win_rate
FROM trades_raw
WHERE outcome IS NOT NULL
GROUP BY wallet_address
ORDER BY total_pnl DESC
LIMIT 20
```

**Find problematic trades:**
```sql
SELECT *
FROM trades_raw
WHERE outcome IS NOT NULL
  AND (
    pnl_net > pnl_gross OR           -- Net > Gross (impossible)
    hours_held < 0 OR                -- Negative time
    return_pct > 200 OR              -- Suspiciously high return
    close_price < 0 OR close_price > 1  -- Invalid price
  )
LIMIT 100
```

## Integration with Analytics

After enrichment, these metrics become available:

### Omega Score Calculation
```sql
SELECT
  wallet_address,
  SUM(CASE WHEN pnl_net > 0 THEN pnl_net ELSE 0 END) /
    NULLIF(SUM(CASE WHEN pnl_net <= 0 THEN ABS(pnl_net) ELSE 0 END), 0) as omega_ratio
FROM trades_raw
WHERE outcome IS NOT NULL
GROUP BY wallet_address
```

### Sharpe Ratio (Risk-Adjusted Returns)
```sql
SELECT
  wallet_address,
  AVG(return_pct) / NULLIF(STDDEV(return_pct), 0) as sharpe_ratio
FROM trades_raw
WHERE outcome IS NOT NULL
GROUP BY wallet_address
```

### Category Performance
```sql
SELECT
  m.category,
  COUNT(*) as trades,
  AVG(t.return_pct) as avg_return,
  SUM(t.pnl_net) as total_pnl
FROM trades_raw t
JOIN markets m ON t.condition_id = m.condition_id
WHERE t.outcome IS NOT NULL
GROUP BY m.category
ORDER BY total_pnl DESC
```

## Files Reference

| File | Purpose |
|------|---------|
| `scripts/enrich-trades.ts` | Main enrichment pipeline |
| `scripts/verify-enrichment.ts` | Comprehensive verification checks |
| `TRADE_ENRICHMENT_PIPELINE.md` | Detailed technical documentation |
| `scripts/README_ENRICHMENT.md` | This quick reference guide |

## Support

For issues or questions:
1. Check verification output: `npx tsx scripts/verify-enrichment.ts`
2. Review full docs: `TRADE_ENRICHMENT_PIPELINE.md`
3. Check sample queries in "Advanced Usage" section above
4. File an issue with verification output + error details
