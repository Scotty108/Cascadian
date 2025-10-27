# Cascadian Database - Quick Reference Guide

## Database Summary

| System | Type | Purpose | Tables |
|--------|------|---------|--------|
| **Supabase** | PostgreSQL (OLTP) | Operational data, strategies, workflows | 25+ tables |
| **ClickHouse** | Columnar OLAP | Analytics, 102 metrics per wallet | 13 tables |
| **Goldsky** | GraphQL (Public API) | Blockchain data source | N/A |
| **Polymarket** | REST API | Market & trade data | N/A |

---

## Key Supabase Tables (Top 15)

### Market Data
| Table | Key Field | Purpose | Source |
|-------|-----------|---------|--------|
| `markets` | market_id | All ~20k Polymarket markets | Polymarket API |
| `market_analytics` | market_id | Trade volume, momentum, sentiment | CLOB trades API |
| `market_sii` | market_id | Smart money side (YES vs NO) | Wallet scores |

### Wallet Performance
| Table | Key Field | Purpose | Source |
|-------|-----------|---------|--------|
| `wallets` | wallet_address | Master wallet metadata | Goldsky discovery |
| `wallet_scores` | wallet_address | Omega, grade, momentum | Goldsky PnL API |
| `wallet_scores_by_category` | wallet_address + category | Performance per category | Wallet scores |
| `wallet_positions` | wallet_address + market_id + outcome | Current open positions | Goldsky Positions |
| `wallet_trades` | trade_id | Trade history (immutable) | Goldsky PnL |
| `wallet_closed_positions` | position_id | Closed positions with PnL | Goldsky PnL |
| `wallet_pnl_snapshots` | wallet_address + snapshot_at | Historical portfolio value | Calculated |
| `market_holders` | market_id + wallet_address + outcome | Top holders per market | Goldsky Positions |
| `whale_activity_log` | id | Real-time whale activity | Derived from trades |

### Strategies & Workflows
| Table | Key Field | Purpose | Source |
|-------|-----------|---------|--------|
| `strategy_definitions` | strategy_id | Strategy definitions (11 predefined) | User + system |
| `strategy_executions` | execution_id | Strategy run history | Strategy engine |
| `strategy_watchlist_items` | id | Items flagged by strategies | Strategy results |
| `strategy_positions` | id | Positions created by strategies | Strategy execution |
| `workflow_sessions` | id | AI workflows (ReactFlow) | User input |
| `workflow_executions` | id | Workflow run history | Workflow engine |

### Discovery & Notifications
| Table | Key Field | Purpose | Source |
|-------|-----------|---------|--------|
| `discovered_wallets` | wallet_address | Master wallet registry | Multiple sources |
| `notifications` | id | User alerts & notifications | Various triggers |
| `watchlist_markets`, `watchlist_wallets` | market_id, wallet_address | User watchlists | User selections |

---

## Key ClickHouse Tables (For Analytics)

| Table | Purpose | Metrics | Time Windows |
|-------|---------|---------|--------------|
| `trades_raw` | Raw trade data | N/A | All-time |
| `wallet_metrics_complete` | **102 metrics per wallet** | Omega, risk, momentum, etc. | 30d, 90d, 180d, lifetime |
| `wallet_metrics_by_category` | Per-category metrics | All 102 metrics | Per category |
| `category_analytics` | Category-level stats | Volume, win rate, median Omega | Daily |
| `market_price_momentum` | Market momentum metrics | Price velocity, volatility | Real-time |
| `momentum_trading_signals` | Generated trading signals | Signal type, confidence | Real-time |
| `price_snapshots_10s` | 10-second price snapshots | YES/NO prices, spread | Limited window |
| `market_price_history` | Historical price data | OHLC, volume | Full history |
| `elite_trade_attributions` | Copy trading analysis | Signal delay, PnL comparison | All-time |

---

## Critical Metrics (TIER 1)

These 11 metrics are most important for identifying smart money:

1. **Omega (metric_2)** - Gains / Losses ratio
   - S grade: >= 3.0
   - A grade: >= 2.0
   - Minimum: >= 5 closed trades

2. **Track Record (metric_23)** - Days active
   - Shows long-term consistency

