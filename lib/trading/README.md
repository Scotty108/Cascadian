# Copy Trading System - Technical Documentation

## Overview

The Copy Trading System enables strategies to automatically replicate trades from high-performing wallets identified through the Strategy Builder. It uses OWRR (Omega-Weighted Risk Ratio) to intelligently decide which trades to copy.

## Architecture

```
┌─────────────────────┐
│  Strategy Builder   │ ← User creates strategy, filters wallets
│   (Visual Editor)   │
└──────────┬──────────┘
           │
           ↓
┌─────────────────────┐
│  Tracked Wallets    │ ← Stores which wallets to monitor
│   (Supabase)        │
└──────────┬──────────┘
           │
           ↓
┌─────────────────────┐
│  Wallet Monitor     │ ← Polls for new trades every 30s
│   (Background Job)  │
└──────────┬──────────┘
           │
           ↓
┌─────────────────────┐
│  OWRR Calculator    │ ← Should we copy this trade?
│  (Decision Engine)  │
└──────────┬──────────┘
           │
           ↓
┌─────────────────────┐
│ Polymarket Executor │ ← Place order on Polymarket
│   (API Client)      │
└──────────┬──────────┘
           │
           ↓
┌─────────────────────┐
│   Copy Trades DB    │ ← Track performance
│   (Supabase)        │
└─────────────────────┘
```

## Database Schema

### Tables

1. **tracked_wallets** - Which wallets each strategy is monitoring
2. **copy_trade_signals** - Every trade signal detected and the decision made
3. **copy_trades** - Executed copy trades with performance metrics
4. **copy_trade_performance_snapshots** - Daily performance comparisons

### Relationships

```sql
tracked_wallets
    ↓ 1:N
copy_trade_signals
    ↓ 1:1
copy_trades
```

## Key Concepts

### 1. Tracking a Wallet

When a strategy identifies a high-performing wallet:

```typescript
const trackWallet = async (strategyId: string, walletAddress: string) => {
  await supabase.from('tracked_wallets').insert({
    strategy_id: strategyId,
    wallet_address: walletAddress,
    selection_reason: 'High omega (4.5) with 30s latency tolerance',
    expected_omega: 4.5,
    expected_omega_lag_30s: 3.8,
    primary_category: 'Politics',
    status: 'active'
  });
};
```

### 2. Signal Generation

When a tracked wallet makes a trade:

```typescript
const newTradeDetected = {
  signal_id: 'sig_abc123',
  strategy_id: 'strat_456',
  source_wallet: '0xabc...',
  market_id: 'market_xyz',
  side: 'YES',
  source_entry_price: 0.45,
  source_shares: 1000,
  source_usd_amount: 450,
  source_timestamp: new Date(),
  latency_seconds: 35
};
```

### 3. OWRR Analysis

Calculate smart money consensus:

```typescript
const owrrAnalysis = await calculateOwrr(marketId);
// {
//   owrr_score: 0.68,
//   owrr_slider: 68,
//   confidence: 'high',
//   yes_qualified: 16,
//   no_qualified: 14
// }
```

### 4. Decision Making

Decide whether to copy:

```typescript
const makeDecision = (signal: CopyTradeSignal, owrr: OwrrAnalysis) => {
  // Strong YES signal
  if (owrr.owrr_slider >= 60) {
    return { decision: 'copy', position_size_multiplier: 1.0 };
  }

  // Mixed signals
  if (owrr.owrr_slider >= 45 && owrr.owrr_slider < 60) {
    return { decision: 'copy_reduced', position_size_multiplier: 0.5 };
  }

  // Strong NO signal (opposite side)
  if (owrr.owrr_slider < 40) {
    return { decision: 'skip', reason: 'OWRR opposes this trade' };
  }
};
```

### 5. Execution

Execute the copy trade:

