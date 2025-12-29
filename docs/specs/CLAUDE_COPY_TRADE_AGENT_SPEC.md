# Claude Strategy Agent Specification

> **Status**: Design Phase
> **Date**: 2025-12-13
> **Owner**: Cascadian Team

## Overview

A **configurable Claude agent** that executes ANY strategy you define in the Strategy Builder. You configure:
1. **The Rules** (via node graph: wallet cohorts, market filters, consensus thresholds)
2. **The Prompt** (natural language instructions to Claude)

Claude then reasons about the rules + data and makes autonomous trading decisions.

---

## The Big Picture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      CASCADIAN STRATEGY BUILDER UI                       │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  [Wallet Cohort] ─────┐                                            │ │
│  │  Top 5% by PnL        │                                            │ │
│  │  CLOB only            ├───▶ [Orchestrator Node]                    │ │
│  │                       │     ┌─────────────────────────────────┐    │ │
│  │  [Market Filter] ─────┤     │ Managing Agent Prompt:          │    │ │
│  │  Politics only        │     │                                 │    │ │
│  │  Min volume $50k      │     │ "Monitor these wallets for      │    │ │
│  │                       │     │  trades in filtered markets.    │    │ │
│  │  [Rules Config] ──────┘     │  Buy YES if 2+ wallets agree    │    │ │
│  │  Consensus: 2+              │  and there's >6¢ to make with   │    │ │
│  │  Max $100/trade             │  <2 hours to resolution.        │    │ │
│  │  Only if >6¢ edge           │  Skip if spread >3%."           │    │ │
│  │                             │                                 │    │ │
│  │                             └─────────────────────────────────┘    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                       │                                  │
│                                       │ Deploy Strategy                  │
│                                       ▼                                  │
└───────────────────────────────────────┼──────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    CLAUDE AGENT (Fly.io Container)                       │
│                                                                          │
│  System Context:                                                         │
│  ├── Wallet Cohort: [0xabc, 0xdef, 0x123] (from your filter)           │
│  ├── Market Filter: Politics + min $50k volume                          │
│  ├── Rules: consensus=2, max_trade=$100, min_edge=0.06                  │
│  └── Your Prompt: "Buy YES if 2+ wallets agree..."                      │
│                                                                          │
│  Claude thinks:                                                          │
│  "I see 3 wallets bought YES on 'Trump wins' in the last 30 min.        │
│   Current price is $0.52, they entered at $0.48 avg.                    │
│   Market resolves in 90 minutes. Edge = 48¢ potential.                  │
│   This meets my criteria. Executing $75 buy."                           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Strategy Examples

### Example 1: Copy Trading with Consensus

**UI Config:**
- Wallet Cohort: Top 5% by realized PnL, CLOB only
- Market Filter: All categories
- Rules: Consensus 2+, max $100/trade

**Prompt:**
```
Monitor trades from the wallet cohort. When 2+ wallets take the same
position within 1 hour, copy the trade if:
- Price hasn't moved more than 5% from their average entry
- Spread is under 3%
- Liquidity is over $10k

Size based on conviction: 2 wallets = $50, 3+ wallets = $100.
```

### Example 2: Resolution Scalping

**UI Config:**
- Wallet Cohort: None (market-based strategy)
- Market Filter: Resolves within 2 hours
- Rules: Min edge 6¢, max $50/trade

**Prompt:**
```
Find markets resolving within 2 hours where there's obvious mispricing.
If a market should clearly resolve YES (based on news/facts) but is
trading below 94¢, buy YES.

Only trade if edge > 6¢. Be conservative - if uncertain, skip.
Check news sources if available.
```

### Example 3: Smart Money Momentum

**UI Config:**
- Wallet Cohort: Top 10 wallets by omega ratio
- Market Filter: Crypto category
- Rules: Any 1 wallet signal, max $25/trade

**Prompt:**
```
These are the highest-performing crypto traders. When any of them
takes a position, follow with a small bet ($25).

Pay attention to their sizing - if they bet big, I should be more
confident. If they're adding to an existing position, that's bullish.
```

### Example 4: Category Specialist

**UI Config:**
- Wallet Cohort: Sports specialists only (filtered by category metrics)
- Market Filter: Sports only, NFL games
- Rules: Consensus 3+, max $75/trade

**Prompt:**
```
Only copy trades when 3+ NFL specialists agree. These wallets have
proven edge in sports betting. Look for their pre-game bets, not
in-game which may be noise.

If they're all betting the same team, that's a strong signal.
```

---

## Data Model: Strategy → Agent

Your existing `OrchestratorConfig` gets extended with a Claude agent configuration:

