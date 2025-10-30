# Smart Money Market Strategy - Implementation Plan

## Summary

We're building a **market-focused** trading strategy that scans markets to find where smart money (elite wallets by category) is heavily positioned on one side. This complements our existing **wallet-focused** copy trading strategies.

---

## What We're Building

### Strategy Flow:
```
Markets → Filter → AI Check → OWRR Analysis → Trade
```

### Detailed Flow:
1. **DATA_SOURCE**: Fetch all active markets from Polymarket
2. **MARKET_FILTER**: Filter by liquidity, end date, category
3. **AI_FILTER** (optional): "Is this figure-outable?"
4. **SMART_MONEY_SIGNAL**: Analyze top holders + calculate OWRR
5. **ORCHESTRATOR**: Position sizing based on signal strength
6. **ACTION**: Execute trades

---

## New Node Types

### 1. SMART_MONEY_SIGNAL (Core Innovation)
**What it does**:
- Takes filtered markets as input
- For each market:
  - Calls `lib/metrics/owrr.ts::calculateOWRR(market_id, category)`
  - Gets OWRR, confidence, breakdown
  - Determines signal: BUY_YES, BUY_NO, or SKIP
  - Filters markets by OWRR threshold
- Returns only markets with strong smart money signals

**Config**:
```typescript
{
  min_owrr_yes: 0.65,        // OWRR ≥ 0.65 = strong YES (2+ wallets agree)
  max_owrr_no: 0.35,         // OWRR ≤ 0.35 = strong NO
  min_confidence: 'medium',   // Require medium+ (12+ qualified wallets)
}
```

**Implementation**:
```typescript
async function executeSmartMoneySignalNode(config, inputs, context) {
  const markets = inputs?.markets || []
  const analyzed = []

  for (const market of markets) {
    // Calculate OWRR using existing function
    const owrrResult = await calculateOWRR(market.market_id, market.category)

    // Determine signal
    const signal = determineSignal(owrrResult, config)

    if (signal.action !== 'SKIP') {
      analyzed.push({
        ...market,
        signal: signal.action,
        owrr: owrrResult.owrr,
        slider: owrrResult.slider,
        confidence: owrrResult.confidence,
        ...signal.metadata
      })
    }
  }

  return { markets: analyzed }
}
```

---

### 2. AI_FILTER (Nice-to-Have)
**What it does**:
- Uses LLM to evaluate markets
- Example prompt: "Is this outcome figure-outable? YES or NO"
- Filters markets based on LLM response

**Config**:
```typescript
{
  prompt: "Is this figure-outable?",
  accept_on: ['YES', 'yes'],
  model: 'gpt-4'
}
```

---

### 3. MARKET_FILTER (Enhancement)
**What it does**:
- Currently a stub - needs full implementation
- Filter by liquidity, end date, category, keywords

**Config**:
```typescript
{
  min_liquidity_usd: 50000,
  max_days_to_close: 14,
  min_days_to_close: 1,
  categories: ['politics'],
  exclude_keywords: ['parlay']
}
```

---

## Implementation Steps

### Step 1: Add SMART_MONEY_SIGNAL to switch statement
File: `/lib/workflow/node-executors.ts`

```typescript
case 'SMART_MONEY_SIGNAL':
  return executeSmartMoneySignalNode(config, inputs, context)
```

### Step 2: Implement executeSmartMoneySignalNode
File: `/lib/workflow/node-executors.ts`