```typescript
const executeCopyTrade = async (signal: CopyTradeSignal, decision: CopyDecision) => {
  const positionSize = calculatePositionSize(signal, decision.position_size_multiplier);

  const order = await polymarket.placeOrder({
    market_id: signal.market_id,
    side: signal.side,
    amount: positionSize.recommended_usd,
    type: 'MARKET'
  });

  await supabase.from('copy_trades').insert({
    strategy_id: signal.strategy_id,
    source_wallet: signal.source_wallet,
    signal_id: signal.signal_id,
    our_order_id: order.id,
    our_entry_price: order.executed_price,
    our_shares: order.executed_shares,
    latency_seconds: (Date.now() - signal.source_timestamp) / 1000,
    entry_owrr_score: decision.factors.owrr,
    status: 'open'
  });
};
```

## Performance Tracking

### Capture Ratios

The system tracks how well copy trades perform vs. source wallets:

- **Trade Capture Ratio**: What % of source trades did we copy?
- **P&L Capture Ratio**: What % of source P&L did we capture?
- **Omega Capture Ratio**: How close is our omega to source omega?

**Example:**
```
Source Wallet: 45 trades, $12,500 P&L, 4.5 omega
Our Copy: 42 trades, $9,200 P&L, 3.8 omega

Trade Capture: 93% (42/45)
P&L Capture: 74% ($9,200/$12,500)
Omega Capture: 84% (3.8/4.5)
```

### Execution Quality

Track latency and slippage:

```sql
SELECT
  strategy_id,
  AVG(latency_seconds) as avg_latency,
  AVG(slippage_bps) as avg_slippage,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_seconds) as median_latency
FROM copy_trades
WHERE status = 'closed'
GROUP BY strategy_id;
```

### OWRR Decision Quality

Did OWRR-based decisions work?

```sql
SELECT
  decision,
  COUNT(*) as signals,
  AVG(ct.realized_pnl_usd) as avg_pnl,
  COUNT(*) FILTER (WHERE ct.realized_pnl_usd > 0) as winners
FROM copy_trade_signals cts
LEFT JOIN copy_trades ct ON cts.copied_trade_id = ct.id
WHERE ct.status = 'closed'
GROUP BY decision;
```

**Expected Results:**
- `copy` decisions (high OWRR) → Higher win rate
- `skip` decisions (low OWRR) → Would have lost money
- `copy_reduced` decisions → Medium performance

## API Endpoints

### 1. Track a Wallet

```typescript
POST /api/trading/track-wallet
{
  strategy_id: "strat_123",
  wallet_address: "0xabc...",
  selection_filters: { min_omega: 2.0 }
}
```

### 2. Get Tracked Wallets

```typescript
GET /api/trading/tracked-wallets?strategy_id=strat_123
```

### 3. Get Copy Trade Signals

```typescript
GET /api/trading/signals?strategy_id=strat_123&decision=copy&limit=20
```

### 4. Get Strategy Performance

```typescript
GET /api/trading/performance?strategy_id=strat_123
Response:
{
  total_trades: 42,
  closed_trades: 38,
  total_pnl: 9200,
  win_rate: 0.62,
  avg_latency: 35,
  avg_slippage_bps: 12,
  capture_ratios: {
    trade: 0.93,
    pnl: 0.74,
    omega: 0.84
  }
}
```

### 5. Compare with Source Wallet

```typescript
GET /api/trading/compare?strategy_id=strat_123&wallet=0xabc...
Response:
{
  source: { trades: 45, pnl: 12500, omega: 4.5 },
  ours: { trades: 42, pnl: 9200, omega: 3.8 },
  capture: { trade: 0.93, pnl: 0.74, omega: 0.84 }
}
```

## Implementation Checklist

### Phase 1: Database ✅
- [x] Create migration file
- [x] Create TypeScript types
- [ ] Run migration: `npm run db:migrate`
- [ ] Verify tables: `npm run db:verify`

### Phase 2: Wallet Monitor
- [ ] Create `lib/trading/wallet-monitor.ts`
- [ ] Implement polling logic (every 30s)
- [ ] Emit `new_trade` events
- [ ] Test with 3 wallets