```typescript
// Extension to lib/strategy-builder/types.ts

export interface ClaudeAgentConfig {
  version: 1;

  // The custom prompt you write in the UI
  managing_agent_prompt: string;

  // Model selection (cost vs capability tradeoff)
  model: 'claude-sonnet-4-5' | 'claude-opus-4-5' | 'claude-haiku-3-5';

  // Execution cadence
  cycle_interval_seconds: 60 | 300 | 900 | 3600;  // 1min, 5min, 15min, 1hr

  // Safety limits (hard caps, can't be overridden by prompt)
  safety_limits: {
    max_trade_usd: number;           // e.g., 100
    max_daily_trades: number;        // e.g., 10
    max_total_exposure_usd: number;  // e.g., 1000
    min_confidence_percent: number;  // e.g., 70
  };

  // What data Claude has access to
  data_access: {
    can_query_wallet_metrics: boolean;
    can_query_market_data: boolean;
    can_search_web: boolean;  // For news/context (future)
  };

  // Alerting
  alerts: {
    notify_on_trade: boolean;
    notify_on_skip: boolean;
    notify_on_error: boolean;
    channel: 'discord' | 'telegram' | 'email' | 'none';
  };
}

export interface OrchestratorConfigV2 extends OrchestratorConfig {
  // Everything from V1, plus:

  execution_mode: 'rules_only' | 'claude_agent';

  // Only used if execution_mode = 'claude_agent'
  claude_agent?: ClaudeAgentConfig;
}
```

### What Gets Passed to Claude

When a strategy is deployed, we compile the UI configuration into a system prompt:

```typescript
function compileStrategyToSystemPrompt(strategy: DeployedStrategy): string {
  const { walletCohort, marketFilter, orchestrator } = strategy;

  return `
## Your Mission
${orchestrator.claude_agent.managing_agent_prompt}

## Context (from Strategy Builder)

### Wallet Cohort
You are monitoring these ${walletCohort.wallets.length} wallets:
${walletCohort.wallets.map(w => `- ${w.walletAddress} (PnL: $${w.realizedPnlUsd}, Win Rate: ${w.winRate}%)`).join('\n')}

### Market Filter
Only trade in markets matching:
- Categories: ${marketFilter.categories?.join(', ') || 'All'}
- Min Volume: $${marketFilter.minVolumeUsd || 0}
- Status: ${marketFilter.statuses?.join(', ') || 'Open'}

### Rules (ENFORCED - Cannot Override)
- Max per trade: $${orchestrator.claude_agent.safety_limits.max_trade_usd}
- Max daily trades: ${orchestrator.claude_agent.safety_limits.max_daily_trades}
- Max total exposure: $${orchestrator.claude_agent.safety_limits.max_total_exposure_usd}
- Min confidence to trade: ${orchestrator.claude_agent.safety_limits.min_confidence_percent}%

## Your Tools
- query_smart_money_signals: Get recent trades from your wallet cohort
- get_market_price: Check current bid/ask for any market
- execute_trade: Place a trade (requires reasoning and confidence score)
- get_portfolio_status: Check your current positions and exposure
- log_decision: Record why you traded or skipped

## Important
- ALWAYS provide reasoning before executing trades
- ALWAYS log your decisions, even when skipping
- The safety limits above are HARD CAPS - the system will reject trades that exceed them
`;
}
```

---

## Full Data Context Per Cycle

Every cycle, Claude gets a **complete snapshot** of everything it needs to make decisions. This isn't just rules - it's live market state, wallet activity, and portfolio status.

### What Claude Sees Each Cycle

