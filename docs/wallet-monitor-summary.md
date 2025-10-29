# WalletMonitor Implementation - Executive Summary

## Overview

Production-ready copy trading system that:
- Polls ClickHouse every 30 seconds for new trades from tracked wallets
- Computes OWRR (smart money consensus) for each trade's market
- Makes intelligent copy/skip decisions based on signal strength
- Executes positions via Polymarket API with proper position sizing
- Tracks performance and manages risk

## Architecture

```
Vercel Cron (30s) → API Endpoint → WalletMonitor.poll()
                                         ↓
                    ┌────────────────────┴────────────────────┐
                    ↓                    ↓                     ↓
              OWRRCalculator      DecisionEngine      PolymarketExecutor
                    ↓                    ↓                     ↓
              ClickHouse           Supabase              Polymarket API
```

## Core Components

### 1. WalletMonitor (`lib/wallet-monitor/index.ts`)
Main orchestrator that:
- Fetches active strategies with auto-execute enabled
- Queries ClickHouse for new trades from tracked wallets
- Processes each trade through OWRR → Decision → Execution pipeline
- Updates all open positions with current prices

### 2. OWRRCalculator (`lib/wallet-monitor/owrr-calculator.ts`)
Wraps existing OWRR logic with:
- In-memory caching (5 minute TTL)
- Retry logic for ClickHouse failures
- Fallback to stale cache or neutral OWRR

### 3. DecisionEngine (`lib/wallet-monitor/decision-engine.ts`)
Implements 7-step decision algorithm:
1. Category filter
2. OWRR threshold (YES > 60, NO < 40)
3. OWRR confidence (high/medium only)
4. Position limits (max concurrent positions)
5. Capital availability
6. Position sizing (scaled by OWRR strength)
7. Minimum position size ($10)

### 4. PolymarketExecutor (`lib/wallet-monitor/polymarket-executor.ts`)
Handles trade execution:
- Mock mode for safe testing (default)
- Real mode via Polymarket SDK
- Records positions and trades
- Updates strategy balance

## Database Schema

### New Tables

**wallet_monitor_signals**
- Logs all detected signals (COPY and SKIP)
- Captures OWRR, decision, reasoning
- Links to executed positions
- Enables analysis and optimization

### Schema Updates

**strategy_settings.copy_trading_config**
```json
{
  "enabled": true,
  "owrr_threshold_yes": 60,
  "owrr_threshold_no": 40,
  "min_owrr_confidence": "medium",
  "tracked_categories": ["Politics", "Crypto", "AI"]
}
```

## Implementation Phases

### Phase 1: Core Infrastructure (8-10 hours)
- Database schema
- WalletMonitor class
- OWRRCalculator
- DecisionEngine
- PolymarketExecutor (mock mode)
- Cron endpoint

### Phase 2: Testing & Validation (4-6 hours)
- Unit tests (DecisionEngine, position sizing)
- Integration tests (end-to-end flow)
- Load testing (100+ wallets, 50+ trades)

### Phase 3: Real Execution (4-6 hours)
- Polymarket SDK integration
- Position management
- Safety checks (kill switch, loss limits)

### Phase 4: Monitoring (3-4 hours)
- Structured logging
- Performance metrics
- Alert system

### Phase 5: UI (4-6 hours)
- Signals dashboard
- Configuration UI
- Performance dashboard

**Total:** 23-32 hours development + 3-5 weeks testing/rollout

## Performance Targets

- **Latency:** < 40 seconds from trade to execution
- **Throughput:** 500 wallets, 100 trades per cycle
- **Uptime:** 99% (< 7 hours downtime/month)
- **Execution Success Rate:** > 95%

## Safety Features

### Capital Protection
- Position size caps ($10 min, configurable max)
- Concurrent position limits (configurable)
- Daily loss limits (15% of balance)
- Max drawdown protection (30% from peak)
- Kill switch (environment variable)

### Error Handling
- ClickHouse failures: Retry 3x, skip cycle if all fail
- OWRR failures: Use cached value or neutral OWRR
- Polymarket failures: Retry 1x, log and continue
- Duplicate detection: In-memory cache of processed trades

