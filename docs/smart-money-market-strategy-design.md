# Smart Money Market Strategy - Design Document

## Overview

A market-focused trading strategy that identifies opportunities where smart money (high-performing wallets by category) is heavily positioned on one side. Unlike copy trading (which follows wallet trades), this strategy analyzes markets to find strong consensus signals.

---

## Strategy Flow

```
1. DATA_SOURCE (Markets)
   ↓
2. MARKET_FILTER (Liquidity, End Date, Category)
   ↓
3. AI_FILTER (Optional: "Is this figure-outable?")
   ↓
4. SMART_MONEY_SIGNAL (Analyze top holders → Calculate OWRR → Filter by threshold)
   ↓
5. PROFIT_FILTER (Minimum edge/profit potential)
   ↓
6. ORCHESTRATOR (Position sizing based on signal strength + profit)
   ↓
7. ACTION (Execute trades)
```

---

## Node Types

### 1. DATA_SOURCE (type: MARKETS)
**Existing**: Yes (stub implementation)

**Purpose**: Fetch all active markets from Polymarket

**Config**:
```typescript
{
  source: 'MARKETS',
  filters: {
    active_only: true,
    min_liquidity_usd: 10000,
    max_days_to_close: 30,
    categories: ['politics', 'crypto', 'sports']
  }
}
```

**Output**: Array of markets with metadata

---

### 2. MARKET_FILTER
**Existing**: Yes (stub implementation)

**Purpose**: Filter markets by basic criteria

**Config**:
```typescript
{
  min_liquidity_usd: 50000,      // Minimum $50k liquidity
  max_days_to_close: 14,         // Closes within 14 days
  min_days_to_close: 1,          // At least 1 day away
  categories: ['politics'],       // Specific categories
  exclude_keywords: ['parlay'],   // Exclude certain market types
}
```

**Output**: Filtered markets array

---

### 3. AI_FILTER (NEW)
**Existing**: No - **NEW NODE TYPE**

**Purpose**: Use AI to evaluate markets based on custom prompts

**Config**:
```typescript
{
  prompt: "Is this outcome figure-outable based on available information? Answer YES or NO and explain briefly.",
  accept_on: ['YES', 'yes', 'Yes'],
  model: 'gpt-4',
  // Alternative prompts:
  // "Is this market likely to resolve based on objective facts?"
  // "Does smart money have an edge on this market?"
  // "Is this a skill-based market or pure chance?"
}
```

**Implementation**:
- For each market, send market title + description to LLM
- Parse response for accept_on keywords
- Filter markets based on AI evaluation

**Output**: Markets that passed AI filter

---

### 4. SMART_MONEY_SIGNAL (NEW)
**Existing**: No - **NEW NODE TYPE** (This is the core!)

**Purpose**:
1. Get top 20 holders on YES side + top 20 on NO side
2. Calculate category-specific OWRR for the market
3. Filter markets with strong smart money consensus

**Config**:
```typescript
{
  // OWRR Analysis
  min_owrr_yes: 0.65,           // OWRR ≥ 0.65 = strong YES signal
  max_owrr_no: 0.35,            // OWRR ≤ 0.35 = strong NO signal
  min_confidence: 'medium',      // Require medium+ confidence (12+ qualified wallets)

  // Wallet Qualification (per category)
  min_trades_in_category: 10,   // Filter: ≥10 trades in market's category
  min_omega_in_category: 1.0,   // Filter: Omega ≥ 1.0 in category

  // Position Analysis
  top_n_holders: 20,            // Analyze top 20 per side
  min_position_size_usd: 100,   // Ignore positions <$100
}
```

**Processing Steps**:
```typescript
For each market:
  1. Get market category (Politics, Crypto, Sports, etc.)

  2. Get top 20 YES holders from trades_raw:
     SELECT wallet_address, SUM(shares * entry_price) as position_value
     FROM trades_raw
     WHERE market_id = {market} AND side = 'YES' AND is_closed = 0
     GROUP BY wallet_address
     ORDER BY position_value DESC
     LIMIT 20

  3. Get top 20 NO holders (same query, side = 'NO')

  4. For each wallet, get category-specific metrics from wallet_metrics_by_category:
     - metric_2_omega_net (category-specific Omega)
     - metric_22_resolved_bets (trade count in category)

  5. Filter wallets:
     - Keep only wallets with ≥10 trades in market's category
     - Keep only wallets with Omega ≥ 1.0 in category

  6. Calculate OWRR using lib/metrics/owrr.ts logic:
     For each qualified wallet:
       voice = omega_in_category × sqrt(money_at_risk)

     S_YES = sum(voices of all YES wallets)
     S_NO = sum(voices of all NO wallets)
     OWRR = S_YES / (S_YES + S_NO)
     slider = round(100 × OWRR)

  7. Determine signal:
     if (OWRR >= 0.65 && confidence >= min_confidence):
       signal = 'BUY_YES'
       strength = OWRR
     else if (OWRR <= 0.35 && confidence >= min_confidence):
       signal = 'BUY_NO'
       strength = 1 - OWRR
     else:
       signal = 'SKIP'

  8. Calculate metadata:
     - qualified_wallets_yes: count
     - qualified_wallets_no: count
     - avg_omega_yes: average
     - avg_omega_no: average
     - total_smart_money_yes_usd: sum
     - total_smart_money_no_usd: sum
```