```typescript
interface CycleContext {
  // Timestamp
  cycle_timestamp: string;
  cycle_number: number;

  // === SMART MONEY SIGNALS ===
  // Recent trades from watched wallets
  signals: Array<{
    condition_id: string;
    market: {
      question: string;
      category: string;
      end_time: string;
      time_remaining_hours: number;
      status: 'open' | 'closing_soon' | 'resolved';
    };
    outcome: 'YES' | 'NO';
    direction: 'BUY' | 'SELL';

    // Who traded
    wallets: Array<{
      address: string;
      trade_time: string;
      minutes_ago: number;
      entry_price: number;
      size_usd: number;
      // Wallet quality metrics
      metrics: {
        realized_pnl: number;
        win_rate: number;
        trade_count: number;
        avg_roi_per_trade: number;
        omega_ratio?: number;
        category_specialty?: string;
      };
    }>;

    // Aggregated signal stats
    wallet_count: number;
    avg_entry_price: number;
    total_notional: number;
    signal_age_minutes: number;
  }>;

  // === MARKET DATA ===
  // Current state of each market with signals
  markets: Array<{
    condition_id: string;
    question: string;
    category: string;

    // Timing
    end_time: string;
    time_remaining: {
      hours: number;
      minutes: number;
      display: string; // "2h 15m" or "45 minutes"
    };

    // Current prices
    yes_price: number;
    no_price: number;
    mid_price: number;
    spread: number;
    spread_percent: number;

    // Liquidity
    yes_liquidity_usd: number;
    no_liquidity_usd: number;
    total_volume_24h: number;

    // Order book depth
    orderbook: {
      best_bid: number;
      best_ask: number;
      bid_depth_10c: number;  // Liquidity within 10 cents of best bid
      ask_depth_10c: number;
    };

    // Recent activity
    recent_trades: Array<{
      time: string;
      side: 'BUY' | 'SELL';
      outcome: 'YES' | 'NO';
      price: number;
      size_usd: number;
      is_smart_money: boolean;
    }>;
  }>;

  // === PORTFOLIO STATUS ===
  portfolio: {
    total_exposure_usd: number;
    remaining_budget_usd: number;
    trades_today: number;
    max_trades_today: number;

    // Open positions
    positions: Array<{
      condition_id: string;
      market_question: string;
      outcome: 'YES' | 'NO';
      entry_price: number;
      current_price: number;
      size_usd: number;
      unrealized_pnl: number;
      unrealized_pnl_percent: number;
      time_held: string;
      time_to_resolution: string;
    }>;

    // Today's activity
    todays_trades: Array<{
      time: string;
      market: string;
      outcome: string;
      side: string;
      price: number;
      size_usd: number;
      status: 'filled' | 'partial' | 'pending';
    }>;

    // Performance
    daily_pnl: number;
    weekly_pnl: number;
    total_pnl: number;
  };

  // === YOUR RULES (from UI) ===
  rules: {
    consensus_threshold: number;
    max_trade_usd: number;
    max_exposure_usd: number;
    min_edge_cents: number;
    max_spread_percent: number;
    min_liquidity_usd: number;
    min_time_to_resolution_hours: number;
  };
}
```

### Example: What Claude Actually Receives

Here's a real example of what Claude sees at the start of a cycle:

```
=== CYCLE #1847 | 2025-12-13 14:35:00 UTC ===

## Portfolio Status
- Total Exposure: $450 / $1,000 max
- Trades Today: 3 / 10 max
- Daily PnL: +$23.50

Open Positions:
1. "Will Bitcoin hit $100k by Dec 31?" - YES @ $0.45
   Current: $0.52 | Size: $100 | Unrealized: +$15.56 (+15.6%)
   Resolves in: 18 days

2. "Trump wins 2024 election" - YES @ $0.51
   Current: $0.53 | Size: $200 | Unrealized: +$7.84 (+3.9%)
   Resolves in: 2 hours 15 minutes

3. "Fed cuts rates December" - NO @ $0.72
   Current: $0.68 | Size: $150 | Unrealized: +$8.82 (+5.9%)
   Resolves in: 4 days

---

## Smart Money Signals (Last Hour)

### Signal 1: STRONG (4 wallets)
Market: "Lakers win vs Celtics tonight"
Category: Sports | Resolves in: 3 hours 45 minutes
Direction: BUY YES

Wallets:
- 0x7a3b...f2c1 | Entry: $0.42 | Size: $500 | 12 min ago
  [PnL: +$34,521 | Win: 67% | Trades: 892 | Sports Specialist]

- 0x9e1c...8d4a | Entry: $0.43 | Size: $200 | 18 min ago
  [PnL: +$12,890 | Win: 62% | Trades: 445]

- 0x2f8d...1b3e | Entry: $0.44 | Size: $150 | 25 min ago
  [PnL: +$8,234 | Win: 58% | Trades: 234]

- 0x5c2a...9f7b | Entry: $0.43 | Size: $300 | 31 min ago
  [PnL: +$19,102 | Win: 64% | Trades: 567 | Sports Specialist]

Signal Stats:
- Avg Entry: $0.43
- Total Notional: $1,150
- Signal Age: 31 minutes

Current Market:
- YES Price: $0.47 (up 4¢ from avg entry)
- Spread: 2.1%
- Liquidity: $45,000

### Signal 2: MODERATE (2 wallets)
Market: "ETH above $4000 by Friday"
Category: Crypto | Resolves in: 2 days 6 hours
Direction: BUY YES

Wallets:
- 0x3d9f...2c8e | Entry: $0.31 | Size: $100 | 45 min ago
  [PnL: +$5,678 | Win: 55% | Trades: 123]

- 0x8b4c...7a1d | Entry: $0.32 | Size: $75 | 52 min ago
  [PnL: +$3,445 | Win: 52% | Trades: 89]

Signal Stats:
- Avg Entry: $0.315
- Total Notional: $175
- Signal Age: 52 minutes

Current Market:
- YES Price: $0.34 (up 2.5¢ from avg entry)
- Spread: 3.8%
- Liquidity: $22,000

---

## Your Rules
- Consensus: 2+ wallets required
- Max per trade: $100
- Max spread: 5%
- Min liquidity: $10,000
- Min edge: 6¢

## Your Instructions
"Monitor the wallet cohort for consensus signals. When 2+ wallets
buy the same outcome within 1 hour, copy if price is within 5%
of their entries and spread under 3%. Size: $50 for 2 wallets,
$100 for 3+ wallets."

---

Now analyze these signals and decide what to do.
```