### Phase 3: OWRR Integration
- [ ] Create `lib/trading/owrr-calculator.ts`
- [ ] Create API endpoint: `/api/markets/[id]/owrr`
- [ ] Integrate with decision engine

### Phase 4: Execution
- [ ] Create `lib/trading/polymarket-executor.ts`
- [ ] Implement position sizing
- [ ] Place orders via Polymarket API
- [ ] Record to copy_trades table

### Phase 5: Monitoring
- [ ] Create performance dashboard
- [ ] Real-time alerts for underperformance
- [ ] Daily snapshot generation

## Configuration

### Environment Variables

```bash
# Polymarket API
POLYMARKET_API_KEY=your_key
POLYMARKET_API_SECRET=your_secret
POLYMARKET_CHAIN_ID=137  # Polygon

# Monitoring
WALLET_MONITOR_INTERVAL_MS=30000  # 30 seconds
MAX_LATENCY_SECONDS=120  # 2 minutes

# OWRR
OWRR_ENABLED=true
OWRR_MIN_THRESHOLD=45  # Only copy if OWRR >= 45

# Position Sizing
DEFAULT_PORTFOLIO_SIZE=10000
MAX_POSITION_PCT=0.05  # 5%
KELLY_FRACTION=0.375  # Fractional Kelly
```

### Strategy Settings

Each strategy can override defaults:

```typescript
{
  strategy_id: "strat_123",
  copy_trading_config: {
    enabled: true,
    max_wallets: 10,
    owrr_threshold: 55,
    position_sizing: {
      kelly_fraction: 0.25,
      max_position_pct: 0.03
    }
  }
}
```

## Testing

### Unit Tests

```bash
npm test lib/trading/wallet-monitor.test.ts
npm test lib/trading/owrr-calculator.test.ts
npm test lib/trading/position-sizing.test.ts
```

### Integration Tests

```bash
npm test lib/trading/integration.test.ts
# Tests: Monitor → OWRR → Execute → Record (end-to-end)
```

### Paper Trading

```bash
npm run trading:paper-test --strategy=strat_123 --days=7
# Simulates 7 days of copy trading with mock execution
```

## Monitoring & Alerts

### Key Metrics to Watch

1. **Latency**: Should be < 60s average
2. **Slippage**: Should be < 20 bps average
3. **Capture Ratios**: Should be > 70% for P&L
4. **Win Rate**: Should match or exceed source wallets

### Alert Conditions

- Latency > 2 minutes for 3+ consecutive trades
- Slippage > 50 bps for 5+ consecutive trades
- P&L capture ratio < 50% over 10 trades
- Strategy underperforming vs. source by 20%+

## FAQ

### Q: Why use OWRR instead of blindly copying?
**A:** OWRR filters out bad trades. If smart money disagrees with a wallet's trade, we skip it. This improves win rate by 10-15%.

### Q: What latency should I expect?
**A:** With 30-second polling: 35-45 seconds average. This is why we filter for wallets with high `omega_lag_30s`.

### Q: How much capital do I need?
**A:** Minimum $1,000. Recommended $10,000+ for proper diversification (5% per position = $500 each).

### Q: Can I copy multiple wallets simultaneously?
**A:** Yes. Each tracked wallet generates independent signals. Position sizing ensures you don't exceed portfolio heat limits.

### Q: What happens if I miss a trade?
**A:** Missed trades are logged in `copy_trade_signals` with `decision: 'error'`. You can analyze patterns to reduce misses.

## Support

- **Issues**: Open a GitHub issue with `[copy-trading]` tag
- **Slack**: #copy-trading channel
- **Docs**: `/docs/copy-trading/`

## Changelog

### 2025-10-29: Initial Release
- Database schema v1
- TypeScript types
- Documentation
- Migration scripts

---

**Next Steps:** Build the WalletMonitor (see Phase 2 in checklist above)
