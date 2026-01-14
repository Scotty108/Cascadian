# Smart Money Signals v2 - Implementation Tasks

> **Approach:** Test-Driven Development (TDD)
> **Priority:** Ship high-confidence signals first, iterate on exploratory

---

## Phase 1: Core Signal Engine

### Task 1.1: Define Signal Types and Interfaces
**Priority:** P0 | **Estimate:** 2 hours

```typescript
// lib/smart-money/types.ts

export type SignalType =
  | 'TECH_YES_AHEAD'
  | 'TECH_NO_BEARISH'
  | 'POLITICS_NO_BEARISH'
  | 'WORLD_YES_AHEAD'
  | 'WORLD_NO_BEARISH'
  | 'ECONOMY_YES_AHEAD'
  | 'FADE_CRYPTO_CONTRARIAN'
  | 'FADE_OTHER_YES'
  | 'FADE_FINANCE_NO';

export type SignalAction = 'BET_YES' | 'BET_NO';

export interface SignalConditions {
  category: string[];
  smart_money_odds: { min?: number; max?: number };
  crowd_price: { min?: number; max?: number };
  days_before: { min?: number; max?: number };
  wallet_count?: { min?: number };
}

export interface SignalDefinition {
  type: SignalType;
  name: string;
  description: string;
  conditions: SignalConditions;
  action: SignalAction;
  backtest: {
    trades: number;
    win_rate: number;
    roi: number;
  };
}

export interface DetectedSignal {
  signal_type: SignalType;
  market_id: string;
  action: SignalAction;
  entry_price: number;
  smart_money_odds: number;
  crowd_price: number;
  divergence: number;
  days_before: number;
  expected_roi: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}
```

**Tests to Write:**
- [ ] Type exports compile correctly
- [ ] SignalDefinition validates required fields
- [ ] DetectedSignal interface matches API response shape

---

### Task 1.2: Implement Signal Definitions Registry
**Priority:** P0 | **Estimate:** 3 hours

```typescript
// lib/smart-money/signal-definitions.ts

export const SIGNAL_DEFINITIONS: SignalDefinition[] = [
  {
    type: 'TECH_YES_AHEAD',
    name: 'Tech YES - SM Ahead of Crowd',
    description: 'Smart money confident on YES, crowd hasnt caught up',
    conditions: {
      category: ['Tech'],
      smart_money_odds: { min: 0.70 },
      crowd_price: { min: 0.55, max: 0.68 },
      days_before: { min: 5 },
    },
    action: 'BET_YES',
    backtest: { trades: 892, win_rate: 0.911, roi: 0.47 },
  },
  // ... all other signals
];
```

**Tests to Write:**
- [ ] All signal definitions have required fields
- [ ] Backtest stats are within valid ranges (0-1 for rates)
- [ ] No duplicate signal types
- [ ] Category arrays are non-empty

---

### Task 1.3: Implement Signal Detection Function
**Priority:** P0 | **Estimate:** 4 hours

```typescript
// lib/smart-money/detect-signals.ts

export function detectSignal(market: MarketSnapshot): DetectedSignal | null {
  for (const definition of SIGNAL_DEFINITIONS) {
    if (matchesConditions(market, definition.conditions)) {
      return {
        signal_type: definition.type,
        market_id: market.market_id,
        action: definition.action,
        entry_price: definition.action === 'BET_YES'
          ? market.crowd_price
          : 1 - market.crowd_price,
        smart_money_odds: market.smart_money_odds,
        crowd_price: market.crowd_price,
        divergence: market.smart_money_odds - market.crowd_price,
        days_before: market.days_before,
        expected_roi: definition.backtest.roi,
        confidence: calculateConfidence(definition, market),
      };
    }
  }
  return null;
}

function matchesConditions(market: MarketSnapshot, conditions: SignalConditions): boolean {
  // Category check
  if (!conditions.category.includes(market.category)) return false;

  // SM odds check
  if (conditions.smart_money_odds.min && market.smart_money_odds < conditions.smart_money_odds.min) return false;
  if (conditions.smart_money_odds.max && market.smart_money_odds > conditions.smart_money_odds.max) return false;

  // Crowd price check
  if (conditions.crowd_price.min && market.crowd_price < conditions.crowd_price.min) return false;
  if (conditions.crowd_price.max && market.crowd_price > conditions.crowd_price.max) return false;

  // Days before check
  if (conditions.days_before.min && market.days_before < conditions.days_before.min) return false;
  if (conditions.days_before.max && market.days_before > conditions.days_before.max) return false;

  // Wallet count check (optional)
  if (conditions.wallet_count?.min && market.wallet_count < conditions.wallet_count.min) return false;

  return true;
}
```

