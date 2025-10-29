# Bulk Wallet Sync - Quick Reference

## One-Page Command Reference

### Initial Setup (One-Time)

```bash
# 1. Run setup script
./scripts/setup-bulk-sync.sh

# 2. Test with 10 wallets
npx tsx scripts/sync-all-wallets-bulk.ts --max-wallets 10 --dry-run

# 3. Start bulk sync (24-48 hours)
npx tsx scripts/sync-all-wallets-bulk.ts
```

### Monitor Progress

```bash
# Watch checkpoint file
watch -n 60 'cat .bulk-sync-checkpoint.json'

# Check Supabase sync status
psql $DATABASE_URL -c "SELECT * FROM wallet_sync_progress;"

# Check ClickHouse data
npx tsx -e "
import { clickhouse } from './lib/clickhouse/client.js'
const result = await clickhouse.query({
  query: 'SELECT COUNT(*) as total FROM trades_raw',
  format: 'JSONEachRow'
})
console.log(await result.json())
"
```

### After Bulk Sync Completes

```bash
# Calculate category omega (11 minutes for 6,605 wallets)
npx tsx scripts/calculate-category-omega-sql.ts

# Verify data
psql $DATABASE_URL -c "
SELECT category, COUNT(*) as wallets
FROM wallet_scores_by_category
GROUP BY category;
"
```

### Daily Operations (Cron Jobs)

```bash
# Hourly: Top 100 wallets
0 * * * * cd /app && npx tsx scripts/sync-wallets-incremental.ts --top 100

# Every 6 hours: All wallets
0 */6 * * * cd /app && npx tsx scripts/sync-wallets-incremental.ts --all

# Daily at 2 AM: Calculate omega
0 2 * * * cd /app && npx tsx scripts/calculate-category-omega-sql.ts --only-synced
```

### Troubleshooting

```bash
# Resume interrupted bulk sync
npx tsx scripts/sync-all-wallets-bulk.ts --resume

# Re-sync specific wallet
npx tsx scripts/sync-wallet-trades.ts 0x742d35Cc6634C0532925a3b844Bc454e4438f44e

# Check failed syncs
psql $DATABASE_URL -c "
SELECT wallet_address, last_error, error_count
FROM wallet_sync_metadata
WHERE sync_status = 'failed'
LIMIT 10;
"

# Reset failed wallet
psql $DATABASE_URL -c "
UPDATE wallet_sync_metadata
SET sync_status = 'pending', error_count = 0
WHERE wallet_address = '0x742d35Cc...';
"

# Test ClickHouse connection
npx tsx scripts/test-clickhouse-connection.ts
```

## Performance Expectations

| Operation | Time | Wallets | Notes |
|-----------|------|---------|-------|
| Bulk sync (initial) | 24-48h | 6,605 | One-time, concurrent batches |
| Category omega (SQL) | 11 min | 6,605 | 100x faster than API |
| Incremental sync (top 100) | 2-5 min | 100 | Hourly cron |
| Incremental sync (all) | 30-60 min | 6,605 | Daily cron |

## Key Files

| File | Purpose |
|------|---------|
| `scripts/sync-all-wallets-bulk.ts` | Initial bulk sync |
| `scripts/calculate-category-omega-sql.ts` | Fast SQL omega calculator |
| `scripts/sync-wallets-incremental.ts` | Incremental daily sync |
| `lib/sync/wallet-trade-sync-utils.ts` | Shared utilities |
| `supabase/migrations/20251025000000_create_wallet_sync_metadata.sql` | Metadata table |
| `migrations/clickhouse/003_add_condition_id.sql` | ClickHouse condition_id |

## SQL Queries

### Check Sync Progress
```sql
SELECT * FROM wallet_sync_progress;
```

### Find Wallets Needing Sync
```sql
SELECT * FROM wallets_needing_sync LIMIT 10;
```