### Claude's Response

```
=== ANALYSIS ===

## Signal 1: Lakers vs Celtics - BUY YES

Analysis:
- 4 wallets is STRONG consensus
- 2 are Sports Specialists with excellent track records
- Combined notional $1,150 shows conviction
- Price moved 4¢ (9.3%) from avg entry - slightly above my 5% threshold
- BUT signal is only 31 min old and these are high-quality wallets
- Spread 2.1% is excellent
- 3h 45m to resolution is good timeframe

HOWEVER: Price has already moved 4¢. At current $0.47, if I enter now:
- Need Lakers to win for $0.53 profit (53¢ payout - 47¢ cost)
- Risk: lose entire $100 if Lakers lose
- Edge is smaller than the smart money got

DECISION: SKIP
CONFIDENCE: 45%
REASONING: Price already moved 9% from smart money entries. The edge
they captured is partially gone. I'd be chasing. Rule says <5% move,
this is 9%. Better to wait for fresher signals.

[Logging decision...]

---

## Signal 2: ETH > $4000 - BUY YES

Analysis:
- Only 2 wallets - minimum threshold
- Neither is a crypto specialist
- Lower conviction ($175 total)
- Spread 3.8% is above my 3% threshold
- Price moved 2.5¢ (7.9%) - also above threshold

DECISION: SKIP
CONFIDENCE: 35%
REASONING: Weak signal. Only 2 non-specialist wallets, spread too
wide (3.8% > 3% limit), price already moved almost 8%. Pass.

[Logging decision...]

---

## Portfolio Check

Current position in "Trump wins" resolves in 2h 15m.
- Entry: $0.51, Current: $0.53, Size: $200
- If Trump wins: +$94 profit
- This is my largest position by conviction

No action needed on existing positions.

---

## Cycle Summary
- Signals analyzed: 2
- Trades executed: 0
- Reason: Both signals had price movement exceeding thresholds
- Positions unchanged
- Waiting for fresher signals next cycle

=== CYCLE END ===
```

### How This Data Is Gathered

Each cycle, the agent runner fetches fresh data before invoking Claude:

```typescript
async function prepareCycleContext(strategy: DeployedStrategy): Promise<CycleContext> {
  // Parallel fetch all data
  const [signals, markets, portfolio] = await Promise.all([
    // Get smart money activity from ClickHouse
    querySmartMoneySignals({
      wallets: strategy.walletCohort.wallets.map(w => w.walletAddress),
      hoursBack: 1,
      minNotional: 50,
    }),

    // Get current market state from Polymarket
    fetchMarketData(signals.map(s => s.condition_id)),

    // Get our portfolio from internal tracking
    getPortfolioStatus(strategy.id),
  ]);

  // Enrich signals with wallet metrics
  const enrichedSignals = await enrichSignalsWithWalletMetrics(signals);

  // Add time calculations
  const marketsWithTime = markets.map(m => ({
    ...m,
    time_remaining: calculateTimeRemaining(m.end_time),
  }));

  return {
    cycle_timestamp: new Date().toISOString(),
    cycle_number: await getNextCycleNumber(strategy.id),
    signals: enrichedSignals,
    markets: marketsWithTime,
    portfolio,
    rules: strategy.orchestrator.claude_agent.safety_limits,
  };
}
```

---