```typescript
async function executeSmartMoneySignalNode(
  config: any,
  inputs: any,
  context: ExecutionContext
): Promise<any> {
  const { calculateOWRR } = await import('@/lib/metrics/owrr')

  const markets = inputs?.markets || []
  const {
    min_owrr_yes = 0.65,
    max_owrr_no = 0.35,
    min_confidence = 'medium'
  } = config

  const analyzed = []

  console.log(`[SMART_MONEY_SIGNAL] Analyzing ${markets.length} markets`)

  for (const market of markets) {
    try {
      // Calculate OWRR
      const owrrResult = await calculateOWRR(market.market_id, market.category)

      // Determine signal
      let signal: 'BUY_YES' | 'BUY_NO' | 'SKIP' = 'SKIP'
      let reason = ''

      const confidenceMet = checkConfidence(owrrResult.confidence, min_confidence)

      if (owrrResult.owrr >= min_owrr_yes && confidenceMet) {
        signal = 'BUY_YES'
        reason = `Strong smart money on YES (OWRR ${owrrResult.slider}/100)`
      } else if (owrrResult.owrr <= max_owrr_no && confidenceMet) {
        signal = 'BUY_NO'
        reason = `Strong smart money on NO (OWRR ${owrrResult.slider}/100)`
      } else if (!confidenceMet) {
        reason = `Insufficient data (confidence: ${owrrResult.confidence})`
      } else {
        reason = `Neutral OWRR (${owrrResult.slider}/100)`
      }

      if (signal !== 'SKIP') {
        analyzed.push({
          ...market,
          signal,
          reason,
          owrr: owrrResult.owrr,
          slider: owrrResult.slider,
          confidence: owrrResult.confidence,
          yes_qualified: owrrResult.yes_qualified,
          no_qualified: owrrResult.no_qualified,
          yes_avg_omega: owrrResult.yes_avg_omega,
          no_avg_omega: owrrResult.no_avg_omega,
        })
      }
    } catch (error) {
      console.error(`[SMART_MONEY_SIGNAL] Error analyzing market ${market.market_id}:`, error)
    }
  }

  console.log(`[SMART_MONEY_SIGNAL] Found ${analyzed.length} markets with strong signals`)

  return {
    markets: analyzed,
    count: analyzed.length,
    total_analyzed: markets.length,
    timestamp: Date.now()
  }
}

function checkConfidence(
  actual: 'high' | 'medium' | 'low' | 'insufficient_data',
  required: string
): boolean {
  const levels = ['insufficient_data', 'low', 'medium', 'high']
  const actualLevel = levels.indexOf(actual)
  const requiredLevel = levels.indexOf(required)
  return actualLevel >= requiredLevel
}
```

### Step 3: Implement executeMarketFilterNode (proper version)
File: `/lib/workflow/node-executors.ts`

```typescript
async function executeMarketFilterNode(
  config: any,
  inputs: any,
  context: ExecutionContext
): Promise<any> {
  let markets = inputs?.markets || inputs?.data || inputs || []

  const originalCount = markets.length
  console.log(`[MARKET_FILTER] Filtering ${originalCount} markets`)

  // Filter by liquidity
  if (config.min_liquidity_usd) {
    markets = markets.filter((m: any) => m.liquidity_usd >= config.min_liquidity_usd)
  }

  // Filter by days to close
  if (config.max_days_to_close || config.min_days_to_close) {
    markets = markets.filter((m: any) => {
      const daysToClose = calculateDaysToClose(m.closes_at)
      if (config.max_days_to_close && daysToClose > config.max_days_to_close) return false
      if (config.min_days_to_close && daysToClose < config.min_days_to_close) return false
      return true
    })
  }

  // Filter by category
  if (config.categories && config.categories.length > 0) {
    markets = markets.filter((m: any) => config.categories.includes(m.category))
  }

  // Filter by keywords (exclude)
  if (config.exclude_keywords && config.exclude_keywords.length > 0) {
    markets = markets.filter((m: any) => {
      const text = `${m.title} ${m.description}`.toLowerCase()
      return !config.exclude_keywords.some((kw: string) => text.includes(kw.toLowerCase()))
    })
  }

  console.log(`[MARKET_FILTER] ${markets.length} markets passed filter`)

  return {
    markets,
    count: markets.length,
    original_count: originalCount,
    filter_applied: true,
    timestamp: Date.now()
  }
}

function calculateDaysToClose(closesAt: string): number {
  const now = new Date()
  const close = new Date(closesAt)
  const diff = close.getTime() - now.getTime()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}
```

### Step 4: (Optional) Implement AI_FILTER
Skip for now - can add later if needed

### Step 5: Add nodes to palette
File: `/components/node-palette.tsx`

```typescript
{
  type: "SMART_MONEY_SIGNAL",
  label: "Smart Money Signal",
  icon: <Brain className="h-4 w-4" />,
  color: "bg-emerald-500",
  description: "Analyze smart money positioning",
  category: "Signals",
},
```

### Step 6: Create strategy template
File: `/scripts/create-smart-money-politics-strategy.ts`

---

## Testing Plan

1. **Unit Test SMART_MONEY_SIGNAL**:
   - Mock markets array
   - Mock OWRR responses
   - Verify filtering logic

2. **Integration Test**:
   - Load real politics markets
   - Run SMART_MONEY_SIGNAL
   - Verify OWRR calculations match API

3. **End-to-End Test**:
   - Deploy strategy
   - Run on scheduler
   - Verify trades triggered on strong signals

---

## Success Criteria

✅ SMART_MONEY_SIGNAL node can analyze 100+ markets in <5 minutes
✅ Markets with OWRR ≥ 0.65 should have 65%+ win rate
✅ Strategy can be built and deployed in Strategy Builder
✅ Visual node graph is clear and understandable

---

## Next Actions

1. Add SMART_MONEY_SIGNAL case to switch
2. Implement executeSmartMoneySignalNode
3. Update executeMarketFilterNode
4. Add SMART_MONEY_SIGNAL to node palette
5. Create strategy template
6. Test with real markets
