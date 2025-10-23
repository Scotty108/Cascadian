# Wallet Analytics Tables - Quick Reference

**Migration**: `20251023120000_create_wallet_analytics_tables.sql`
**Status**: ✅ Applied to production
**Tables**: 7 | **Indexes**: 31 | **Functions**: 4

---

## Table Overview

### 1. `wallets` - Master Wallet Metadata

**Primary Key**: `wallet_address` (TEXT)

**Key Columns**:
```typescript
{
  wallet_address: string;        // Ethereum address (PK)
  wallet_alias?: string;         // User-assigned nickname
  ens_name?: string;             // ENS domain

  // Classification
  is_whale: boolean;             // Volume/position-based
  whale_score: number;           // 0-100
  is_suspected_insider: boolean; // Timing-based
  insider_score: number;         // 0-100

  // Aggregated Metrics
  total_volume_usd: number;
  total_trades: number;
  total_markets_traded: number;

  // Performance
  realized_pnl_usd: number;
  unrealized_pnl_usd: number;
  total_pnl_usd: number;
  win_rate: number;              // 0.0 to 1.0

  // Activity
  first_seen_at: Date;
  last_seen_at: Date;
  active_positions_count: number;
  closed_positions_count: number;

  // Portfolio
  portfolio_value_usd: number;
  portfolio_last_updated: Date;
}
```

**Indexes**:
- `idx_wallets_whale_score` (DESC, partial WHERE is_whale)
- `idx_wallets_insider_score` (DESC, partial WHERE is_suspected_insider)
- `idx_wallets_total_volume` (DESC)
- `idx_wallets_last_seen` (DESC)
- `idx_wallets_total_pnl` (DESC)

**Use Cases**:
- Wallet leaderboards
- Whale detection
- Insider analysis
- Portfolio tracking

---

### 2. `wallet_positions` - Current Open Positions

**Primary Key**: `id` (BIGSERIAL)
**Unique Constraint**: `(wallet_address, market_id, outcome)`

**Key Columns**:
```typescript
{
  id: number;                    // Auto-increment
  wallet_address: string;        // FK to wallets
  market_id: string;
  market_title: string;
  outcome: 'YES' | 'NO';
  shares: number;
  entry_price: number;
  current_price: number;
  position_value_usd: number;
  unrealized_pnl_usd: number;
  opened_at: Date;
  last_updated: Date;
  raw_data: object;              // JSONB from Data-API
}
```

**Indexes**:
- `idx_wallet_positions_wallet` (wallet_address)
- `idx_wallet_positions_market` (market_id)
- `idx_wallet_positions_unrealized_pnl` (DESC)

**Query Pattern**:
```typescript
// Get all positions for a wallet
const { data } = await supabase
  .from('wallet_positions')
  .select('*')
  .eq('wallet_address', address)
  .order('position_value_usd', { ascending: false });
```

---

### 3. `wallet_trades` - Complete Trade History

**Primary Key**: `id` (BIGSERIAL)
**Optional**: `trade_id` (TEXT UNIQUE)

**Key Columns**:
```typescript
{
  id: number;
  trade_id?: string;             // From Data-API
  wallet_address: string;        // FK to wallets
  market_id: string;
  market_title: string;
  side: 'BUY' | 'SELL';
  outcome: 'YES' | 'NO';
  shares: number;
  price: number;
  amount_usd: number;
  executed_at: Date;

  // Insider Analysis
  market_price_before?: number;  // 1 hour before
  market_price_after?: number;   // 1 hour after
  timing_score?: number;         // 0-100 prescience score
}
```

**Indexes**:
- `idx_wallet_trades_wallet` (wallet_address)
- `idx_wallet_trades_market` (market_id)
- `idx_wallet_trades_executed` (DESC)
- `idx_wallet_trades_timing_score` (DESC)
- `idx_wallet_trades_amount` (DESC)
- **Composite**: `idx_wallet_trades_wallet_executed` (wallet, executed DESC)