## UI Flow: Building a Strategy

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         STRATEGY BUILDER                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Step 1: Define Your Wallet Cohort                                      │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ [Wallet Cohort Node]                                               │ │
│  │                                                                    │ │
│  │ Filter by:                                                         │ │
│  │ ☑ Top ___5__% by PnL                                              │ │
│  │ ☑ CLOB only (no transfers)                                        │ │
│  │ ☑ Min 10 trades                                                   │ │
│  │ ☐ Specific category: [dropdown]                                   │ │
│  │                                                                    │ │
│  │ Preview: 47 wallets match                                         │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                              │                                           │
│                              ▼                                           │
│  Step 2: Filter Markets (Optional)                                      │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ [Market Filter Node]                                               │ │
│  │                                                                    │ │
│  │ Categories: ☑ Politics ☐ Sports ☐ Crypto ☐ Entertainment          │ │
│  │ Min Volume: $__50,000__                                           │ │
│  │ Status: ☑ Open ☐ Closed                                           │ │
│  │                                                                    │ │
│  │ Preview: 23 markets match                                         │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                              │                                           │
│                              ▼                                           │
│  Step 3: Configure the Agent                                            │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ [Orchestrator Node - Claude Agent Mode]                            │ │
│  │                                                                    │ │
│  │ ┌────────────────────────────────────────────────────────────────┐ │ │
│  │ │ Managing Agent Prompt:                                         │ │ │
│  │ │                                                                │ │ │
│  │ │ Monitor the wallet cohort for consensus signals. When 2+       │ │ │
│  │ │ wallets buy the same outcome within 1 hour:                    │ │ │
│  │ │                                                                │ │ │
│  │ │ - Check if price is within 5% of their entries                 │ │ │
│  │ │ - Verify spread is under 3%                                    │ │ │
│  │ │ - If edge > 6¢ and time to resolution > 1 hour, BUY           │ │ │
│  │ │ - Size: $50 for 2 wallets, $100 for 3+ wallets                │ │ │
│  │ │                                                                │ │ │
│  │ │ Skip trades if uncertain. Better to miss than lose.           │ │ │
│  │ └────────────────────────────────────────────────────────────────┘ │ │
│  │                                                                    │ │
│  │ Safety Limits:                                                     │ │
│  │ Max per trade: $[_100_]  Max daily: [_10_] trades                 │ │
│  │ Max exposure:  $[_1000_] Min confidence: [_70_]%                  │ │
│  │                                                                    │ │
│  │ Cycle: Every [5 minutes ▼]                                        │ │
│  │ Model: [Claude Sonnet ▼]  (~$0.03/cycle, ~$250/month)            │ │
│  │                                                                    │ │
│  │ Alerts: ☑ Discord  ☐ Telegram  ☐ Email                           │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                              │                                           │
│                              ▼                                           │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                     [ Deploy Strategy ]                            │ │
│  │                                                                    │ │
│  │  ⚠️  This will start autonomous trading with real money.          │ │
│  │      Max daily risk: $1,000 | Estimated API cost: $250/month      │ │
│  │                                                                    │ │
│  │      [ Start in Paper Mode First ]  [ Deploy Live ]               │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    DEPLOYMENT CONTAINER (Fly.io)                         │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                    CLAUDE AGENT PROCESS                             │ │
│  │                                                                     │ │
│  │  System Prompt:                                                     │ │
│  │  "You are the Cascadian Copy Trade Agent. Every 5 minutes,         │ │
│  │   analyze smart money signals and execute trades when confident."  │ │
│  │                                                                     │ │
│  │  Available Tools:                                                   │ │
│  │  ├── query_smart_money_signals                                     │ │
│  │  ├── query_wallet_metrics                                          │ │
│  │  ├── get_market_price                                              │ │
│  │  ├── execute_trade                                                 │ │
│  │  ├── get_portfolio_status                                          │ │
│  │  └── log_decision                                                  │ │
│  │                                                                     │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                              │                                           │
│         ┌────────────────────┼────────────────────┐                     │
│         ▼                    ▼                    ▼                     │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐               │
│  │ ClickHouse  │     │ Polymarket  │     │ Supabase    │               │
│  │ (signals)   │     │ (execution) │     │ (audit log) │               │
│  └─────────────┘     └─────────────┘     └─────────────┘               │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## MCP Tools Specification

### 1. `query_smart_money_signals`

Queries ClickHouse for recent trades from the copy-trade-ready cohort.

```typescript
{
  name: "query_smart_money_signals",
  description: "Get recent trading activity from verified smart money wallets",
  parameters: {
    hours_back: number,      // Default: 1
    min_wallets: number,     // Default: 2 (consensus threshold)
    min_notional: number,    // Default: 100 (USD)
    category?: string,       // Optional: filter by market category
  },
  returns: {
    signals: Array<{
      condition_id: string,
      market_question: string,
      outcome: string,
      side: "BUY" | "SELL",
      wallet_count: number,
      wallets: string[],
      avg_price: number,
      total_notional: number,
      latest_trade_time: string,
    }>
  }
}
```

