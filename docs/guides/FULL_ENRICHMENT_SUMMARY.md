# Full Enrichment Pipeline - Complete Summary

## Current Status (as of now)

✅ **10 Parallel Workers** loading real trades for 23,069 wallets
- Each worker has checkpoint/resume capability
- If crash occurs, workers resume from last saved wallet
- Expected completion: **15-20 minutes**

## What "Enriched" Means - Complete Breakdown

### 1. **Trade-Level Enrichment** ✅
From Goldsky API → ClickHouse `trades_raw`:
- Trade ID, wallet address, timestamp
- Market ID (mapped from condition_id)
- **Event mapping** (event_id, event_slug, event_title via markets table)
- **Category** (Politics, Crypto, Sports, etc. via markets table)
- Side (YES/NO), entry price, shares, USD value
- Transaction hash
- P&L calculation (hold-to-resolution methodology)
- Resolution flags (is_resolved, outcome)

### 2. **Overall Metrics** ✅
Table: `wallet_metrics_complete`

**For ALL ~28,000 wallets, across 4 time windows (30d, 90d, 180d, lifetime):**

#### Tier 1 Metrics:
- **metric_2_omega_net**: Omega ratio (gains/losses)
- **metric_6_sharpe**: Sharpe ratio (risk-adjusted returns)
- **metric_9_net_pnl_usd**: Total net P&L in USD
- **metric_12_hit_rate**: Win rate %
- **metric_13_avg_win_usd**: Average profit on wins
- **metric_14_avg_loss_usd**: Average loss on losses
- **metric_22_resolved_bets**: Total resolved trades
- **metric_23_track_record_days**: Days from first to last trade
- **metric_24_bets_per_week**: Betting frequency
- **metric_60_tail_ratio**: Win/loss distribution (top 10% wins / bottom 10% losses)
- **metric_69_ev_per_hour_capital**: Capital efficiency
- **metric_85_performance_trend_flag**: improving/declining/stable
- **metric_88_sizing_discipline_trend**: Sizing consistency
- **Resolution accuracy**: % of correct predictions

### 3. **Per-Category Metrics** ✅
Table: `wallet_metrics_by_category`

**Same metrics as above, but broken down by category:**
- Politics
- Crypto
- Sports
- Pop Culture
- Business
- Science
- All other Polymarket categories

**Additional category-specific fields:**
- `trades_in_category`: Count of trades in this category
- `pct_of_total_trades`: % of wallet's trades in this category
- `pct_of_total_volume`: % of wallet's USD volume in this category
- `is_primary_category`: TRUE if most trades are in this category

### 4. **Event Linkage** ✅
Via `markets` table columns:
- `event_id`: Polymarket event ID
- `event_slug`: URL-friendly event slug
- `event_title`: Parent event name

**Example Query:**
```sql
SELECT
  t.wallet_address,
  t.market_id,
  m.event_title,
  m.category,
  t.realized_pnl_usd
FROM trades_raw t
JOIN markets m ON t.market_id = m.market_id
WHERE m.event_slug = 'presidential-election-winner-2024'
```

### 5. **Tags & Specialization** ✅
Table: `wallet_category_tags`

**Computed for wallets with significant category activity:**
- `primary_tag`: Main specialization (e.g., "Politics Specialist")
- `secondary_tags`: Array of additional tags
- `is_likely_specialist`: Boolean flag for category specialists
- `is_likely_insider`: Boolean flag for potential insider activity
- `insider_confidence_score`: 0-1 score for insider likelihood
- `category_omega`: Omega ratio within this category
- `category_win_rate`: Win rate within this category
- `omega_percentile`: Ranking among all wallets in category
- `overall_rank_in_category`: Absolute rank in category

**Insider Detection Features:**
- `subcategory_win_rates`: Win rates by subcategory (JSONB)
- `consecutive_wins_in_subcategory`: Streak detection
- `timing_pattern_score`: Unusual timing patterns
- `win_rate_vs_category_avg`: How much better than average