3. **Resolved Bets (metric_22)** - Trade count
   - Minimum for credibility: 5

4. **Bets per Week (metric_24)** - Activity level
   - Shows if still active

5. **Omega Lag 30s/2min/5min (metrics_48-50)** - COPYABILITY
   - Edge decay with time delay
   - Identifies actionable signals

6. **Omega Momentum (metric_56)** - Trend direction
   - Improving vs declining
   - Avoid stale winners

7. **Tail Ratio (metric_60)** - Asymmetric upside
   - Wins much bigger than losses
   - Rare edge indicator

8. **EV per Hour Capital (metric_69)** - Capital efficiency
   - High EV with low capital = efficient

9-11. **Additional key metrics**: Sortino ratio, Calmar ratio, Win rate

---

## Core Data Flows

### 1. Market Data Flow (Real-time)
```
Polymarket API → /api/polymarket/sync → markets table
              → market_analytics table
              → market_sii calculation (on demand)
```

### 2. Wallet Metrics Flow (On-demand, 1hr cache)
```
Goldsky PnL API → /api/wallets/[address]/score
               → wallet_scores table (cache)
               → ClickHouse: wallet_metrics_complete (102 metrics)
```

### 3. Smart Investor Index Flow (Market-level signal)
```
wallet_scores table → /api/markets/[id]/sii
                   → market_sii table (cache)
                   → Returns which side has smarter money
```

### 4. Strategy Execution Flow
```
Strategy definition → /api/strategies/execute
                  → Evaluate node graph
                  → Generate watchlist items
                  → Create positions (optional)
```

### 5. ClickHouse Analytics Pipeline
```
Goldsky + Polymarket APIs → Sync scripts
                          → trades_raw (ClickHouse)
                          → wallet_metrics_complete (102 metrics)
                          → Materialized views for aggregations
```

---

## Key Calculations

### Omega Ratio
```
omega = sum(positive PnLs) / sum(absolute negative PnLs)

Example: [+100, +50, -30, -20] → (100+50) / (30+20) = 150/50 = 3.0 (S grade)
```

### SII Signal Strength
```
1. Get avg Omega of top 20 YES holders
2. Get avg Omega of top 20 NO holders
3. Signal strength = min(abs(YES_avg - NO_avg) / 2.0, 1.0)
   - > 0.7 = Strong signal
   - > 0.5 = Moderate signal
   - < 0.3 = Weak signal
```

### Win Rate
```
win_rate = (winning_trades / total_closed_trades)

Example: [+100, +50, -30] → 2/3 = 66.7% (good)
```

### Timing Score (Insider Detection)
```
For each trade, measure how prescient:
timing_score = (price_1hr_after - entry_price) / entry_price

High average timing score → suspected insider
```

### Capital Efficiency
```
ev_per_hour_capital = (total_pnl / hours_active) / avg_capital_deployed

Higher = more efficient capital use
```

---

## API Endpoints by Category

### Market Data
- `GET /api/polymarket/markets` - List markets
- `GET /api/polymarket/markets/[id]` - Market details
- `GET /api/polymarket/holders` - Market participants
- `GET /api/polymarket/ohlc/[marketId]` - Price history

### Wallet Metrics
- `GET /api/wallets/[address]/score` - Omega score (cached 1hr)
- `GET /api/wallets/[address]/metrics` - All metrics
- `GET /api/wallets/top` - Leaderboard
- `GET /api/omega/leaderboard` - Ranking by grade

### Smart Money Signals
- `GET /api/markets/[id]/sii` - Smart Investor Index
- `GET /api/insiders/wallets` - Suspected insiders
- `GET /api/whale/trades` - Recent whale trades
- `GET /api/whale/scoreboard` - Whale rankings

### Strategies
- `GET /api/strategies` - List strategies
- `POST /api/strategies/execute` - Run strategy manually
- `GET /api/strategies/[id]/performance` - Backtest results

### Category Analysis
- `GET /api/austin/categories` - Category stats
- `GET /api/austin/categories/[category]` - Top traders per category
- `GET /api/austin/recommend` - Recommendations

---

## Data Update Frequencies