**Underlying Query:**
```sql
WITH smart_money AS (
  SELECT wallet_address
  FROM pm_copy_trade_ready_v1
  WHERE realized_pnl > 0  -- Only profitable wallets
)
SELECT
  t.condition_id,
  m.question as market_question,
  t.outcome_index,
  t.side,
  count(DISTINCT t.wallet_address) as wallet_count,
  groupArray(DISTINCT t.wallet_address) as wallets,
  avg(t.price) as avg_price,
  sum(t.usdc_amount) as total_notional,
  max(t.trade_time) as latest_trade_time
FROM pm_trader_events_v2 t
JOIN pm_markets_metadata m ON t.condition_id = m.condition_id
WHERE t.wallet_address IN (SELECT wallet_address FROM smart_money)
  AND t.trade_time > now() - INTERVAL {hours_back} HOUR
  AND t.usdc_amount >= {min_notional}
GROUP BY t.condition_id, m.question, t.outcome_index, t.side
HAVING wallet_count >= {min_wallets}
ORDER BY wallet_count DESC, total_notional DESC
```

### 2. `query_wallet_metrics`

Get detailed metrics for a specific wallet to assess quality.

```typescript
{
  name: "query_wallet_metrics",
  description: "Get performance metrics for a specific wallet",
  parameters: {
    wallet_address: string,
  },
  returns: {
    wallet_address: string,
    realized_pnl: number,
    win_rate: number,
    trade_count: number,
    avg_trade_size: number,
    roi_percent: number,
    last_trade: string,
  }
}
```

### 3. `get_market_price`

Fetch current orderbook price from Polymarket.

```typescript
{
  name: "get_market_price",
  description: "Get current bid/ask prices for a market outcome",
  parameters: {
    condition_id: string,
    outcome_index: number,  // 0 = No, 1 = Yes
  },
  returns: {
    condition_id: string,
    outcome: string,
    best_bid: number,
    best_ask: number,
    mid_price: number,
    spread: number,
    liquidity_usd: number,
  }
}
```

### 4. `execute_trade`

Execute a trade on Polymarket. **Requires reasoning to be provided.**

```typescript
{
  name: "execute_trade",
  description: "Execute a copy trade on Polymarket. Only use when confidence > 70%.",
  parameters: {
    condition_id: string,
    outcome_index: number,
    side: "BUY" | "SELL",
    amount_usd: number,     // Hard cap enforced at $100
    limit_price: number,    // Max price willing to pay
    reasoning: string,      // REQUIRED: Why this trade?
    confidence: number,     // 0-100, must be > 70 to execute
  },
  returns: {
    success: boolean,
    order_id?: string,
    fill_price?: number,
    fill_amount?: number,
    error?: string,
  }
}
```

**Safety Enforced:**
- `amount_usd` capped at $100 regardless of input
- `confidence` must be > 70 or trade is rejected
- Rate limited to 1 trade per market per hour
- Total exposure tracked and limited

### 5. `get_portfolio_status`

Get current positions and exposure.

```typescript
{
  name: "get_portfolio_status",
  description: "Get current portfolio positions and total exposure",
  parameters: {},
  returns: {
    total_exposure_usd: number,
    remaining_budget_usd: number,
    position_count: number,
    positions: Array<{
      condition_id: string,
      market_question: string,
      side: string,
      size: number,
      avg_entry_price: number,
      current_price: number,
      unrealized_pnl: number,
    }>,
    daily_pnl: number,
    trades_today: number,
  }
}
```

### 6. `log_decision`

Log a decision (trade or skip) for audit trail.

```typescript
{
  name: "log_decision",
  description: "Log a trading decision for audit purposes",
  parameters: {
    decision_type: "TRADE" | "SKIP" | "MONITOR",
    condition_id?: string,
    reasoning: string,
    confidence?: number,
    signal_strength?: number,
  },
  returns: {
    logged: boolean,
    decision_id: string,
  }
}
```

---

## Agent System Prompt

```markdown
You are the Cascadian Copy Trade Agent, an autonomous trading system that copies
verified smart money wallets on Polymarket.

## Your Mission
Monitor smart money trading activity and execute copy trades when high-confidence
signals emerge. Your goal is steady, risk-managed returns - not maximum profit.

## Decision Framework

Every 5 minutes, you will:

1. **SCAN**: Query recent smart money activity
   - Use `query_smart_money_signals` with hours_back=1, min_wallets=2
   - Look for consensus: multiple smart wallets taking same position

2. **ANALYZE**: For each signal, evaluate:
   - How many wallets? (2 = moderate, 3+ = strong)
   - What's their track record? (use `query_wallet_metrics`)
   - How fresh is the signal? (< 30 min = actionable)
   - What's the current price vs their entry? (slippage check)
   - Is there sufficient liquidity? (use `get_market_price`)

3. **DECIDE**: Assign confidence score (0-100)
   - < 50: Skip, log reason
   - 50-70: Monitor, don't trade
   - > 70: Consider trading
   - > 85: Strong conviction trade

4. **EXECUTE**: If confidence > 70:
   - Check portfolio exposure (`get_portfolio_status`)
   - Size appropriately (stronger signal = larger size, max $100)
   - Use limit orders slightly below best ask
   - Always provide clear reasoning

5. **LOG**: Document every decision
   - Use `log_decision` for all outcomes
   - Explain why you traded OR why you skipped

## Risk Rules (NEVER VIOLATE)

- Maximum $100 per trade
- Maximum $1000 total exposure
- Maximum 10 trades per day
- Never trade if spread > 5%
- Never trade if liquidity < $10,000
- Never chase - if price moved >10% from signal, skip
- Always wait for 2+ wallet consensus

## What Makes a Good Signal

STRONG signals:
- 3+ wallets buying same outcome within 1 hour
- Wallets have positive historical PnL
- Price hasn't moved significantly since their entries
- High liquidity market
- Clear market narrative

WEAK signals (skip or monitor):
- Only 2 wallets, low notional
- Wallets have mixed track records
- Price already moved 5%+ from entries
- Low liquidity or wide spreads
- Ambiguous or stale market

## Output Format

For each cycle, structure your analysis as:

```
=== CYCLE START: {timestamp} ===