### Top Categories by Wallet Count
```sql
SELECT category, COUNT(*) as wallets, AVG(omega_ratio) as avg_omega
FROM wallet_scores_by_category
WHERE meets_minimum_trades = TRUE
GROUP BY category
ORDER BY wallets DESC;
```

### Top Wallets in Category
```sql
SELECT wallet_address, omega_ratio, total_pnl, roi_per_bet
FROM wallet_scores_by_category
WHERE category = 'Politics' AND meets_minimum_trades = TRUE
ORDER BY omega_ratio DESC
LIMIT 10;
```

### Sync Health Check
```sql
SELECT
  sync_status,
  COUNT(*) as count,
  AVG(total_trades_synced) as avg_trades,
  MAX(last_synced_at) as latest_sync
FROM wallet_sync_metadata
GROUP BY sync_status;
```

## Environment Variables Required

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJxxx...
DATABASE_URL=postgresql://postgres:xxx@db.xxx.supabase.co:5432/postgres

# ClickHouse
CLICKHOUSE_HOST=https://xxx.clickhouse.cloud:8443
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=xxx
CLICKHOUSE_DATABASE=default
```

## Common Scenarios

### Scenario 1: First Time Setup
```bash
./scripts/setup-bulk-sync.sh
npx tsx scripts/sync-all-wallets-bulk.ts --max-wallets 10  # Test
npx tsx scripts/sync-all-wallets-bulk.ts  # Full sync
# Wait 24-48 hours...
npx tsx scripts/calculate-category-omega-sql.ts
```

### Scenario 2: Sync Interrupted
```bash
# Check checkpoint
cat .bulk-sync-checkpoint.json

# Resume
npx tsx scripts/sync-all-wallets-bulk.ts --resume
```

### Scenario 3: Add New Wallets
```bash
# Add wallets to wallet_scores table (via your scoring system)
# Then sync only pending
npx tsx scripts/sync-all-wallets-bulk.ts --only-pending
```

### Scenario 4: Daily Updates
```bash
# Set up cron (once)
crontab -e
# Add: 0 * * * * cd /app && npx tsx scripts/sync-wallets-incremental.ts --top 100

# Manual run
npx tsx scripts/sync-wallets-incremental.ts --top 100
npx tsx scripts/calculate-category-omega-sql.ts --only-synced --max-wallets 100
```

### Scenario 5: Debugging Low Coverage
```bash
# Check how many markets have categories
psql $DATABASE_URL -c "
SELECT
  COUNT(*) as total_markets,
  COUNT(*) FILTER (WHERE category IS NOT NULL) as with_category,
  (COUNT(*) FILTER (WHERE category IS NOT NULL) * 100.0 / COUNT(*)) as pct
FROM markets;
"

# Sync more markets
npx tsx scripts/sync-markets-from-polymarket.ts

# Re-calculate omega (will pick up new categories)
npx tsx scripts/calculate-category-omega-sql.ts
```

## Expected Outcomes

After running the bulk sync system:

✅ **6,605+ wallets synced** to ClickHouse
✅ **330,000+ trades** stored with condition_id
✅ **100% category coverage** (via SQL join)
✅ **Category omega in 100ms** (vs 5 minutes)
✅ **Daily incremental updates** (only new trades)
✅ **Foundation for 102 metrics** (all data in ClickHouse)

## Help & Documentation

- **Full Documentation**: `docs/BULK_WALLET_SYNC_SYSTEM.md`
- **Setup Script**: `scripts/setup-bulk-sync.sh`
- **Original Sync**: `scripts/sync-wallet-trades.ts`
- **Austin's Spec**: `lib/SMART_MONEY_FLOW.md`

## Getting Help

```bash
# Script help
npx tsx scripts/sync-all-wallets-bulk.ts --help
npx tsx scripts/calculate-category-omega-sql.ts --help
npx tsx scripts/sync-wallets-incremental.ts --help
```