| Data | Frequency | Latency |
|------|-----------|---------|
| Markets (prices, volume) | Real-time | 1-2 sec |
| Market analytics (trades, momentum) | Every 1-5 min | 5-10 sec |
| Wallet positions (open) | On-demand | Real-time |
| Wallet trades (historical) | Incremental | 1-5 min |
| Wallet scores (Omega) | 1 hour cache | Fresh on demand |
| Whale activity | Real-time | 1-2 sec |
| ClickHouse metrics | Nightly + on-demand | 1-24 hrs |

---

## Common Queries

### Find top traders in a category
```sql
SELECT wallet_address, omega_ratio, win_rate, grade
FROM wallet_scores_by_category
WHERE category = 'Politics' 
  AND meets_minimum_trades = TRUE
ORDER BY omega_ratio DESC
LIMIT 10;
```

### Find which side smart money favors in a market
```sql
GET /api/markets/{market_id}/sii
-- Returns: smart_money_side, omega_differential, signal_strength
```

### Find wallet's recent trades
```
GET /api/polymarket/wallet/{address}/trades?limit=100
```

### Find markets with strongest smart money signals
```
GET /api/markets/strongest?limit=20
```

### Find suspected insider wallets
```
GET /api/insiders/wallets?limit=50
```

---

## Key Design Patterns

### Pattern 1: Lazy Calculation + Caching
- Metrics computed on-demand (e.g., Omega score)
- Cached in Supabase (1 hour default)
- Can be refreshed with `?fresh=true`

### Pattern 2: Multiple Time Windows
- Same metrics calculated for 7d, 30d, 90d, lifetime
- In ClickHouse: `window` enum (30d, 90d, 180d, lifetime)
- Use to detect trends and momentum

### Pattern 3: Category Specialization
- 102 metrics broken down by market category
- Identify traders who excel in specific domains
- "Best Politics traders", "Best Crypto predictors", etc.

### Pattern 4: Smart Money Flow
- Track wallets with high Omega scores
- Monitor their position changes
- Generate signals when they trade
- Enable copy trading features

### Pattern 5: Edge Durability (Copyability)
- Measure Omega with copy delays (30s, 2min, 5min)
- Identify which traders can be profitably copied
- Omega lag metrics show decay of edge

---

## Important Notes

### Goldsky PnL Correction
- Goldsky PnL values are 13.2399x too high
- Applied correction factor in `lib/metrics/omega-from-goldsky.ts`
- Empirically verified against Polymarket profiles

### Minimum Trade Requirement
- Omega score only considered valid if >= 5 closed trades
- This is Austin's requirement for credibility
- `meets_minimum_trades` boolean in wallet_scores

### SII Interpretation
- `omega_differential = YES_avg_omega - NO_avg_omega`
- Positive = smart money on YES
- Negative = smart money on NO
- Magnitude = conviction level

### Caching Strategy
- Omega scores: 1 hour (can customize with `?ttl=seconds`)
- Market data: 5-30 minutes
- Wallets: 5-10 minutes
- Refresh with `?fresh=true` to bypass cache

---

## Files Reference

### Key Type Definitions
- `/lib/strategy-builder/types.ts` - 102 metrics interface
- `/lib/metrics/omega-from-goldsky.ts` - Omega calculation
- `/lib/metrics/market-sii.ts` - SII calculation

### Key Implementations
- `/lib/polymarket/client.ts` - Polymarket API client
- `/lib/goldsky/client.ts` - Goldsky GraphQL client
- `/lib/clickhouse/client.ts` - ClickHouse client

### Migrations
- `supabase/migrations/` - PostgreSQL migrations (25+ files)
- `migrations/clickhouse/` - ClickHouse schema (13 files)

### Scripts
- `scripts/calculate-omega-scores.ts` - Omega calculation
- `scripts/setup-clickhouse-schema.ts` - ClickHouse setup
- `scripts/sync-wallet-trades.ts` - Data sync

---

## Database File Locations

- **Documentation**: `/CASCADIAN_DATABASE_STRUCTURE.md` (full reference)
- **This file**: `/DATABASE_QUICK_REFERENCE.md`
- **Supabase migrations**: `/supabase/migrations/`
- **ClickHouse migrations**: `/migrations/clickhouse/`
- **Type definitions**: `/lib/` directory

---

Generated: 2025-10-26