PORTFOLIO STATUS:
- Total exposure: $X / $1000
- Open positions: N
- Trades today: M / 10

SIGNALS DETECTED: N

[For each signal]
SIGNAL: {market_question}
- Wallets: {count} ({list})
- Direction: {BUY/SELL} {outcome}
- Entry prices: ${avg} (current: ${current})
- Notional: ${total}
- Age: {minutes} min

ANALYSIS:
{Your reasoning about signal quality}

DECISION: {TRADE/SKIP/MONITOR}
CONFIDENCE: {0-100}%
REASONING: {Why this decision}

[If trading]
EXECUTING: ${amount} at limit ${price}
RESULT: {success/failure}

=== CYCLE END ===
```

Remember: It's better to miss a good trade than to take a bad one.
Patience and discipline beat aggression.
```

---

## Safety Architecture

### Layer 1: Tool-Level Limits
```typescript
const TOOL_LIMITS = {
  maxTradeSize: 100,           // USD per trade
  maxTotalExposure: 1000,      // USD total
  maxDailyTrades: 10,
  minLiquidity: 10000,         // USD
  maxSpread: 0.05,             // 5%
  minConfidence: 70,           // %
  cooldownPerMarket: 3600,     // seconds
};
```

### Layer 2: Agent-Level Instructions
- Embedded in system prompt
- Cannot be overridden by user messages
- Confidence threshold enforced

### Layer 3: Backend Validation
```typescript
async function validateTrade(trade: TradeRequest): ValidationResult {
  // Check portfolio exposure
  const portfolio = await getPortfolioStatus();
  if (portfolio.total_exposure_usd + trade.amount_usd > 1000) {
    return { valid: false, reason: "Would exceed max exposure" };
  }

  // Check daily trade count
  if (portfolio.trades_today >= 10) {
    return { valid: false, reason: "Daily trade limit reached" };
  }

  // Check market cooldown
  const lastTrade = await getLastTradeForMarket(trade.condition_id);
  if (lastTrade && Date.now() - lastTrade.timestamp < 3600000) {
    return { valid: false, reason: "Market cooldown active" };
  }

  // Check liquidity
  const market = await getMarketPrice(trade.condition_id, trade.outcome_index);
  if (market.liquidity_usd < 10000) {
    return { valid: false, reason: "Insufficient liquidity" };
  }

  // Check spread
  if (market.spread > 0.05) {
    return { valid: false, reason: "Spread too wide" };
  }

  return { valid: true };
}
```

### Layer 4: Human Override
```typescript
// Environment variable to pause all trading
AGENT_TRADING_ENABLED=true

// Telegram/Discord alerts for large decisions
if (trade.amount_usd > 75) {
  await sendAlert(`Large trade pending: ${trade.amount_usd} on ${trade.market}`);
}
```

---

## Deployment Model

### Infrastructure: Fly.io

```toml
# fly.toml
app = "cascadian-copy-trade-agent"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile.agent"

[env]
  NODE_ENV = "production"
  AGENT_CYCLE_INTERVAL_MS = "300000"  # 5 minutes
  MAX_TRADE_SIZE_USD = "100"
  MAX_TOTAL_EXPOSURE_USD = "1000"

[http_service]
  internal_port = 8080
  force_https = true

[[vm]]
  memory = "1gb"
  cpu_kind = "shared"
  cpus = 1
```

### Dockerfile

```dockerfile
FROM node:20-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

# Health check endpoint
EXPOSE 8080

CMD ["node", "dist/agent/main.js"]
```

### Process Manager