**Query Pattern**:
```typescript
// Get recent trades for wallet
const { data } = await supabase
  .from('wallet_trades')
  .select('*')
  .eq('wallet_address', address)
  .order('executed_at', { ascending: false })
  .limit(100);
```

---

### 4. `wallet_closed_positions` - Historical Closed Positions

**Primary Key**: `id` (BIGSERIAL)
**Optional**: `position_id` (TEXT UNIQUE)

**Key Columns**:
```typescript
{
  id: number;
  position_id?: string;
  wallet_address: string;
  market_id: string;
  outcome: string;
  entry_price: number;
  exit_price: number;
  realized_pnl_usd: number;
  is_win: boolean;               // PnL > 0
  opened_at: Date;
  closed_at: Date;
  hold_duration_hours: number;
}
```

**Indexes**:
- `idx_wallet_closed_wallet` (wallet_address)
- `idx_wallet_closed_market` (market_id)
- `idx_wallet_closed_at` (DESC)
- `idx_wallet_closed_pnl` (DESC)
- `idx_wallet_closed_is_win`

**Use Cases**:
- Calculate win rate
- Historical performance analysis
- Position duration analysis

---

### 5. `wallet_pnl_snapshots` - Time-Series PnL Data

**Primary Key**: `id` (BIGSERIAL)
**Unique Constraint**: `(wallet_address, snapshot_at)`

**Key Columns**:
```typescript
{
  id: number;
  wallet_address: string;
  snapshot_at: Date;             // Snapshot timestamp
  portfolio_value_usd: number;
  realized_pnl_usd: number;
  unrealized_pnl_usd: number;
  total_pnl_usd: number;
  active_positions: number;
  closed_positions: number;
  win_rate: number;
  total_invested_usd: number;
  roi: number;                   // Return on Investment %
}
```

**Indexes**:
- `idx_wallet_pnl_wallet` (wallet_address)
- `idx_wallet_pnl_snapshot_at` (DESC)
- **Composite**: `idx_wallet_pnl_wallet_time` (wallet, snapshot_at DESC)

**Use Cases**:
- PnL graphs over time
- Historical portfolio value
- ROI tracking

**Query Pattern**:
```typescript
// Get 30-day PnL history
const { data } = await supabase
  .from('wallet_pnl_snapshots')
  .select('*')
  .eq('wallet_address', address)
  .gte('snapshot_at', thirtyDaysAgo)
  .order('snapshot_at', { ascending: true });
```

---

### 6. `market_holders` - Top Holders Per Market

**Primary Key**: `id` (BIGSERIAL)
**Unique Constraint**: `(market_id, wallet_address, outcome)`

**Key Columns**:
```typescript
{
  id: number;
  market_id: string;
  wallet_address: string;
  outcome: 'YES' | 'NO';
  shares: number;
  position_value_usd: number;
  market_share_percentage: number; // % of total supply
  rank: number;                    // 1 = largest holder
  last_updated: Date;
}
```

**Indexes**:
- `idx_market_holders_market` (market_id)
- `idx_market_holders_wallet` (wallet_address)
- `idx_market_holders_shares` (DESC)
- **Composite**: `idx_market_holders_rank` (market_id, rank)

**Use Cases**:
- Whale concentration analysis
- Market manipulation detection
- Liquidity analysis

**Query Pattern**:
```typescript
// Get top 10 holders for a market
const { data } = await supabase
  .from('market_holders')
  .select('*')
  .eq('market_id', marketId)
  .order('rank', { ascending: true })
  .limit(10);
```

---

### 7. `whale_activity_log` - Pre-Aggregated Whale Feed

**Primary Key**: `id` (BIGSERIAL)

**Key Columns**:
```typescript
{
  id: number;
  wallet_address: string;        // FK to wallets
  wallet_alias?: string;
  activity_type: 'TRADE' | 'POSITION_FLIP' | 'LARGE_MOVE';
  market_id: string;
  market_title: string;

  // Trade Details (if activity_type = 'TRADE')
  side?: 'BUY' | 'SELL';
  outcome?: string;
  shares?: number;
  price?: number;
  amount_usd?: number;

  // Flip Details (if activity_type = 'POSITION_FLIP')
  previous_outcome?: string;
  new_outcome?: string;

  impact_score: number;          // 0-100 significance
  occurred_at: Date;
}
```

