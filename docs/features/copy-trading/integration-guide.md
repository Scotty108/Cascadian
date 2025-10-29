# Copy Trading Integration into Strategy Builder

## Implementation Summary

Successfully integrated the WalletMonitor copy trading system into the existing Strategy Builder workflow, enabling automatic trade copying from tracked wallets when strategies with ORCHESTRATOR nodes are deployed.

## Files Modified/Created

### 1. Type Definitions Extended
**File**: `/lib/strategy-builder/types.ts`

- Extended `OrchestratorConfig` interface to include optional `copy_trading` configuration
- Added fields for poll interval, OWRR thresholds, max latency, and tracked categories
- Maintains backward compatibility (optional field)

### 2. UI Configuration Panel Updated
**File**: `/components/strategy-builder/orchestrator-node/orchestrator-config-panel.tsx`

- Added copy trading toggle switch in ORCHESTRATOR config panel
- New UI section for configuring:
  - Enable/disable copy trading
  - Poll interval (30s, 60s, 120s)
  - Max latency threshold
  - OWRR thresholds (min_yes, min_no, min_confidence)
- Integrated validation for copy trading settings
- Updated configuration summary to show copy trading status

### 3. Wallet Monitor Activation API
**File**: `/app/api/trading/activate-monitor/route.ts` (NEW)

Endpoints:
- **POST** - Activates copy trading monitor for a strategy
- **GET** - Lists all active copy trading monitors
- **DELETE** - Deactivates copy trading for a strategy

Features:
- Stores copy trading configuration in `strategy_definitions.copy_trading_config`
- Validates strategy_id and configuration
- Returns activation status and configuration

### 4. Wallet Monitor Cron Job
**File**: `/app/api/cron/wallet-monitor/route.ts` (NEW)

- Called every minute by Vercel cron
- Polls WalletMonitor singleton
- Returns execution stats (strategies checked, new trades, signals generated)
- Error handling with proper status codes

### 5. Strategy Deployment Flow Updated
**File**: `/app/(dashboard)/strategy-builder/page.tsx`

Modified `handleDeploy` function to:
- Check for ORCHESTRATOR nodes with copy trading enabled after deployment
- Call `/api/trading/activate-monitor` to activate monitoring
- Non-fatal error handling (deployment continues even if monitor activation fails)
- Logs activation status for debugging

### 6. WalletMonitor Core Updated
**File**: `/lib/trading/wallet-monitor.ts`

Updated to query strategies with copy trading enabled:
- Changed `getActiveStrategies()` to look for `copy_trading_config` field
- Filters strategies where `copy_trading_config.enabled === true`
- Already uses `strategy_watchlist_items` for tracked wallets (no change needed)
- Updated Strategy interface to include copy_trading_config and node_graph

### 7. Vercel Cron Configuration
**File**: `/vercel.json`

Added new cron job:
```json
{
  "path": "/api/cron/wallet-monitor",
  "schedule": "* * * * *"
}
```

Runs every minute to poll for new trades from tracked wallets.

## Data Flow

```
Strategy Builder (User creates workflow)
    ↓
ORCHESTRATOR node (user enables copy trading in config panel)
    ↓
handleDeploy() (strategy deployed)
    ↓
Check for ORCHESTRATOR.copy_trading.enabled
    ↓
POST /api/trading/activate-monitor (stores config in DB)
    ↓
strategy_definitions.copy_trading_config updated
    ↓
Vercel Cron (every minute)
    ↓
GET /api/cron/wallet-monitor
    ↓
WalletMonitor.poll()
    ↓
Query strategy_definitions WHERE copy_trading_config.enabled = true
    ↓
Query strategy_watchlist_items WHERE item_type = 'WALLET'
    ↓
Poll ClickHouse trades_raw for new trades
    ↓
Calculate OWRR for each trade's market
    ↓
DecisionEngine.decide() (copy/skip/copy_reduced)
    ↓
Save signal to copy_trade_signals table
    ↓
PolymarketExecutor.execute() (if decision is copy)
    ↓
Record to copy_trades table
```

## Key Integration Points

### From Strategy Builder to Copy Trading:
1. User creates strategy with DATA_SOURCE → FILTER → ORCHESTRATOR → ACTION nodes
2. User clicks ORCHESTRATOR node to configure
3. User enables "Copy Trading" toggle
4. User configures poll interval, OWRR thresholds, max latency
5. User saves ORCHESTRATOR configuration
6. User deploys strategy
7. Deployment handler detects copy trading is enabled
8. Calls activation endpoint to store config
9. Cron job picks up strategy and starts monitoring