```typescript
// agent/main.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { tradingToolServer } from "./tools";
import { loadSessionId, saveSessionId } from "./state";

const CYCLE_INTERVAL = parseInt(process.env.AGENT_CYCLE_INTERVAL_MS || "300000");

async function runCycle() {
  const sessionId = await loadSessionId();

  console.log(`[${new Date().toISOString()}] Starting trading cycle...`);

  try {
    for await (const message of query({
      prompt: "Execute your trading cycle. Scan for signals, analyze, and decide.",
      options: {
        mcpServers: { "trading": tradingToolServer },
        resume: sessionId || undefined,
        model: "claude-sonnet-4-5",
        maxTurns: 10,
        maxBudgetUsd: 0.50,
        systemPrompt: AGENT_SYSTEM_PROMPT,
      }
    })) {
      // Save session for continuity
      if (message.type === 'system' && message.subtype === 'init') {
        await saveSessionId(message.session_id);
      }

      // Log all agent output
      if (message.type === 'assistant') {
        console.log(message.content);
      }

      // Track costs
      if (message.type === 'result') {
        console.log(`Cycle cost: $${message.total_cost_usd?.toFixed(4)}`);
      }
    }
  } catch (error) {
    console.error("Cycle error:", error);
    // Alert but don't crash
    await sendAlert(`Agent error: ${error.message}`);
  }
}

// Main loop
async function main() {
  console.log("Cascadian Copy Trade Agent starting...");

  // Health check server
  startHealthServer(8080);

  // Run immediately, then on interval
  await runCycle();
  setInterval(runCycle, CYCLE_INTERVAL);
}

main().catch(console.error);
```

---

## Cost Estimate

| Component | Calculation | Monthly Cost |
|-----------|-------------|--------------|
| **Claude API** | 288 cycles/day × 30 days × ~$0.03/cycle | ~$260 |
| **Fly.io VM** | 1GB RAM, shared CPU, 24/7 | ~$5 |
| **ClickHouse** | Already paid (existing) | $0 |
| **Supabase** | Already paid (existing) | $0 |
| **Polymarket** | Trading fees only | Variable |
| **Total Infrastructure** | | **~$265/month** |

---

## Implementation Phases

### Phase 1: Simulation Mode (Week 1)
- [ ] Build MCP tools with mock execution
- [ ] Deploy agent in dry-run mode
- [ ] Validate signal detection accuracy
- [ ] Review decision quality

### Phase 2: Paper Trading (Week 2)
- [ ] Log all "would execute" decisions
- [ ] Compare to actual market outcomes
- [ ] Tune confidence thresholds
- [ ] Test safety limits

### Phase 3: Live Trading - Conservative (Week 3)
- [ ] Enable real execution
- [ ] Start with $25 max per trade
- [ ] $250 max total exposure
- [ ] Manual review of all trades

### Phase 4: Live Trading - Full (Week 4+)
- [ ] Increase to $100 max per trade
- [ ] $1000 max total exposure
- [ ] Automated operation with alerts
- [ ] Performance monitoring dashboard

---

## Monitoring & Alerts

### Metrics to Track
- Trades executed per day
- Win rate (positions closed profitably)
- Average return per trade
- Total PnL
- API costs per day
- Signal-to-trade conversion rate
- Average confidence at execution

### Alert Conditions
- Trade executed (always)
- Daily PnL exceeds +/- $100
- Position held > 7 days
- Agent error/restart
- Unusual market conditions detected

---

## Files to Create

```
agent/
├── main.ts              # Entry point, cycle loop
├── tools/
│   ├── index.ts         # MCP server setup
│   ├── querySignals.ts  # query_smart_money_signals
│   ├── queryWallet.ts   # query_wallet_metrics
│   ├── marketPrice.ts   # get_market_price
│   ├── executeTrade.ts  # execute_trade
│   ├── portfolio.ts     # get_portfolio_status
│   └── logDecision.ts   # log_decision
├── polymarket/
│   ├── client.ts        # Polymarket API wrapper
│   ├── signer.ts        # EIP-712 signing
│   └── types.ts         # Type definitions
├── state/
│   ├── session.ts       # Session persistence
│   └── portfolio.ts     # Position tracking
├── config.ts            # Environment config
├── prompts.ts           # System prompt
└── health.ts            # Health check server

Dockerfile.agent
fly.toml
```

---

## Questions to Decide

1. **Wallet selection**: Use entire copy-trade-ready cohort, or hand-pick top performers?
2. **Category focus**: All markets, or specific categories (Politics, Crypto, Sports)?
3. **Trade sizing**: Fixed $50, or scale by confidence (higher confidence = larger)?
4. **Exit strategy**: Hold to resolution, or implement stop-loss/take-profit?
5. **Alerting**: Telegram, Discord, email, or all?