**Indexes**:
- `idx_whale_activity_wallet` (wallet_address)
- `idx_whale_activity_occurred` (DESC)
- `idx_whale_activity_impact` (DESC)
- `idx_whale_activity_market` (market_id)
- `idx_whale_activity_type` (activity_type)

**Use Cases**:
- Real-time whale feed
- Copy trading signals
- Market sentiment analysis

**Query Pattern**:
```typescript
// Get recent whale activity (last 24h)
const { data } = await supabase
  .rpc('get_recent_whale_activity', {
    hours_back: 24,
    limit_count: 50
  });
```

---

## Helper Functions

### 1. `calculate_wallet_win_rate(addr TEXT) → NUMERIC`

**Purpose**: Calculate win rate from closed positions.

**Usage**:
```sql
SELECT calculate_wallet_win_rate('0x1234...');
-- Returns: 0.65 (65% win rate)
```

**TypeScript**:
```typescript
const { data } = await supabase.rpc('calculate_wallet_win_rate', {
  addr: walletAddress
});
```

---

### 2. `get_top_whales(limit_count INTEGER) → TABLE`

**Purpose**: Get leaderboard of top whales by volume.

**Returns**: `wallet_address, wallet_alias, total_volume_usd, whale_score, total_pnl_usd, win_rate`

**Usage**:
```typescript
const { data: whales } = await supabase.rpc('get_top_whales', {
  limit_count: 50
});
```

---

### 3. `get_suspected_insiders(limit_count INTEGER) → TABLE`

**Purpose**: Get wallets with suspicious timing (high insider_score).

**Returns**: `wallet_address, wallet_alias, insider_score, win_rate, total_trades, avg_timing_score`

**Usage**:
```typescript
const { data: insiders } = await supabase.rpc('get_suspected_insiders', {
  limit_count: 50
});
```

---

### 4. `get_recent_whale_activity(hours_back INTEGER, limit_count INTEGER) → TABLE`

**Purpose**: Get recent significant whale activity.

**Returns**: `activity_id, wallet_address, wallet_alias, activity_type, market_title, amount_usd, impact_score, occurred_at`

**Usage**:
```typescript
const { data: activity } = await supabase.rpc('get_recent_whale_activity', {
  hours_back: 24,
  limit_count: 100
});
```

---

## Data Flow Examples

### Example 1: Wallet Detail Page

```typescript
// Step 1: Fetch wallet metadata
const { data: wallet } = await supabase
  .from('wallets')
  .select('*')
  .eq('wallet_address', address)
  .single();

// Step 2: Fetch current positions
const { data: positions } = await supabase
  .from('wallet_positions')
  .select('*')
  .eq('wallet_address', address);

// Step 3: Fetch recent trades
const { data: trades } = await supabase
  .from('wallet_trades')
  .select('*')
  .eq('wallet_address', address)
  .order('executed_at', { ascending: false })
  .limit(50);

// Step 4: Fetch PnL history for graph
const { data: pnlHistory } = await supabase
  .from('wallet_pnl_snapshots')
  .select('snapshot_at, total_pnl_usd')
  .eq('wallet_address', address)
  .gte('snapshot_at', thirtyDaysAgo)
  .order('snapshot_at', { ascending: true });
```

---

### Example 2: Whale Activity Dashboard

```typescript
// Get recent whale activity
const { data: recentActivity } = await supabase
  .rpc('get_recent_whale_activity', {
    hours_back: 24,
    limit_count: 100
  });

// Group by market
const activityByMarket = recentActivity.reduce((acc, activity) => {
  if (!acc[activity.market_id]) {
    acc[activity.market_id] = [];
  }
  acc[activity.market_id].push(activity);
  return acc;
}, {});
```

---

### Example 3: Market Top Holders