### From Watchlist to Copy Trading:
1. Strategy execution adds wallets to watchlist (via ACTION node)
2. WalletMonitor queries watchlist items where item_type = 'WALLET'
3. Monitors those wallets for new trades
4. Applies ORCHESTRATOR's position sizing rules
5. Uses OWRR thresholds from ORCHESTRATOR config

## Configuration Options

### ORCHESTRATOR Copy Trading Settings:

```typescript
{
  enabled: boolean;                     // Master toggle
  poll_interval_seconds: 30 | 60 | 120; // How often to check for trades
  owrr_thresholds: {
    min_yes: number;                    // Min OWRR for YES trades (0-1)
    min_no: number;                     // Min OWRR for NO trades (0-1)
    min_confidence: 'high' | 'medium' | 'low'; // Min confidence level
  };
  max_latency_seconds: number;          // Skip trades older than this (30-300)
  tracked_categories?: string[];        // Optional: filter by categories
}
```

### Default Values:
- poll_interval_seconds: 60
- min_yes: 0.65
- min_no: 0.60
- min_confidence: 'medium'
- max_latency_seconds: 120

## Safety Features

1. **TRADING_ENABLED** environment variable (default: false)
   - Must be explicitly enabled to allow actual trading
   - Can be toggled without code changes

2. **MOCK_TRADING** mode (default: true)
   - Simulates trades without executing
   - Full logging for testing

3. **Non-fatal errors**
   - Monitor activation failure doesn't fail deployment
   - Signal logging errors don't stop processing
   - Graceful error handling throughout

4. **Comprehensive logging**
   - All actions logged with [WalletMonitor] prefix
   - Execution stats tracked and returned
   - Error messages captured and returned

## Testing Workflow

1. **Create Strategy**:
   - Add DATA_SOURCE node (query wallets)
   - Add FILTER node (omega > 2.0)
   - Add ORCHESTRATOR node
   - Add ACTION node (add to watchlist)

2. **Configure ORCHESTRATOR**:
   - Set portfolio size: $10,000
   - Set risk tolerance: 5/10
   - Enable copy trading
   - Set poll interval: 60s
   - Set OWRR thresholds: YES=0.65, NO=0.60
   - Set max latency: 120s

3. **Deploy Strategy**:
   - Click "Deploy" button
   - Select execution frequency (1min, 5min, etc.)
   - Enable auto-start
   - Confirm deployment

4. **Verify Activation**:
   - Check console for "[Deploy] Copy trading monitor activated"
   - Query `GET /api/trading/activate-monitor` to see active monitors
   - Should show strategy with copy_trading_config

5. **Add Wallets to Watchlist**:
   - Either manually add wallets via UI
   - Or let strategy execution populate watchlist

6. **Monitor Execution**:
   - Check `/api/cron/wallet-monitor` logs
   - Should show strategies checked, wallets tracked
   - When trades detected, should show signals generated

7. **View Results**:
   - Query `copy_trade_signals` table for decision history
   - Query `copy_trades` table for executed trades
   - Check performance metrics

## Database Schema Requirements

### Required Tables:
1. **strategy_definitions**:
   - Add JSONB column: `copy_trading_config`

2. **strategy_watchlist_items** (already exists):
   - Used to track wallets per strategy

3. **copy_trade_signals** (already exists):
   - Records all trade signals and decisions

4. **copy_trades** (already exists):
   - Records executed copy trades

## Environment Variables

```bash
# Enable trading (required for production)
TRADING_ENABLED=true

# Enable mock mode (recommended for testing)
MOCK_TRADING=true

# Standard Supabase/ClickHouse credentials
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
CLICKHOUSE_HOST=...
CLICKHOUSE_USER=...
CLICKHOUSE_PASSWORD=...
```

## Future Enhancements

1. **Real-time WebSocket Updates**:
   - Stream trade signals to UI in real-time
   - Show execution status live

2. **Performance Dashboard**:
   - Per-strategy copy trading metrics
   - Wallet-by-wallet performance comparison
   - OWRR effectiveness analysis

3. **Advanced Filters**:
   - Category-specific OWRR thresholds
   - Time-of-day restrictions
   - Market-specific rules

4. **Position Management**:
   - Automatic stop-loss triggers
   - Take-profit targets
   - Portfolio rebalancing

5. **Multi-Strategy Coordination**:
   - Prevent duplicate trades across strategies
   - Portfolio-level heat management
   - Cross-strategy risk limits

## Conclusion

Copy trading is now fully integrated into the Strategy Builder workflow. Users can:
- Enable copy trading through familiar UI (ORCHESTRATOR node)
- Configure thresholds and timing parameters
- Deploy strategies that automatically monitor and copy trades
- Use existing watchlist infrastructure
- Leverage ORCHESTRATOR's position sizing rules

The integration is production-ready with proper safety controls, error handling, logging, and monitoring.
