# WalletMonitor File Structure

## New Files to Create

```
cascadian-app/
├── lib/
│   └── wallet-monitor/
│       ├── index.ts                    # Main WalletMonitor class
│       ├── types.ts                    # TypeScript types and interfaces
│       ├── owrr-calculator.ts          # OWRR wrapper with caching
│       ├── decision-engine.ts          # Copy/skip decision logic
│       ├── polymarket-executor.ts      # Trade execution
│       ├── position-updater.ts         # Mark-to-market updates
│       ├── logger.ts                   # Structured logging
│       ├── metrics.ts                  # Performance tracking
│       └── alerts.ts                   # Alert system
│
├── app/
│   └── api/
│       └── cron/
│           └── wallet-monitor/
│               └── route.ts            # Cron endpoint (30s)
│
├── supabase/
│   └── migrations/
│       └── 20251029_wallet_monitor_signals.sql  # New table + schema updates
│
├── __tests__/
│   └── wallet-monitor/
│       ├── decision-engine.test.ts     # Unit tests for decision logic
│       ├── owrr-calculator.test.ts     # Unit tests for caching
│       ├── position-sizing.test.ts     # Unit tests for calculations
│       └── integration.test.ts         # End-to-end tests
│
├── components/
│   ├── wallet-monitor-signals/
│   │   └── index.tsx                   # Signals table dashboard
│   ├── strategy-settings-interface/
│   │   └── copy-trading-config.tsx     # Configuration UI
│   └── wallet-monitor-performance/
│       └── index.tsx                   # Performance dashboard
│
└── docs/
    ├── wallet-monitor-implementation-plan.md   # Full implementation plan
    ├── wallet-monitor-summary.md               # Executive summary
    └── wallet-monitor-file-structure.md        # This file
```

## Files to Modify

```
cascadian-app/
├── vercel.json                         # Add new cron job (30s interval)
├── lib/
│   └── polymarket/
│       └── trading-client.ts           # Add order placement methods (Phase 3)
└── supabase/
    └── migrations/
        └── 20251025200000_create_strategy_position_tracking.sql  
                                        # Already exists, no changes needed
```

## Existing Files (Reused)

These files are used by the WalletMonitor but don't need changes:

```
cascadian-app/
├── lib/
│   ├── metrics/
│   │   └── owrr.ts                     # OWRR calculation (reused as-is)
│   ├── clickhouse/
│   │   └── client.ts                   # ClickHouse connector (reused)
│   ├── strategy-builder/
│   │   ├── execution-engine.ts         # Pattern reference
│   │   └── clickhouse-connector.ts     # Query pattern reference
│   └── polymarket/
│       └── client.ts                   # Polymarket API client
└── supabase/
    └── migrations/
        └── 20251025200000_create_strategy_position_tracking.sql
                                        # Position/trade tables (reused)
```

## Directory Breakdown

### `/lib/wallet-monitor/` (Core Logic)
All business logic lives here:
- **index.ts**: Main orchestrator (WalletMonitor class)
- **owrr-calculator.ts**: Wrapper for OWRR with caching
- **decision-engine.ts**: 7-step decision algorithm
- **polymarket-executor.ts**: Trade execution (mock + real)
- **position-updater.ts**: Mark-to-market updates
- **logger.ts**: Structured logging utilities
- **metrics.ts**: Performance counters
- **alerts.ts**: Alert/notification system

### `/app/api/cron/wallet-monitor/` (API)
Single endpoint called by Vercel Cron:
- **route.ts**: Auth verification + WalletMonitor.poll()

### `/supabase/migrations/` (Database)
Single migration file:
- **20251029_wallet_monitor_signals.sql**: New table + schema updates

### `/__tests__/wallet-monitor/` (Tests)
Comprehensive test coverage:
- **decision-engine.test.ts**: Test all 7 decision rules
- **owrr-calculator.test.ts**: Test caching and fallbacks
- **position-sizing.test.ts**: Test position size calculations
- **integration.test.ts**: Test end-to-end flow