```typescript
// Get top holders for a market
const { data: holders } = await supabase
  .from('market_holders')
  .select(`
    wallet_address,
    outcome,
    shares,
    position_value_usd,
    market_share_percentage,
    rank,
    wallets!inner(wallet_alias, whale_score)
  `)
  .eq('market_id', marketId)
  .order('rank', { ascending: true })
  .limit(10);

// Calculate whale concentration
const whalePercentage = holders
  .filter(h => h.wallets.whale_score > 80)
  .reduce((sum, h) => sum + h.market_share_percentage, 0);
```

---

## Best Practices

### Data Ingestion

1. **Always use UPSERT** for idempotency:
```typescript
await supabase
  .from('wallets')
  .upsert(walletData, { onConflict: 'wallet_address' });
```

2. **Batch inserts** for trades (faster):
```typescript
await supabase
  .from('wallet_trades')
  .insert(tradesArray);
```

3. **Check for existing data** before fetching from API:
```typescript
const { data: existing } = await supabase
  .from('wallets')
  .select('portfolio_last_updated')
  .eq('wallet_address', address)
  .single();

if (!existing || isStale(existing.portfolio_last_updated)) {
  // Fetch from Data-API
}
```

### Query Optimization

1. **Use composite indexes** for time-series queries:
```typescript
// Good: Uses idx_wallet_trades_wallet_executed
const trades = await supabase
  .from('wallet_trades')
  .select('*')
  .eq('wallet_address', address)
  .order('executed_at', { ascending: false });

// Bad: Table scan
const trades = await supabase
  .from('wallet_trades')
  .select('*')
  .eq('market_title', title); // No index on market_title!
```

2. **Limit result sets**:
```typescript
// Always add .limit() for large tables
.limit(100)
```

3. **Use helper functions** instead of complex joins:
```typescript
// Good
const whales = await supabase.rpc('get_top_whales', { limit_count: 50 });

// Bad (slower, more complex)
const whales = await supabase
  .from('wallets')
  .select('...')
  .eq('is_whale', true)
  .order('total_volume_usd', { ascending: false });
```

---

## Common Queries

### Get Wallet Summary
```sql
SELECT
  wallet_address,
  wallet_alias,
  total_pnl_usd,
  win_rate,
  active_positions_count,
  whale_score
FROM wallets
WHERE wallet_address = '0x...';
```

### Get Largest Trades (Last 24h)
```sql
SELECT
  wallet_address,
  market_title,
  side,
  amount_usd,
  executed_at
FROM wallet_trades
WHERE executed_at >= NOW() - INTERVAL '24 hours'
ORDER BY amount_usd DESC
LIMIT 50;
```

### Get Whale Concentration for Market
```sql
SELECT
  outcome,
  COUNT(*) FILTER (WHERE wallets.is_whale = TRUE) as whale_count,
  SUM(market_share_percentage) FILTER (WHERE wallets.is_whale = TRUE) as whale_percentage
FROM market_holders
JOIN wallets USING (wallet_address)
WHERE market_id = '0x...'
GROUP BY outcome;
```

---

## Troubleshooting

### Issue: Slow wallet detail queries

**Solution**: Ensure composite index is used
```sql
EXPLAIN ANALYZE
SELECT * FROM wallet_trades
WHERE wallet_address = '0x...'
ORDER BY executed_at DESC;

-- Should use: idx_wallet_trades_wallet_executed
```

### Issue: Duplicate trades

**Solution**: Use ON CONFLICT
```typescript
await supabase
  .from('wallet_trades')
  .insert(trades)
  .onConflict('trade_id')
  .ignore();
```

### Issue: Stale portfolio values

**Solution**: Update via trigger or cron
```sql
-- Create cron job to refresh every hour
UPDATE wallets
SET portfolio_value_usd = (
  SELECT SUM(position_value_usd)
  FROM wallet_positions
  WHERE wallet_address = wallets.wallet_address
);
```

---

**Last Updated**: 2025-10-23
**Migration Version**: `20251023120000`