### 6. **Total P&L Calculations** ✅

**Multiple P&L metrics available:**

1. **Raw P&L** (`realized_pnl_usd` in trades_raw):
   - Per-trade P&L if held to resolution

2. **Net P&L** (`metric_9_net_pnl_usd`):
   - Sum of all realized P&L
   - Includes fees
   - Available per time window (30d, 90d, 180d, lifetime)

3. **Category P&L**:
   - P&L broken down by each category
   - Shows which categories are profitable

4. **Time-windowed P&L**:
   - Last 30 days P&L
   - Last 90 days P&L
   - Last 180 days P&L
   - Lifetime P&L

**Example Query - Top P&L by Category:**
```sql
SELECT
  wallet_address,
  category,
  metric_9_net_pnl_usd as category_pnl,
  metric_12_hit_rate as win_rate_pct,
  metric_22_resolved_bets as trades
FROM wallet_metrics_by_category
WHERE window = 'lifetime'
  AND category = 'Politics'
ORDER BY metric_9_net_pnl_usd DESC
LIMIT 10
```

## Auto-Complete Pipeline Stages

When 10 workers finish loading (15-20 min), auto-pipeline triggers:

### Stage 1: Enrichment (~1-2 min)
- Maps all new condition_ids to market_ids
- Links trades to events
- Sets category for each trade
- Batched nuclear updates (1000 at a time with checkpoints)

### Stage 2: Overall Metrics (~2-3 min)
- Computes all Tier 1 metrics
- Processes ~28k wallets in batches of 500
- Saves to `wallet_metrics_complete`
- 4 time windows per wallet

### Stage 3: Category Metrics (~3-5 min)
- Computes per-category metrics
- Only for categories with >= 5 trades
- Saves to `wallet_metrics_by_category`
- Identifies primary categories

### Stage 4: Final Report
- Database stats
- Wallet counts
- Category coverage
- API endpoint status

## Total Timeline

- **Now → +15-20 min**: Parallel worker load (RUNNING)
- **+15-20 min → +22 min**: Auto-enrichment
- **+22 min → +25 min**: Overall metrics
- **+25 min → +30 min**: Category metrics
- **+30 min**: ✅ COMPLETE - All ~28k wallets with full metrics

## Monitoring Commands

```bash
# Watch parallel workers
tail -f runtime/parallel-loads/worker_*.log

# Watch auto-complete progress
tail -f runtime/auto-complete.log

# Check worker count
ps aux | grep goldsky-load-recent-trades | grep -v grep | wc -l

# Final database state
npx tsx scripts/check-db-true-state.ts
```

## What You Can Query After Completion

1. **Top wallets overall**:
   ```sql
   SELECT * FROM wallet_metrics_complete
   WHERE window = 'lifetime'
   ORDER BY metric_2_omega_net DESC LIMIT 10
   ```

2. **Best politics traders**:
   ```sql
   SELECT * FROM wallet_metrics_by_category
   WHERE window = 'lifetime' AND category = 'Politics'
   ORDER BY metric_2_omega_net DESC LIMIT 10
   ```

3. **Wallets with insider patterns**:
   ```sql
   SELECT * FROM wallet_category_tags
   WHERE is_likely_insider = TRUE
   ORDER BY insider_confidence_score DESC
   ```

4. **Event-specific analysis**:
   ```sql
   SELECT t.*, m.event_title, m.category
   FROM trades_raw t
   JOIN markets m ON t.market_id = m.market_id
   WHERE m.event_slug = 'any-event-slug'
   ```

5. **Category specialists**:
   ```sql
   SELECT * FROM wallet_category_tags
   WHERE is_likely_specialist = TRUE
     AND category = 'Crypto'
   ORDER BY category_omega DESC
   ```

## Crash Recovery

All processes checkpoint progress:
- **Workers**: Save after each wallet (resume from last completed)
- **Enrichment**: Batched updates with mutation tracking
- **Metrics**: Batch processing with transaction safety

If any process crashes, simply re-run it - it will skip completed work.
