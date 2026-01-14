# Smart Money Signals Research & Implementation Plan

> **Status:** Research Complete | Implementation Ready
> **Last Updated:** January 14, 2026
> **Data Analyzed:** 65,218 resolved markets, 1.6M hourly snapshots

---

## Executive Summary

After analyzing 65,218 resolved Polymarket markets, we discovered that "smart money" signals work **opposite to intuition** in most categories. The key insight:

**The edge is not in following smart money. The edge is in knowing WHEN to follow and WHEN to fade based on category and market conditions.**

### Top Findings

| Discovery | Implication |
|-----------|-------------|
| SM disagrees with crowd → Crowd wins 55-73% | Default: FADE smart money |
| SM ahead of crowd (70% vs 60%) → SM wins 76-100% | Exception: FOLLOW when SM leads |
| Category determines regime | Tech/Economy = follow, Other/Finance = fade |
| Crypto SM is worst (26.5% when contrarian) | Always fade crypto SM |

---

## Table of Contents

1. [Data Assets](#1-data-assets)
2. [Key Research Findings](#2-key-research-findings)
3. [Profitable Signal Catalog](#3-profitable-signal-catalog)
4. [Framework for Signal Discovery](#4-framework-for-signal-discovery)
5. [Untested Ideas](#5-untested-ideas-to-explore)
6. [TDD Implementation Plan](#6-tdd-implementation-plan)
7. [API Design](#7-api-design)
8. [Appendix: Raw Analysis Results](#appendix-raw-analysis-results)

---

## 1. Data Assets

### Primary Tables

#### `wio_smart_money_metrics_v2` (NEW - Backtesting Table)
**1,615,569 hourly snapshots across 65,218 resolved markets**

| Column | Type | Description |
|--------|------|-------------|
| market_id | String | Condition ID |
| ts | DateTime | Snapshot timestamp |
| category | String | Market category (Crypto, Politics, etc.) |
| series_slug | String | For recurring markets |
| end_date | DateTime | Resolution date |
| outcome_resolved | UInt8 | 0=NO won, 1=YES won |
| smart_money_odds | Float64 | Tier-weighted SM probability |
| crowd_price | Float64 | Market consensus price |
| wallet_count | UInt32 | Number of smart wallets |
| total_usd | Float64 | Total SM position size |
| superforecaster_yes/no_usd | Float64 | Tier breakdown |
| smart_yes/no_usd | Float64 | Tier breakdown |
| profitable_yes/no_usd | Float64 | Tier breakdown |
| flow_24h | Float64 | Net flow last 24h |

#### `wio_positions_v2` (Position-Level Data)
**32,254,686 position records**

| Column | Type | Description |
|--------|------|-------------|
| position_id | UInt64 | Unique identifier |
| wallet_id | String | Wallet address |
| condition_id | String | Market ID |
| side | String | YES/NO |
| cost_usd | Float64 | Position cost |
| pnl_usd | Float64 | Realized P&L |
| roi | Float64 | Return on investment |
| p_entry_side | Float64 | Entry price |
| outcome_side | UInt8 | Resolution (0=NO, 1=YES) |
| clv_4h/24h/72h | Float64 | Closing line value |

#### `wio_wallet_classification_v1` (Wallet Tiers)
| Tier | Description | Weight |
|------|-------------|--------|
| superforecaster | Top performers (Brier < 0.15) | 3.0x |
| smart | Consistent winners | 2.0x |
| profitable | Net positive | 1.0x |

#### `pm_market_metadata` (325,145 markets)
| Column | Description |
|--------|-------------|
| category | Crypto, Politics, Sports, Tech, Finance, etc. |
| tags | Array of topic tags |
| series_slug | For recurring market series |
| volume_usdc | Total market volume |

### Category Distribution in Backtesting Data

| Category | Markets | Snapshots | % of Data |
|----------|---------|-----------|-----------|
| Crypto | 26,682 | 289,636 | 41% |
| Other | 18,168 | 562,743 | 28% |
| Sports | 12,392 | 227,555 | 19% |
| Tech | 2,773 | 222,450 | 4% |
| Finance | 2,607 | 110,346 | 4% |
| Politics | 1,623 | 101,063 | 2% |
| Culture | 442 | 41,181 | 1% |
| World | 410 | 45,895 | 1% |
| Economy | 121 | 14,700 | <1% |

---

## 2. Key Research Findings

### Finding 1: Smart Money Loses When Contrarian

**When SM and crowd disagree on direction, crowd wins in every category except Economy (tiny sample).**

| Category | SM Disagrees (markets) | SM Wins | Crowd Wins |
|----------|------------------------|---------|------------|
| Crypto | 7,023 | 26.5% | **73.5%** |
| Culture | 11 | 27.3% | **72.7%** |
| Finance | 183 | 37.2% | **62.8%** |
| Sports | 3,236 | 41.0% | **59.0%** |
| Politics | 84 | 40.5% | **59.5%** |
| Tech | 229 | 41.0% | **59.0%** |
| Other | 2,760 | 42.3% | **57.7%** |
| World | 38 | 44.7% | **55.3%** |

**Implication:** Default strategy should be FADE smart money when they disagree with crowd.

### Finding 2: The Edge is SM Being AHEAD of Crowd

**When SM is confident (70%+) but crowd hasn't caught up yet (55-68%), SM has real alpha.**

This is the key insight: Information asymmetry creates edge. SM knowing something the crowd doesn't yet = follow. SM being wrong about something = fade.

| Category | Signal | Trades | Win Rate | ROI |
|----------|--------|--------|----------|-----|
| Economy | SM 70%+ YES, crowd 55-68% | 67 | **100%** | **+54%** |
| Tech | SM 70%+ YES, crowd 55-68% | 892 | **91%** | **+47%** |
| World | SM 70%+ YES, crowd 55-68% | 419 | **76%** | **+24%** |
| World | SM ≤30% NO, crowd 32-45% | 1,018 | **74%** | **+20%** |
| Politics | SM ≤30% NO, crowd 32-45% | 1,442 | **75%** | **+20%** |

### Finding 3: When They Agree, Market is Efficient

When SM and crowd both agree at high confidence (75%+), the market price already reflects this. Entry at 94-96 cents to win $1 gives negative expected value even with 65% win rate.

**Implication:** Don't chase consensus. The edge is in disagreement and information gaps.

### Finding 4: Category Determines Regime

| Category | Regime | Strategy |
|----------|--------|----------|
| Tech | SM has alpha | Follow SM when ahead of crowd |
| Economy | SM has alpha | Follow SM when ahead of crowd |
| World | SM has alpha | Follow SM when ahead of crowd |
| Politics | Partial alpha | Follow SM NO signals only |
| Crypto | SM is noise | FADE SM disagreement |
| Other | SM is noise | FADE SM disagreement |
| Finance | SM is noise | FADE SM disagreement |
| Sports | Mixed | Context-dependent |

### Finding 5: Timing Window Matters

- **5+ days before resolution:** Best for early signals with price edge
- **0-3 days:** Market has converged, less edge available
- **Sweet spot for Politics:** 5-7 days before with high consensus

---

## 3. Profitable Signal Catalog

### Tier 1: High-Confidence Signals (Implement First)

#### Signal 1: Tech YES (SM Ahead of Crowd)
```
Conditions:
  - category = 'Tech'
  - smart_money_odds >= 0.70
  - crowd_price BETWEEN 0.55 AND 0.68
  - days_before_resolution >= 5

Action: BET YES at crowd_price
Backtest: 892 trades, 91% win rate, +47% ROI
```

#### Signal 2: Politics NO (SM Bearish, Crowd Unsure)
```
Conditions:
  - category = 'Politics'
  - smart_money_odds <= 0.30
  - crowd_price BETWEEN 0.32 AND 0.45
  - days_before_resolution >= 5

Action: BET NO at (1 - crowd_price)
Backtest: 1,442 trades, 75% win rate, +20% ROI
```

#### Signal 3: World YES (SM Ahead of Crowd)
```
Conditions:
  - category = 'World'
  - smart_money_odds >= 0.70
  - crowd_price BETWEEN 0.55 AND 0.68
  - days_before_resolution >= 5

Action: BET YES at crowd_price
Backtest: 419 trades, 76% win rate, +24% ROI
```

#### Signal 4: World NO (SM Bearish)
```
Conditions:
  - category = 'World'
  - smart_money_odds <= 0.30
  - crowd_price BETWEEN 0.32 AND 0.45
  - days_before_resolution >= 5

Action: BET NO at (1 - crowd_price)
Backtest: 1,018 trades, 74% win rate, +20% ROI
```

### Tier 2: Fade Signals (Counter-Intuitive Alpha)

#### Signal 5: FADE Other YES
```
Conditions:
  - category = 'Other'
  - smart_money_odds >= 0.70
  - crowd_price BETWEEN 0.55 AND 0.68
  - days_before_resolution >= 5

Action: BET NO (fade SM)
Backtest: 4,186 trades, 61% win rate (fading), +36% ROI
```

#### Signal 6: FADE Finance NO
```
Conditions:
  - category = 'Finance'
  - smart_money_odds <= 0.30
  - crowd_price BETWEEN 0.32 AND 0.45
  - days_before_resolution >= 5

Action: BET YES (fade SM)
Backtest: 2,110 trades, 61% win rate (fading), +38% ROI
```

#### Signal 7: FADE Crypto Contrarian
```
Conditions:
  - category = 'Crypto'
  - SM direction != crowd direction
  - abs(smart_money_odds - crowd_price) >= 0.15

Action: Follow CROWD, not SM
Backtest: 7,023 trades, 73.5% win rate (fading SM)
```

### Tier 3: Exploratory Signals (Need More Testing)

#### Signal 8: Economy YES (Small Sample)
```
Conditions:
  - category = 'Economy'
  - smart_money_odds >= 0.70
  - crowd_price BETWEEN 0.55 AND 0.68

Backtest: 67 trades, 100% win rate, +54% ROI
Warning: Small sample size, needs validation
```

---

## 4. Framework for Signal Discovery

### The Information Asymmetry Model

```
                    SM CONFIDENT          SM UNCERTAIN
                    (>70% or <30%)        (30-70%)
                   ┌─────────────────┬─────────────────┐
                   │                 │                 │
    CROWD          │   FOLLOW SM     │    NO EDGE      │
    UNCERTAIN      │   (SM knows     │    (Both        │
    (40-60%)       │    something)   │    uncertain)   │
                   │                 │                 │
                   ├─────────────────┼─────────────────┤
                   │                 │                 │
    CROWD          │   CATEGORY      │    NO EDGE      │
    AGREES         │   DEPENDENT     │    (Consensus   │
    (>60% or <40%) │   (see rules)   │    priced in)   │
                   │                 │                 │
                   └─────────────────┴─────────────────┘
```

### Decision Framework

```python
def get_signal(market):
    sm = market.smart_money_odds
    crowd = market.crowd_price
    category = market.category
    days_out = market.days_before_resolution

    # Skip if too close to resolution
    if days_out < 5:
        return NO_SIGNAL

    # Determine directions
    sm_yes = sm > 0.5
    crowd_yes = crowd > 0.5

    # SM Ahead of Crowd (potential alpha)
    if sm >= 0.70 and crowd < 0.68:
        if category in ['Tech', 'Economy', 'World']:
            return BET_YES, crowd  # +24% to +54% ROI
        elif category in ['Other']:
            return BET_NO, 1-crowd  # FADE: +36% ROI

    if sm <= 0.30 and crowd > 0.32:
        if category in ['Politics', 'World', 'Tech', 'Crypto']:
            return BET_NO, 1-crowd  # +8% to +20% ROI
        elif category in ['Finance']:
            return BET_YES, crowd  # FADE: +38% ROI

    # SM vs Crowd Disagree
    if sm_yes != crowd_yes:
        if category == 'Crypto':
            return FOLLOW_CROWD  # Fade SM: 73.5% win
        else:
            return FOLLOW_CROWD  # Default: fade SM

    return NO_SIGNAL
```

### Metrics for Evaluating Signals

| Metric | Target | Description |
|--------|--------|-------------|
| **Win Rate** | >65% | % of trades that profit |
| **ROI** | >15% | Average return per trade |
| **Sample Size** | >100 | Minimum trades for confidence |
| **Edge vs Crowd** | >10% | Accuracy above market consensus |
| **Sharpe Ratio** | >1.0 | Risk-adjusted returns |

---

## 5. Untested Ideas to Explore

### High Priority (Strong Hypothesis)

#### 5.1 Tier-Weighted Signals
**Hypothesis:** Superforecasters alone may be more accurate than combined SM.

```sql
-- Test: Superforecaster-only accuracy vs combined SM
SELECT
  category,
  avgIf(correct, superforecaster_usd > smart_usd) as sf_dominant_acc,
  avgIf(correct, superforecaster_usd <= smart_usd) as sf_minority_acc
FROM signals
GROUP BY category
```

#### 5.2 Flow Momentum
**Hypothesis:** Accelerating SM buying predicts outcome better than static position.

```sql
-- Test: Flow momentum correlation with accuracy
SELECT
  sign(flow_24h) as flow_direction,
  abs(flow_24h) as flow_magnitude,
  accuracy
FROM signals
WHERE flow_24h != 0
```

#### 5.3 Wallet Count Velocity
**Hypothesis:** Rapid increase in smart wallet count signals information spreading.

```sql
-- Test: New wallets entering as predictive signal
SELECT
  new_wallets_24h / wallet_count as wallet_growth_rate,
  accuracy
FROM signals
```

#### 5.4 Position Concentration
**Hypothesis:** Single whale vs distributed consensus may have different accuracy.

```sql
-- Test: HHI of position concentration
SELECT
  top5_concentration,
  accuracy
FROM signals
```

### Medium Priority (Speculative)

#### 5.5 Series/Recurring Markets
**Hypothesis:** Recurring markets (daily crypto, weekly sports) may have different dynamics.

#### 5.6 Time-of-Day Patterns
**Hypothesis:** Signals posted during US trading hours may differ from overnight.

#### 5.7 Multi-Timeframe Confirmation
**Hypothesis:** Signal at 7 days confirmed at 3 days = higher accuracy.

#### 5.8 Extreme Single-Wallet Bets
**Hypothesis:** $100K+ from single wallet may indicate private information.

### Low Priority (Exploratory)

#### 5.9 Tag-Based Analysis
**Hypothesis:** Specific tags (e.g., "election", "earnings") may have unique patterns.

#### 5.10 Liquidity-Adjusted Signals
**Hypothesis:** Signals in illiquid markets may be more informative.

#### 5.11 Cross-Market Correlation
**Hypothesis:** SM position in related markets may be predictive.

---

## 6. TDD Implementation Plan

### Phase 1: Core Signal Engine (Week 1)

#### Test Suite 1: Signal Detection
```typescript
describe('SignalDetector', () => {
  describe('TechYesSignal', () => {
    it('should detect when SM >= 70% and crowd 55-68%', () => {
      const signal = detectSignal({
        category: 'Tech',
        smart_money_odds: 0.75,
        crowd_price: 0.62,
        days_before: 7
      });
      expect(signal.type).toBe('TECH_YES_AHEAD');
      expect(signal.action).toBe('BET_YES');
      expect(signal.entry_price).toBe(0.62);
    });

    it('should NOT detect when crowd >= 68%', () => {
      const signal = detectSignal({
        category: 'Tech',
        smart_money_odds: 0.75,
        crowd_price: 0.70,
        days_before: 7
      });
      expect(signal).toBeNull();
    });

    it('should NOT detect when days_before < 5', () => {
      const signal = detectSignal({
        category: 'Tech',
        smart_money_odds: 0.75,
        crowd_price: 0.62,
        days_before: 3
      });
      expect(signal).toBeNull();
    });
  });

  describe('FadeCryptoSignal', () => {
    it('should recommend fading SM when SM disagrees with crowd', () => {
      const signal = detectSignal({
        category: 'Crypto',
        smart_money_odds: 0.65,
        crowd_price: 0.42,
        days_before: 5
      });
      expect(signal.type).toBe('FADE_CRYPTO_SM');
      expect(signal.action).toBe('BET_NO'); // Follow crowd
    });
  });
});
```

#### Test Suite 2: ROI Calculation
```typescript
describe('ROICalculator', () => {
  it('should calculate positive ROI for winning YES bet', () => {
    const roi = calculateROI({
      action: 'BET_YES',
      entry_price: 0.62,
      outcome: 1 // YES won
    });
    expect(roi).toBeCloseTo(0.613, 2); // (1/0.62) - 1
  });

  it('should calculate -100% ROI for losing bet', () => {
    const roi = calculateROI({
      action: 'BET_YES',
      entry_price: 0.62,
      outcome: 0 // NO won
    });
    expect(roi).toBe(-1);
  });
});
```

#### Test Suite 3: Backtest Engine
```typescript
describe('BacktestEngine', () => {
  it('should match historical results for TechYes signal', async () => {
    const results = await backtest({
      signal: 'TECH_YES_AHEAD',
      start_date: '2025-11-14',
      end_date: '2026-01-14'
    });
    expect(results.trades).toBeGreaterThan(800);
    expect(results.win_rate).toBeGreaterThan(0.85);
    expect(results.roi).toBeGreaterThan(0.40);
  });
});
```

### Phase 2: API Endpoints (Week 2)

#### Test Suite 4: Signals API
```typescript
describe('GET /api/smart-money/signals/v2', () => {
  it('should return active signals with confidence scores', async () => {
    const response = await fetch('/api/smart-money/signals/v2');
    const data = await response.json();

    expect(data.signals).toBeArray();
    data.signals.forEach(signal => {
      expect(signal).toHaveProperty('market_id');
      expect(signal).toHaveProperty('signal_type');
      expect(signal).toHaveProperty('action');
      expect(signal).toHaveProperty('entry_price');
      expect(signal).toHaveProperty('expected_roi');
      expect(signal).toHaveProperty('backtest_win_rate');
      expect(signal).toHaveProperty('backtest_trades');
    });
  });

  it('should filter by category', async () => {
    const response = await fetch('/api/smart-money/signals/v2?category=Tech');
    const data = await response.json();

    data.signals.forEach(signal => {
      expect(signal.category).toBe('Tech');
    });
  });

  it('should filter by minimum ROI', async () => {
    const response = await fetch('/api/smart-money/signals/v2?min_roi=20');
    const data = await response.json();

    data.signals.forEach(signal => {
      expect(signal.expected_roi).toBeGreaterThanOrEqual(20);
    });
  });
});
```

#### Test Suite 5: Opportunities API
```typescript
describe('GET /api/smart-money/opportunities/v2', () => {
  it('should rank opportunities by expected value', async () => {
    const response = await fetch('/api/smart-money/opportunities/v2');
    const data = await response.json();

    // Should be sorted by expected_value descending
    for (let i = 1; i < data.opportunities.length; i++) {
      expect(data.opportunities[i-1].expected_value)
        .toBeGreaterThanOrEqual(data.opportunities[i].expected_value);
    }
  });
});
```

### Phase 3: Signal Discovery Pipeline (Week 3)

#### Test Suite 6: Hypothesis Testing Framework
```typescript
describe('HypothesisTester', () => {
  it('should validate signal with sufficient sample size', async () => {
    const result = await testHypothesis({
      name: 'tier_weighted_signal',
      conditions: {
        superforecaster_pct: { gte: 0.5 },
        divergence: { gte: 0.1 }
      },
      min_samples: 100
    });

    expect(result.sample_size).toBeGreaterThanOrEqual(100);
    expect(result.p_value).toBeLessThan(0.05);
    expect(result).toHaveProperty('win_rate');
    expect(result).toHaveProperty('roi');
    expect(result).toHaveProperty('confidence_interval');
  });
});
```

### Implementation Order

```
Week 1:
├── Day 1-2: Signal detection types and interfaces
├── Day 3-4: Core signal detection functions
└── Day 5: Backtest engine foundation

Week 2:
├── Day 1-2: /api/smart-money/signals/v2 endpoint
├── Day 3-4: /api/smart-money/opportunities/v2 endpoint
└── Day 5: Integration tests

Week 3:
├── Day 1-2: Hypothesis testing framework
├── Day 3-4: Automated signal discovery pipeline
└── Day 5: Documentation and monitoring
```

---

## 7. API Design

### Endpoint: GET /api/smart-money/signals/v2

**Purpose:** Return current actionable signals based on validated patterns.

```typescript
interface SignalV2 {
  // Identification
  market_id: string;
  signal_id: string;

  // Signal classification
  signal_type: 'TECH_YES_AHEAD' | 'POLITICS_NO_BEARISH' | 'FADE_CRYPTO' | ...;
  category: string;

  // Action
  action: 'BET_YES' | 'BET_NO' | 'FADE_YES' | 'FADE_NO';
  direction: 'YES' | 'NO';

  // Pricing
  entry_price: number;        // Current price to enter
  smart_money_odds: number;   // SM probability
  crowd_price: number;        // Market consensus
  divergence: number;         // SM - crowd

  // Timing
  days_before_resolution: number;
  timestamp: string;

  // Backtest metrics
  backtest_trades: number;
  backtest_win_rate: number;
  backtest_roi: number;

  // Risk metrics
  expected_roi: number;       // Based on backtest
  confidence_level: 'HIGH' | 'MEDIUM' | 'LOW';
  sample_size_warning: boolean;
}

interface SignalsResponseV2 {
  signals: SignalV2[];
  summary: {
    total_signals: number;
    by_category: Record<string, number>;
    by_action: Record<string, number>;
    avg_expected_roi: number;
  };
  metadata: {
    last_updated: string;
    backtest_period: string;
  };
}
```

### Endpoint: GET /api/smart-money/opportunities/v2

**Purpose:** Ranked list of best current opportunities.

```typescript
interface OpportunityV2 {
  rank: number;
  market_id: string;
  question: string;          // From metadata
  category: string;

  signal: SignalV2;

  // Sizing recommendation
  kelly_fraction: number;    // Optimal bet size
  max_position_usd: number;  // Based on liquidity

  // Expected value
  expected_value: number;    // EV per dollar bet
  expected_roi_pct: number;

  // Risk
  max_loss: number;          // If wrong
  probability_of_loss: number;
}
```

### Endpoint: POST /api/smart-money/backtest

**Purpose:** Run custom backtests on signal hypotheses.

```typescript
interface BacktestRequest {
  conditions: {
    category?: string[];
    smart_money_odds?: { gte?: number; lte?: number };
    crowd_price?: { gte?: number; lte?: number };
    wallet_count?: { gte?: number };
    days_before?: { gte?: number; lte?: number };
    divergence?: { gte?: number; lte?: number };
  };
  action: 'BET_YES' | 'BET_NO' | 'FOLLOW_SM' | 'FADE_SM';
  date_range?: {
    start: string;
    end: string;
  };
}

interface BacktestResponse {
  trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_roi: number;
  avg_roi: number;
  sharpe_ratio: number;
  max_drawdown: number;

  by_category: Record<string, {
    trades: number;
    win_rate: number;
    roi: number;
  }>;

  trades_sample: Array<{
    market_id: string;
    entry_price: number;
    outcome: number;
    roi: number;
  }>;
}
```

---

## Appendix: Raw Analysis Results

### A1: Overall SM vs Crowd Accuracy by Category

```
| Category | Markets | SM Accuracy | Crowd Accuracy | SM Edge |
|----------|---------|-------------|----------------|---------|
| Economy  | 122     | 70.5%       | 68.9%          | +1.6%   |
| Tech     | 2,798   | 70.2%       | 71.6%          | -1.4%   |
| Finance  | 2,614   | 70.8%       | 72.6%          | -1.8%   |
| Culture  | 446     | 67.0%       | 68.2%          | -1.2%   |
| World    | 414     | 66.4%       | 67.4%          | -1.0%   |
| Politics | 1,636   | 66.7%       | 67.8%          | -1.1%   |
| Other    | 18,357  | 63.0%       | 65.3%          | -2.3%   |
| Crypto   | 26,892  | 58.4%       | 70.8%          | -12.4%  |
| Sports   | 12,483  | 55.1%       | 59.8%          | -4.7%   |
```

### A2: SM Ahead of Crowd Signals (Full Results)

```
| Category | Signal Type    | Trades | Win Rate | Avg Entry | ROI    |
|----------|----------------|--------|----------|-----------|--------|
| Economy  | YES_MISPRICED  | 67     | 100.0%   | 65.2¢     | +53.6% |
| Tech     | YES_MISPRICED  | 892    | 91.1%    | 62.2¢     | +47.0% |
| World    | YES_MISPRICED  | 419    | 76.1%    | 61.8¢     | +23.9% |
| World    | NO_MISPRICED   | 1,018  | 74.3%    | 62.2¢     | +19.8% |
| Politics | NO_MISPRICED   | 1,442  | 74.6%    | 62.2¢     | +19.7% |
| Tech     | NO_MISPRICED   | 673    | 68.8%    | 62.2¢     | +11.3% |
| Economy  | NO_MISPRICED   | 86     | 68.6%    | 63.1¢     | +9.7%  |
| Crypto   | NO_MISPRICED   | 1,602  | 67.6%    | 62.3¢     | +8.0%  |
| Culture  | NO_MISPRICED   | 364    | 67.6%    | 63.0¢     | +7.6%  |
| Politics | YES_MISPRICED  | 805    | 64.3%    | 61.1¢     | +5.6%  |
| Crypto   | YES_MISPRICED  | 809    | 63.3%    | 61.8¢     | +3.1%  |
```

### A3: FADE Signals (Bet Against SM)

```
| Category | Signal Type    | Trades | SM Win   | Fade Win | Fade ROI |
|----------|----------------|--------|----------|----------|----------|
| Other    | YES_MISPRICED  | 4,186  | 39.5%    | 60.5%    | +36.2%   |
| Finance  | NO_MISPRICED   | 2,110  | 39.1%    | 60.9%    | +38.2%   |
| Finance  | YES_MISPRICED  | 927    | 48.0%    | 52.0%    | +21.5%   |
| Sports   | NO_MISPRICED   | 913    | 48.2%    | 51.8%    | +20.6%   |
| Other    | NO_MISPRICED   | 6,714  | 51.1%    | 48.9%    | +17.6%   |
```

### A4: Timing Analysis (Days Before Resolution)

```
| Days Before | Snapshots | SM Accuracy | Crowd Accuracy | SM Edge |
|-------------|-----------|-------------|----------------|---------|
| 0           | 360,316   | 55.9%       | 57.2%          | -1.4%   |
| 1           | 239,085   | 56.5%       | 56.6%          | -0.2%   |
| 2           | 108,768   | 57.3%       | 58.6%          | -1.3%   |
| 3           | 72,810    | 58.2%       | 59.6%          | -1.4%   |
| 4           | 57,257    | 60.3%       | 61.4%          | -1.1%   |
| 5           | 49,780    | 61.7%       | 62.7%          | -1.1%   |
| 6           | 44,664    | 60.6%       | 63.1%          | -2.5%   |
| 7           | 38,924    | 61.0%       | 63.1%          | -2.1%   |
| 14          | 16,212    | 62.0%       | 64.6%          | -2.6%   |
| 21          | 11,756    | 61.3%       | 62.2%          | -0.9%   |
| 28          | 13,720    | 63.7%       | 65.1%          | -1.4%   |
```

---

## Next Steps

1. **Implement Phase 1** - Core signal detection with TDD
2. **Validate signals on recent data** - Ensure patterns hold in last 30 days
3. **Build monitoring dashboard** - Track signal performance in real-time
4. **Explore untested ideas** - Tier weighting, flow momentum, etc.
5. **Paper trading** - Run signals without real money to validate

---

*Document generated from analysis of 65,218 resolved Polymarket markets.*
*Backtest period: November 14, 2025 - January 14, 2026*
