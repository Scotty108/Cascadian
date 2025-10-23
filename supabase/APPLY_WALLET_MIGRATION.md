# Apply Wallet Analytics Migration

## Migration File
`20251023120000_create_wallet_analytics_tables.sql`

## What This Creates

### 7 New Tables

1. **`wallets`** - Master wallet metadata and aggregated metrics
   - Wallet aliases, ENS names
   - Whale/insider classification
   - Total volume, trades, PnL
   - Win rate, portfolio value

2. **`wallet_positions`** - Current open positions (cached from Data-API)
   - Real-time position tracking
   - Unrealized PnL calculation
   - One row per wallet+market+outcome

3. **`wallet_trades`** - Complete trade history (from Data-API)
   - Immutable trade log
   - Timing analysis for insider detection
   - Price context (before/after trade)

4. **`wallet_closed_positions`** - Historical closed positions
   - Realized PnL
   - Win/loss tracking
   - Used for win rate calculation

5. **`wallet_pnl_snapshots`** - Time-series PnL data
   - Historical portfolio value
   - Enables PnL graphs over time
   - Captures metrics at regular intervals

6. **`market_holders`** - Top holders per market (cached)
   - Whale concentration analysis
   - Market share percentages
   - Holder rankings

7. **`whale_activity_log`** - Pre-aggregated whale feed
   - Optimized for real-time whale dashboard
   - Trades, position flips, large moves
   - Impact scoring

### Helper Functions

- `calculate_wallet_win_rate(address)` - Calculate win rate from closed positions
- `get_top_whales(limit)` - Get top whales by volume
- `get_suspected_insiders(limit)` - Get suspected insiders by score
- `get_recent_whale_activity(hours, limit)` - Get recent whale activity

## How to Apply

### Option 1: Supabase Dashboard (Recommended)

1. Go to https://supabase.com/dashboard/project/cqvjfonlpqycmaonacvz
2. Click **SQL Editor** in left sidebar
3. Click **New Query**
4. Copy the entire contents of `20251023120000_create_wallet_analytics_tables.sql`
5. Paste into the SQL editor
6. Click **Run** or press `Cmd+Enter`
7. Wait for success message

### Option 2: Supabase CLI

```bash
# If you have Supabase CLI installed
cd /Users/scotty/Projects/Cascadian-app
supabase db push
```

### Option 3: Direct psql

```bash
# Get your database URL from .env.local
export DATABASE_URL="postgresql://postgres:[password]@db.cqvjfonlpqycmaonacvz.supabase.co:5432/postgres"

# Apply migration
psql $DATABASE_URL < supabase/migrations/20251023120000_create_wallet_analytics_tables.sql
```

## Verification

After applying, verify tables were created:

```sql
-- Check all tables exist
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'wallets',
    'wallet_positions',
    'wallet_trades',
    'wallet_closed_positions',
    'wallet_pnl_snapshots',
    'market_holders',
    'whale_activity_log'
  )
ORDER BY table_name;

-- Should return 7 rows
```

## What This Enables

Once migration is applied, you can:

### ✅ Store Wallet Data
- Cache wallet positions from Data-API
- Store complete trade history
- Track historical PnL

### ✅ Generate Graphs
- PnL over time (from `wallet_pnl_snapshots`)
- Win rate history (from `wallet_closed_positions`)
- Portfolio value trends

### ✅ Whale Detection
- Identify whales by volume
- Track whale activity in real-time
- Analyze market concentration

### ✅ Insider Analysis
- Analyze trade timing vs price movements
- Calculate timing scores
- Identify early entries

### ✅ Performance Analytics
- Win rate calculation
- ROI tracking
- Category performance breakdown

## Next Steps After Migration

1. **Create Data Ingestion Scripts**
   - Fetch wallet data from Data-API
   - Store in new tables
   - Schedule regular updates

2. **Build Aggregation Functions**
   - Calculate whale scores
   - Calculate insider scores
   - Generate PnL snapshots

3. **Update UI Components**
   - Connect wallet detail page to real tables
   - Connect whale activity to real data
   - Connect insider activity to real data

4. **Enable Real-Time Updates**
   - WebSocket listeners for new trades
   - Auto-update whale activity log
   - Trigger PnL snapshot generation

## Migration Status

- [x] Migration file created
- [ ] Migration applied to database
- [ ] Tables verified
- [ ] Data ingestion scripts created
- [ ] UI connected to real data

## Notes

- All tables have Row Level Security (RLS) enabled
- Public read access granted by default
- Write access will need to be configured based on your auth setup
- Indexes optimized for common query patterns
- Foreign keys ensure data integrity