### `/components/` (UI)
Three new component directories:
- **wallet-monitor-signals/**: Signals table view
- **strategy-settings-interface/copy-trading-config.tsx**: Settings UI
- **wallet-monitor-performance/**: Performance charts

### `/docs/` (Documentation)
Three planning documents:
- **wallet-monitor-implementation-plan.md**: Full 2000+ line spec
- **wallet-monitor-summary.md**: Executive summary
- **wallet-monitor-file-structure.md**: This file

## Implementation Order

### Phase 1: Core (Files 1-9)
1. `/supabase/migrations/20251029_wallet_monitor_signals.sql`
2. `/lib/wallet-monitor/types.ts`
3. `/lib/wallet-monitor/index.ts`
4. `/lib/wallet-monitor/owrr-calculator.ts`
5. `/lib/wallet-monitor/decision-engine.ts`
6. `/lib/wallet-monitor/polymarket-executor.ts`
7. `/app/api/cron/wallet-monitor/route.ts`
8. `/vercel.json` (update)
9. `/lib/wallet-monitor/logger.ts`

### Phase 2: Testing (Files 10-13)
10. `/__tests__/wallet-monitor/decision-engine.test.ts`
11. `/__tests__/wallet-monitor/owrr-calculator.test.ts`
12. `/__tests__/wallet-monitor/position-sizing.test.ts`
13. `/__tests__/wallet-monitor/integration.test.ts`

### Phase 3: Real Execution (Files 14-15)
14. `/lib/polymarket/trading-client.ts` (update)
15. `/lib/wallet-monitor/position-updater.ts`

### Phase 4: Monitoring (Files 16-17)
16. `/lib/wallet-monitor/metrics.ts`
17. `/lib/wallet-monitor/alerts.ts`

### Phase 5: UI (Files 18-20)
18. `/components/wallet-monitor-signals/index.tsx`
19. `/components/strategy-settings-interface/copy-trading-config.tsx`
20. `/components/wallet-monitor-performance/index.tsx`

## File Size Estimates

| File | Lines | Complexity |
|------|-------|-----------|
| index.ts | 300-400 | High |
| decision-engine.ts | 250-350 | High |
| polymarket-executor.ts | 200-300 | Medium |
| owrr-calculator.ts | 100-150 | Low |
| position-updater.ts | 150-200 | Medium |
| route.ts | 80-100 | Low |
| types.ts | 100-150 | Low |
| logger.ts | 50-80 | Low |
| metrics.ts | 80-120 | Low |
| alerts.ts | 100-150 | Medium |
| migration.sql | 80-100 | Low |
| **Total** | **~1,500-2,100** | |

## Dependencies

### NPM Packages (Existing)
- `@supabase/supabase-js` - Already installed
- `@clickhouse/client` - Already installed
- No new packages needed for Phase 1-2

### NPM Packages (Phase 3)
- `@polymarket/sdk` or similar - For real trade execution
- May need wallet integration libraries

### Environment Variables
```bash
# Existing (reused)
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
CLICKHOUSE_HOST
CLICKHOUSE_USER
CLICKHOUSE_PASSWORD

# New (required)
CRON_SECRET                    # Auth for cron endpoint
POLYMARKET_MOCK_MODE           # true/false (default: true)

# New (Phase 3)
POLYMARKET_API_KEY             # For real execution
POLYMARKET_WALLET_PRIVATE_KEY  # For signing transactions
```

## Database Changes

### New Table: `wallet_monitor_signals`
- Primary key: `id` (UUID)
- Foreign keys: `strategy_id`, `position_id`
- Indexes: 4 (strategy_time, wallet, market, decision)
- Size estimate: ~100 KB per 1000 signals

### Updated Table: `strategy_settings`
- New column: `copy_trading_config` (JSONB)
- No new indexes
- Backward compatible (default value provided)

### No Changes To:
- `strategy_positions`
- `strategy_trades`
- `strategy_watchlist_items`
- `strategy_definitions`

## Integration Points

### Reads From (Existing Data)
- ClickHouse `trades_raw` - New trades
- ClickHouse `wallet_metrics_by_category` - Omega ratios
- Supabase `strategy_settings` - Strategy config
- Supabase `strategy_watchlist_items` - Tracked wallets
- Supabase `strategy_positions` - Open positions

### Writes To (New/Updated Data)
- Supabase `wallet_monitor_signals` - All signals
- Supabase `strategy_positions` - New positions
- Supabase `strategy_trades` - Executed trades
- Supabase `strategy_settings` - Balance updates

### External APIs
- Polymarket API (Phase 3)
  - Order placement
  - Order status
  - Market prices

## Testing Files Location

```
__tests__/
└── wallet-monitor/
    ├── __fixtures__/
    │   ├── sample-trades.json          # Mock trade data
    │   ├── sample-owrr.json            # Mock OWRR results
    │   └── sample-strategies.json      # Mock strategy configs
    ├── decision-engine.test.ts
    ├── owrr-calculator.test.ts
    ├── position-sizing.test.ts
    └── integration.test.ts
```

## Component Files (Phase 5)

```
components/
├── wallet-monitor-signals/
│   ├── index.tsx                       # Main component
│   ├── signals-table.tsx               # Table view
│   ├── signal-filters.tsx              # Filter controls
│   └── types.ts                        # Local types
├── strategy-settings-interface/
│   └── copy-trading-config.tsx         # Config form
└── wallet-monitor-performance/
    ├── index.tsx                       # Dashboard
    ├── performance-chart.tsx           # P&L chart
    ├── signals-breakdown.tsx           # Copy vs Skip
    └── types.ts                        # Local types
```

## Documentation Files

All in `/docs/`:
1. `wallet-monitor-implementation-plan.md` (2000+ lines)
2. `wallet-monitor-summary.md` (200 lines)
3. `wallet-monitor-file-structure.md` (this file, 300 lines)

---

## Quick Start Guide

To begin implementation:

```bash
# 1. Create directory structure
mkdir -p lib/wallet-monitor
mkdir -p app/api/cron/wallet-monitor
mkdir -p __tests__/wallet-monitor
mkdir -p components/wallet-monitor-signals
mkdir -p components/wallet-monitor-performance

# 2. Create stub files
touch lib/wallet-monitor/{index,types,owrr-calculator,decision-engine,polymarket-executor}.ts
touch app/api/cron/wallet-monitor/route.ts
touch supabase/migrations/20251029_wallet_monitor_signals.sql

# 3. Start with database
# Edit supabase/migrations/20251029_wallet_monitor_signals.sql
# Run migration locally

# 4. Implement core classes
# Start with types.ts, then index.ts, etc.

# 5. Add cron endpoint
# Edit app/api/cron/wallet-monitor/route.ts
# Update vercel.json

# 6. Test locally
npm run dev
curl -X POST http://localhost:3000/api/cron/wallet-monitor \
  -H "Authorization: Bearer test-secret"
```

---

**Ready to code? Start with the database migration! 🚀**