**Tests to Write:**
- [ ] `detectSignal` returns null for non-matching market
- [ ] `detectSignal` returns correct signal type for TECH_YES_AHEAD conditions
- [ ] `detectSignal` returns correct signal type for FADE_CRYPTO conditions
- [ ] `matchesConditions` handles missing optional fields
- [ ] `matchesConditions` handles edge cases (exact boundary values)
- [ ] Entry price calculated correctly for YES vs NO bets
- [ ] Confidence level set appropriately based on backtest sample size

---

### Task 1.4: Implement ROI Calculator
**Priority:** P0 | **Estimate:** 2 hours

```typescript
// lib/smart-money/roi-calculator.ts

export interface TradeResult {
  action: SignalAction;
  entry_price: number;
  outcome: 0 | 1; // 0 = NO won, 1 = YES won
}

export function calculateROI(trade: TradeResult): number {
  const won = (trade.action === 'BET_YES' && trade.outcome === 1) ||
              (trade.action === 'BET_NO' && trade.outcome === 0);

  if (won) {
    // Payout is $1, cost is entry_price
    return (1 / trade.entry_price) - 1;
  } else {
    return -1; // Lost entire stake
  }
}

export function calculateExpectedValue(
  win_rate: number,
  entry_price: number
): number {
  // EV = P(win) * payout - P(lose) * stake
  // Since we stake entry_price to win (1 - entry_price):
  // EV = win_rate * (1/entry_price - 1) + (1 - win_rate) * (-1)
  const roi_if_win = (1 / entry_price) - 1;
  return win_rate * roi_if_win + (1 - win_rate) * (-1);
}

export function calculateKellyFraction(
  win_rate: number,
  entry_price: number
): number {
  // Kelly = (bp - q) / b
  // where b = odds received (payout/stake - 1), p = win prob, q = lose prob
  const b = (1 / entry_price) - 1; // odds
  const p = win_rate;
  const q = 1 - win_rate;

  const kelly = (b * p - q) / b;
  return Math.max(0, Math.min(kelly, 0.25)); // Cap at 25%
}
```

**Tests to Write:**
- [ ] `calculateROI` returns correct positive ROI for winning YES bet
- [ ] `calculateROI` returns correct positive ROI for winning NO bet
- [ ] `calculateROI` returns -1 for losing bet
- [ ] `calculateExpectedValue` returns positive for profitable signals
- [ ] `calculateExpectedValue` returns negative for unprofitable signals
- [ ] `calculateKellyFraction` returns 0 for negative EV
- [ ] `calculateKellyFraction` caps at 25%

---

### Task 1.5: Implement Backtest Engine
**Priority:** P0 | **Estimate:** 6 hours

```typescript
// lib/smart-money/backtest-engine.ts

export interface BacktestConfig {
  signal_type?: SignalType;
  conditions?: Partial<SignalConditions>;
  start_date?: string;
  end_date?: string;
}

export interface BacktestResults {
  trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_roi: number;
  avg_roi: number;
  sharpe_ratio: number;
  max_drawdown: number;
  by_category: Record<string, CategoryResults>;
  trades_sample: TradeSample[];
}

export async function runBacktest(config: BacktestConfig): Promise<BacktestResults> {
  const query = buildBacktestQuery(config);
  const results = await clickhouse.query({ query, format: 'JSONEachRow' });
  return processBacktestResults(results);
}
```

**Tests to Write:**
- [ ] `runBacktest` returns correct trade count
- [ ] `runBacktest` calculates win_rate correctly
- [ ] `runBacktest` matches known historical results for TECH_YES_AHEAD
- [ ] `runBacktest` handles empty results gracefully
- [ ] `runBacktest` respects date range filters
- [ ] Sharpe ratio calculation is correct
- [ ] Max drawdown calculation is correct

---

## Phase 2: API Endpoints

### Task 2.1: Implement GET /api/smart-money/signals/v2
**Priority:** P0 | **Estimate:** 4 hours

```typescript
// app/api/smart-money/signals/v2/route.ts

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const category = searchParams.get('category');
  const minRoi = parseFloat(searchParams.get('min_roi') || '0');
  const limit = parseInt(searchParams.get('limit') || '50');

  // Get current market snapshots
  const markets = await getCurrentMarketSnapshots();

  // Detect signals
  const signals = markets
    .map(m => detectSignal(m))
    .filter(s => s !== null)
    .filter(s => !category || s.category === category)
    .filter(s => s.expected_roi >= minRoi / 100)
    .slice(0, limit);

  return NextResponse.json({
    signals,
    summary: calculateSummary(signals),
    metadata: {
      last_updated: new Date().toISOString(),
      backtest_period: '2025-11-14 to 2026-01-14',
    },
  });
}
```