**Output**:
```typescript
{
  markets: [
    {
      market_id: string,
      market_title: string,
      category: string,
      signal: 'BUY_YES' | 'BUY_NO' | 'SKIP',
      owrr: number,              // 0.0 - 1.0
      slider: number,            // 0 - 100
      strength: number,          // 0.0 - 1.0
      confidence: 'low' | 'medium' | 'high',

      // Smart money stats
      qualified_wallets_yes: number,
      qualified_wallets_no: number,
      avg_omega_yes: number,
      avg_omega_no: number,
      total_smart_money_yes_usd: number,
      total_smart_money_no_usd: number,

      // Market metadata
      current_yes_price: number,
      current_no_price: number,
      liquidity_usd: number,
      closes_at: string,
    }
  ]
}
```

---

### 5. PROFIT_FILTER (NEW or extend MARKET_FILTER)
**Existing**: Could extend MARKET_FILTER or create new node

**Purpose**: Filter by profit potential

**Config**:
```typescript
{
  min_edge_percent: 10,         // Minimum 10% edge
  min_expected_value: 50,       // Minimum $50 EV per $100 bet

  // Edge calculation:
  // If signal = BUY_YES and OWRR = 0.70:
  //   implied_prob_by_smart_money = 0.70
  //   market_price = current_yes_price
  //   edge = (0.70 / market_price) - 1
  //   if edge >= 0.10 (10%): PASS
}
```

**Output**: Markets with sufficient profit potential

---

### 6. ORCHESTRATOR
**Existing**: Yes

**Purpose**: Position sizing based on signal strength and profit potential

**Config**:
```typescript
{
  position_sizing_rules: {
    fractional_kelly_lambda: 0.25,
    max_per_position: 0.05,
    min_bet: 10,
    max_bet: 500,

    // Signal-based multipliers
    signal_strength_multipliers: {
      // OWRR 0.65-0.70: 1.0x
      // OWRR 0.70-0.80: 1.25x
      // OWRR 0.80-0.90: 1.5x
      // OWRR 0.90-1.00: 2.0x
      high_confidence_multiplier: 1.5,
      very_high_confidence_multiplier: 2.0,
    }
  }
}
```

---

### 7. ACTION
**Existing**: Yes

**Purpose**: Execute trades on Polymarket

---

## New Node Executors to Create

### 1. `executeAIFilterNode` (NEW)
**File**: `/lib/workflow/node-executors.ts`

```typescript
async function executeAIFilterNode(
  config: any,
  inputs: any,
  context: ExecutionContext
): Promise<any> {
  const { prompt, accept_on, model = 'gpt-4' } = config
  const markets = inputs?.markets || []

  const filtered = []

  for (const market of markets) {
    const evaluation = await evaluateMarketWithAI(
      market,
      prompt,
      model
    )

    if (accept_on.some(keyword => evaluation.includes(keyword))) {
      filtered.push({
        ...market,
        ai_evaluation: evaluation,
        ai_passed: true,
      })
    }
  }

  return { markets: filtered }
}
```

---

### 2. `executeSmartMoneySignalNode` (NEW)
**File**: `/lib/workflow/node-executors.ts`

**Core Logic**:
```typescript
async function executeSmartMoneySignalNode(
  config: any,
  inputs: any,
  context: ExecutionContext
): Promise<any> {
  const markets = inputs?.markets || []
  const analyzed = []

  for (const market of markets) {
    // 1. Get top holders
    const topYesHolders = await getTopPositions(market.market_id, 'YES', 20)
    const topNoHolders = await getTopPositions(market.market_id, 'NO', 20)

    // 2. Get category-specific wallet metrics
    const walletMetrics = await getWalletMetricsByCategory(
      [...topYesHolders, ...topNoHolders],
      market.category
    )

    // 3. Filter qualified wallets
    const qualifiedYes = filterQualifiedWallets(
      topYesHolders,
      walletMetrics,
      config
    )
    const qualifiedNo = filterQualifiedWallets(
      topNoHolders,
      walletMetrics,
      config
    )

    // 4. Calculate OWRR
    const owrrResult = calculateOWRR(
      qualifiedYes,
      qualifiedNo,
      walletMetrics,
      market.category
    )

    // 5. Determine signal
    const signal = determineSignal(owrrResult, config)

    // 6. Skip if no signal
    if (signal.action === 'SKIP') continue

    analyzed.push({
      ...market,
      ...signal,
      ...owrrResult,
    })
  }

  return { markets: analyzed }
}
```

---

## Example Strategy Template

### "Smart Money Politics - High Conviction"

**Description**: Find politics markets where elite wallets are heavily positioned on one side