### Observability
- Structured logging (all decisions and executions)
- Real-time metrics (latency, throughput, success rate)
- Alerts (critical failures, loss limits, downtime)
- Daily summaries (performance, signals, statistics)

## Deployment Strategy

### Week 1: Mock Mode Testing
- Deploy to staging with POLYMARKET_MOCK_MODE=true
- Monitor for 7 days
- Validate signal detection and decision logic
- Zero risk

### Week 2: Single Strategy Test
- Enable one test strategy with $100 budget
- Monitor manually
- Validate order placement
- Low risk

### Week 3: Multiple Strategies
- Enable 3-5 strategies with limited budgets
- Tune OWRR thresholds
- Optimize position sizing
- Controlled risk

### Week 4+: Production Rollout
- Deploy to production
- Start with beta users
- Gradually increase limits
- Add advanced features

## Key Design Decisions

### Why 30 second polling?
- Balance between latency and cost
- Vercel cron minimum is 1 minute, but we can use serverless functions
- Fast enough to capture most opportunities
- Slow enough to avoid rate limits

### Why stateless execution?
- All state in database (can restart anytime)
- No in-memory state persists between cycles
- Easier to scale and debug
- Vercel serverless-friendly

### Why mock mode by default?
- Safety first - test everything before real money
- Easy to toggle via environment variable
- Records everything as if real
- Builds confidence before launch

### Why OWRR for copy decisions?
- Single metric that captures smart money consensus
- Already implemented and tested
- Category-specific (domain expertise matters)
- Hard to game (requires long track record)

## Success Metrics

### Technical
- ✅ 99% uptime
- ✅ < 40s latency
- ✅ < 5% execution failure rate
- ✅ Zero data loss

### Business (Month 1)
- 10+ active copy trading strategies
- $10,000+ total capital deployed
- 500+ signals detected
- 100+ positions executed

### Business (Month 3)
- 50+ active strategies
- $100,000+ capital deployed
- Positive average ROI

## Risk Mitigation

### High Risks
| Risk | Mitigation |
|------|-----------|
| Polymarket API breaks | Monitor status, fallback to mock mode |
| ClickHouse performance degrades | Query optimization, caching, scale up |
| Rapid losses | Loss limits, kill switch, position caps |

### Medium Risks
| Risk | Mitigation |
|------|-----------|
| Cron timeouts | Optimize queries, batch processing, increase timeout |
| User tracks wrong wallets | UI validation, preview mode, documentation |
| Stale OWRR in volatility | Reduce cache TTL to 2 minutes |

### Low Risks
| Risk | Mitigation |
|------|-----------|
| Migration failures | Test in staging, rollback support |
| Memory leaks | LRU cache with size limits, monitoring |

## Next Steps

1. ✅ Review implementation plan with team
2. ⬜ Prioritize Phase 1 tasks
3. ⬜ Set up development environment
4. ⬜ Create database migrations
5. ⬜ Implement core WalletMonitor class
6. ⬜ Test in staging with mock mode
7. ⬜ Deploy to production with beta users

## Questions for Team

1. **Position Sizing:** Default to 5% risk per trade or 2%?
2. **OWRR Thresholds:** 60/40 or more conservative 65/35?
3. **Polymarket Integration:** Use their SDK or build custom API client?
4. **UI Priority:** Build signals dashboard first or configuration UI?
5. **Alert Channels:** Slack, Discord, Email, or all three?

## Resources

- **Full Plan:** `/docs/wallet-monitor-implementation-plan.md`
- **OWRR Docs:** `/docs/owrr-smart-money-signal.md`
- **Existing Code:**
  - Strategy Engine: `/lib/strategy-builder/execution-engine.ts`
  - ClickHouse Connector: `/lib/strategy-builder/clickhouse-connector.ts`
  - OWRR Calculator: `/lib/metrics/owrr.ts`
  - Position Tracking: `/supabase/migrations/20251025200000_create_strategy_position_tracking.sql`

---

**Ready to build? Let's start with Phase 1! 🚀**