**Tests to Write:**
- [ ] Returns 200 with valid response shape
- [ ] Filters by category correctly
- [ ] Filters by min_roi correctly
- [ ] Respects limit parameter
- [ ] Returns empty array when no signals match
- [ ] Summary stats are accurate

---

### Task 2.2: Implement GET /api/smart-money/opportunities/v2
**Priority:** P1 | **Estimate:** 4 hours

**Tests to Write:**
- [ ] Returns opportunities ranked by expected_value
- [ ] Includes Kelly fraction for sizing
- [ ] Includes market metadata (question, category)
- [ ] Handles pagination correctly

---

### Task 2.3: Implement POST /api/smart-money/backtest
**Priority:** P1 | **Estimate:** 4 hours

**Tests to Write:**
- [ ] Accepts custom conditions
- [ ] Returns backtest results matching expected shape
- [ ] Validates input conditions
- [ ] Returns error for invalid date ranges
- [ ] Rate limited appropriately

---

## Phase 3: Exploratory Analysis Pipeline

### Task 3.1: Implement Hypothesis Testing Framework
**Priority:** P2 | **Estimate:** 6 hours

```typescript
// lib/smart-money/hypothesis-tester.ts

export interface Hypothesis {
  name: string;
  conditions: Record<string, any>;
  action: SignalAction;
}

export interface HypothesisResult {
  hypothesis: Hypothesis;
  sample_size: number;
  win_rate: number;
  roi: number;
  p_value: number;
  confidence_interval: [number, number];
  is_significant: boolean;
}

export async function testHypothesis(h: Hypothesis): Promise<HypothesisResult> {
  // Run backtest with hypothesis conditions
  // Calculate statistical significance
  // Return results
}
```

**Tests to Write:**
- [ ] Calculates p-value correctly
- [ ] Rejects hypothesis with insufficient sample size
- [ ] Confidence interval contains true win rate (simulation test)

---

### Task 3.2: Implement Tier-Weighted Signal Analysis
**Priority:** P2 | **Estimate:** 4 hours

Test hypothesis: Superforecaster-only signals are more accurate than combined SM.

**Tests to Write:**
- [ ] Query correctly isolates superforecaster positions
- [ ] Comparison shows statistical difference (if exists)

---

### Task 3.3: Implement Flow Momentum Analysis
**Priority:** P2 | **Estimate:** 4 hours

Test hypothesis: Accelerating flow predicts outcomes better than static position.

**Tests to Write:**
- [ ] Flow momentum calculated correctly
- [ ] Correlation with outcome is measured

---

## Phase 4: Monitoring & Production

### Task 4.1: Implement Signal Performance Tracker
**Priority:** P1 | **Estimate:** 4 hours

Track real-time performance of signals once markets resolve.

**Tests to Write:**
- [ ] Records signal when generated
- [ ] Updates with outcome when resolved
- [ ] Calculates rolling performance metrics

---

### Task 4.2: Implement Alerting System
**Priority:** P2 | **Estimate:** 3 hours

Alert when high-confidence signals appear.

**Tests to Write:**
- [ ] Sends alert for high-confidence signals
- [ ] Respects cooldown between alerts
- [ ] Filters by user preferences

---

## Test File Structure

```
__tests__/
├── smart-money/
│   ├── types.test.ts
│   ├── signal-definitions.test.ts
│   ├── detect-signals.test.ts
│   ├── roi-calculator.test.ts
│   ├── backtest-engine.test.ts
│   └── hypothesis-tester.test.ts
├── api/
│   ├── signals-v2.test.ts
│   ├── opportunities-v2.test.ts
│   └── backtest.test.ts
└── integration/
    └── end-to-end.test.ts
```

---

## Definition of Done

For each task:
- [ ] All tests written and passing
- [ ] Code reviewed
- [ ] TypeScript types complete (no `any`)
- [ ] Error handling implemented
- [ ] Logging added for debugging
- [ ] Documentation updated

---

## Dependencies

```
Phase 1 (no dependencies):
  Task 1.1 → Task 1.2 → Task 1.3 → Task 1.4 → Task 1.5

Phase 2 (depends on Phase 1):
  Task 2.1 depends on: 1.1, 1.2, 1.3
  Task 2.2 depends on: 2.1
  Task 2.3 depends on: 1.5

Phase 3 (depends on Phase 1):
  Task 3.1 depends on: 1.5
  Task 3.2, 3.3 depend on: 3.1

Phase 4 (depends on Phase 2):
  Task 4.1 depends on: 2.1
  Task 4.2 depends on: 4.1
```

---

## Quick Start

```bash
# Run all smart money tests
npm test -- --grep "smart-money"

# Run specific test file
npm test -- __tests__/smart-money/detect-signals.test.ts

# Run backtest validation
npx tsx scripts/validate-signal-backtest.ts
```