**Node Graph**:
```typescript
{
  nodes: [
    {
      id: 'data_source_markets',
      type: 'DATA_SOURCE',
      config: {
        source: 'MARKETS',
        filters: {
          active_only: true,
          min_liquidity_usd: 10000,
        }
      }
    },

    {
      id: 'filter_politics_markets',
      type: 'MARKET_FILTER',
      config: {
        categories: ['politics'],
        min_liquidity_usd: 50000,
        max_days_to_close: 14,
        min_days_to_close: 1,
      }
    },

    {
      id: 'ai_filter_figurable',
      type: 'AI_FILTER',
      config: {
        prompt: "Is this political outcome figure-outable based on polling, insider info, or expert analysis? Answer YES or NO.",
        accept_on: ['YES', 'yes'],
        model: 'gpt-4',
      }
    },

    {
      id: 'smart_money_signal',
      type: 'SMART_MONEY_SIGNAL',
      config: {
        min_owrr_yes: 0.65,
        max_owrr_no: 0.35,
        min_confidence: 'medium',
        min_trades_in_category: 10,
        min_omega_in_category: 1.0,
        top_n_holders: 20,
      }
    },

    {
      id: 'profit_filter',
      type: 'MARKET_FILTER',
      config: {
        min_edge_percent: 10,
      }
    },

    {
      id: 'orchestrator_position_sizing',
      type: 'ORCHESTRATOR',
      config: {
        mode: 'approval',
        portfolio_size_usd: 10000,
        position_sizing_rules: {
          fractional_kelly_lambda: 0.25,
          max_per_position: 0.05,
          min_bet: 10,
          max_bet: 500,
        }
      }
    },

    {
      id: 'action_execute',
      type: 'ACTION',
      config: {
        action: 'EXECUTE_TRADE',
      }
    }
  ],

  edges: [
    { from: 'data_source_markets', to: 'filter_politics_markets' },
    { from: 'filter_politics_markets', to: 'ai_filter_figurable' },
    { from: 'ai_filter_figurable', to: 'smart_money_signal' },
    { from: 'smart_money_signal', to: 'profit_filter' },
    { from: 'profit_filter', to: 'orchestrator_position_sizing' },
    { from: 'orchestrator_position_sizing', to: 'action_execute' },
  ]
}
```

---

## Key Differences vs Copy Trading

| Aspect | Copy Trading | Smart Money Market Strategy |
|--------|-------------|----------------------------|
| **Focus** | Follow specific wallets | Analyze markets |
| **Trigger** | When wallet makes a trade | When market has strong OWRR signal |
| **Data Source** | Wallet trades (real-time) | Market holder analysis (snapshot) |
| **Frequency** | High (every wallet trade) | Low (scheduled scans) |
| **Signal** | "Wallet X bought" | "Smart money heavily on YES" |
| **Use Case** | Ride coattails of elite traders | Find mispriced markets with consensus |

---

## Implementation Priority

### Phase 1: Core Nodes (This Sprint)
1. ✅ **DATA_SOURCE (MARKETS)** - Implement market fetching
2. ✅ **MARKET_FILTER** - Implement liquidity/date/category filters
3. ✅ **SMART_MONEY_SIGNAL** - Implement OWRR analysis (core!)
4. ⏸️ **AI_FILTER** - Optional for v1, nice-to-have

### Phase 2: Polish & Templates
5. Create strategy template: "Smart Money Politics"
6. Create strategy template: "Smart Money Crypto"
7. Add nodes to node palette UI
8. Add config panels for new nodes

### Phase 3: Future Enhancements
9. Real-time momentum tracking (watchlist → monitor → buy on momentum shift)
10. Historical backtesting for OWRR thresholds
11. Multi-market portfolio optimization

---

## Database Requirements

**Existing Tables (All Ready)**:
- ✅ `wallet_metrics_by_category` - Category-specific Omega, trades, etc.
- ✅ `trades_raw` - Open positions, top holders
- ✅ `markets_dim` - Market metadata
- ✅ `events_dim` - Category mappings

**No new tables needed!** Everything already exists.

---

## API Endpoints to Use

**Existing**:
- ✅ `/api/markets/[id]/owrr` - Get OWRR for a market (can reuse this!)
- ✅ ClickHouse queries for top holders (in `lib/metrics/owrr.ts`)

**Could Add** (nice-to-have):
- `/api/markets/scan` - Batch OWRR analysis for multiple markets
- `/api/markets/smart-money-signals` - Get all markets with strong signals

---

## Success Metrics

- **Market Coverage**: Scan 100+ active markets per run
- **Signal Quality**: OWRR ≥ 0.65 markets should win 65%+ of the time
- **Execution Speed**: Complete scan + analysis in <5 minutes
- **False Positive Rate**: <20% of signals should be neutral/wrong

---

## Next Steps

1. Implement `executeSmartMoneySignalNode` in `node-executors.ts`
2. Update `executeMarketFilterNode` to handle more filters
3. Create "Smart Money Politics" strategy template
4. Add SMART_MONEY_SIGNAL to node palette
5. Test with real politics markets
