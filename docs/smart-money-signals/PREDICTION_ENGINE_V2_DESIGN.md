# Prediction Engine V2 Design

> **Status:** Design Phase | Based on analysis of 60M+ positions, 1M+ snapshots
> **Goal:** Beat crowd accuracy at all timeframes using smart money consensus signals

---

## Executive Summary

The key insight from data analysis: **Unanimous consensus among elite traders predicts outcomes dramatically better than raw aggregation.** When 3+ superforecasters ALL agree on the same side, accuracy jumps 20-30% above baseline.

### Baseline to Beat (Crowd Accuracy)

| Timeframe | Crowd Accuracy | Current SM Accuracy | Gap |
|-----------|---------------|---------------------|-----|
| 4 hours | 57.3% | 55.5% | -1.8% |
| 1 day | 55.4% | 55.4% | 0% |
| 3 days | 58.7% | 57.4% | -1.3% |
| 7 days | 61.7% | 60.2% | -1.5% |
| 30 days | 64.2% | 62.1% | -2.1% |

**Problem:** Raw SM odds are WORSE than crowd. Solution: Conditional signals.

### Target Performance

| Timeframe | Target Accuracy | Improvement |
|-----------|----------------|-------------|
| 4 hours | 62% | +5% |
| 1 day | 60% | +5% |
| 7 days | 68% | +6% |
| 30 days | 72% | +8% |

---

## Part 1: Wallet Scoring System

### 1.1 Elite Wallet Identification

Replace simple tier classification with **category-specific elite scoring**:

```typescript
interface WalletCategoryScore {
  wallet_id: string;
  category: MarketCategory;

  // Performance metrics
  early_accuracy: number;      // Accuracy when betting 7+ days early
  overall_accuracy: number;    // All-time accuracy
  resolved_bets: number;       // Sample size
  avg_days_before: number;     // How early they typically bet
  total_usd: number;          // Position sizes

  // Derived scores
  elite_score: number;         // Combined quality metric
  is_elite: boolean;          // Qualifies as "elite" in this category
}
```

**Elite Criteria (per category):**
- `early_accuracy >= 65%` (betting right when betting early)
- `resolved_bets >= 20` (sufficient sample size)
- `avg_days_before >= 5` (actually betting early, not chasing)

### 1.2 Elite Wallet Query

```sql
-- Compute elite wallets per category
CREATE TABLE wio_elite_wallets_v1 AS
SELECT
  wallet_id,
  category,
  countIf(is_resolved = 1 AND outcome_side IN (0,1)) as resolved_bets,
  avgIf(if((side = 'YES' AND outcome_side = 1) OR (side = 'NO' AND outcome_side = 0), 1, 0),
        is_resolved = 1 AND outcome_side IN (0,1)) as overall_accuracy,
  avgIf(if((side = 'YES' AND outcome_side = 1) OR (side = 'NO' AND outcome_side = 0), 1, 0),
        is_resolved = 1 AND outcome_side IN (0,1) AND dateDiff('day', ts_open, end_ts) >= 7) as early_accuracy,
  avg(dateDiff('day', ts_open, end_ts)) as avg_days_before,
  sum(cost_usd) as total_usd,
  -- Elite score: weighted combination
  (early_accuracy * 0.6 + overall_accuracy * 0.3 + least(resolved_bets/100, 1) * 0.1) as elite_score,
  -- Is elite if meets criteria
  (early_accuracy >= 0.65 AND resolved_bets >= 20 AND avg_days_before >= 5) as is_elite
FROM wio_positions_v2
WHERE cost_usd >= 100 AND category != ''
GROUP BY wallet_id, category
```

### 1.3 Performance by Elite Status

From analysis, elite wallets (100% early accuracy) exist in each category:

| Category | Elite Wallets | Sample Elite | Early Accuracy |
|----------|--------------|--------------|----------------|
| Crypto | 200+ | 0x8922fe80... | 100% (96 bets) |
| Economy | 50+ | 0x8debd189... | 100% (86 bets) |
| Tech | 100+ | 0x47090d99... | 100% (81 bets) |
| Politics | 100+ | 0xb1a190be... | 100% (76 bets) |

---

## Part 2: Consensus Detection

### 2.1 The Key Finding: Unanimous Consensus

**Superforecasters Unanimous vs Divided:**

| Category | Unanimous (3+) | Divided | Accuracy Gain |
|----------|---------------|---------|---------------|
| **Crypto** | 85.0% | 57.3% | **+27.7%** |
| **Finance** | 76.1% | 46.3% | **+29.8%** |
| **Tech** | 73.8% | 52.7% | **+21.1%** |
| Other | 55.5% | 47.2% | +8.3% |
| Politics | 53.9% | 46.7% | +7.2% |

**Insight:** When elite wallets are DIVIDED, prediction accuracy drops BELOW baseline. Only bet when they AGREE.

### 2.2 Consensus Scoring Algorithm

```typescript
interface ConsensusSignal {
  market_id: string;
  category: MarketCategory;

  // Consensus metrics
  elite_yes_count: number;     // Elite wallets betting YES
  elite_no_count: number;      // Elite wallets betting NO
  elite_total: number;         // Total elite participants

  // Derived
  is_unanimous: boolean;       // All on same side
  consensus_direction: 'YES' | 'NO' | 'SPLIT';
  consensus_strength: number;  // 0-1, higher = more aligned

  // Position sizing
  total_usd_yes: number;       // USD on YES side
  total_usd_no: number;        // USD on NO side

  // Confidence
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NO_SIGNAL';
}
```

**Confidence Levels:**
- `HIGH`: 5+ elite wallets, unanimous, category in [Crypto, Finance, Tech]
- `MEDIUM`: 3-4 elite wallets, unanimous, any category
- `LOW`: 3+ elite wallets, >75% agreement
- `NO_SIGNAL`: <3 elite wallets OR split opinion

### 2.3 Consensus Query

```sql
-- Real-time consensus detection for active markets
WITH elite_positions AS (
  SELECT
    p.condition_id,
    p.category,
    e.wallet_id,
    p.side,
    p.cost_usd,
    p.qty_shares_remaining,
    e.elite_score
  FROM wio_positions_v2 p
  JOIN wio_elite_wallets_v1 e
    ON p.wallet_id = e.wallet_id AND p.category = e.category
  WHERE e.is_elite = 1
    AND p.is_resolved = 0
    AND p.qty_shares_remaining > 0
)
SELECT
  condition_id,
  category,
  countIf(side = 'YES') as elite_yes_count,
  countIf(side = 'NO') as elite_no_count,
  count() as elite_total,
  sumIf(cost_usd, side = 'YES') as usd_yes,
  sumIf(cost_usd, side = 'NO') as usd_no,
  -- Consensus metrics
  (elite_yes_count = 0 OR elite_no_count = 0) as is_unanimous,
  if(elite_yes_count > elite_no_count, 'YES',
     if(elite_no_count > elite_yes_count, 'NO', 'SPLIT')) as consensus_direction,
  abs(elite_yes_count - elite_no_count) / elite_total as consensus_strength
FROM elite_positions
GROUP BY condition_id, category
HAVING elite_total >= 3
```

---

## Part 3: Smart Money Line Visualization

### 3.1 Color-Coded Flow Direction

**Current:** Single line showing SM odds (green)

**New Design:**
- **Cyan line** when `flow_24h > 0` (net buying)
- **Orange line** when `flow_24h < 0` (net selling)
- **Line thickness** proportional to `flow_24h / market_liquidity`
- **Opacity** based on confidence level

### 3.2 Flow States

```typescript
type FlowState = 'ACCUMULATING' | 'DISTRIBUTING' | 'HOLDING' | 'NO_POSITION';

function getFlowState(metrics: SmartMoneyMetrics): FlowState {
  const { flow_24h, total_usd, wallet_count } = metrics;

  if (wallet_count === 0 || total_usd < 1000) return 'NO_POSITION';

  const flowRatio = Math.abs(flow_24h) / total_usd;

  if (flow_24h > 0 && flowRatio > 0.1) return 'ACCUMULATING';
  if (flow_24h < 0 && flowRatio > 0.1) return 'DISTRIBUTING';
  return 'HOLDING';
}
```

### 3.3 Visual Indicators

| State | Color | Icon | Meaning |
|-------|-------|------|---------|
| ACCUMULATING | Cyan | ▲ | SM buying, building position |
| DISTRIBUTING | Orange | ▼ | SM selling, exiting position |
| HOLDING | Gray | ─ | SM stable, no significant flow |
| NO_POSITION | Dashed | ○ | Little/no SM activity |

---

## Part 4: Event-Level Aggregation

### 4.1 Multi-Market Event Handling

For events with multiple outcomes (e.g., "Who wins Super Bowl?"):

```typescript
interface EventPrediction {
  event_id: string;
  event_title: string;

  // Per-market SM scores
  markets: Array<{
    condition_id: string;
    question: string;
    sm_probability: number;      // Raw SM odds
    consensus_confidence: string; // HIGH/MEDIUM/LOW/NO_SIGNAL
    elite_count: number;
    is_unanimous: boolean;
  }>;

  // Event-level aggregation
  normalized_probabilities: Record<string, number>;  // Sum to 1.0
  predicted_winner: string;                          // Highest probability market
  prediction_confidence: string;                     // Based on consensus spread
}
```

### 4.2 Event Aggregation Algorithm

```typescript
function aggregateEventPrediction(markets: MarketSignal[]): EventPrediction {
  // Filter for markets with SM signal
  const marketsWithSignal = markets.filter(m => m.elite_count >= 2);

  // Normalize probabilities across event
  const rawProbs = marketsWithSignal.map(m => m.sm_probability);
  const sum = rawProbs.reduce((a, b) => a + b, 0);

  const normalized = marketsWithSignal.map(m => ({
    ...m,
    normalized_prob: m.sm_probability / sum
  }));

  // Find predicted winner
  const winner = normalized.reduce((a, b) =>
    a.normalized_prob > b.normalized_prob ? a : b
  );

  // Confidence based on margin
  const sorted = normalized.sort((a, b) => b.normalized_prob - a.normalized_prob);
  const margin = sorted[0].normalized_prob - (sorted[1]?.normalized_prob || 0);

  const confidence = margin > 0.3 ? 'HIGH' : margin > 0.15 ? 'MEDIUM' : 'LOW';

  return { normalized, predicted_winner: winner.condition_id, prediction_confidence: confidence };
}
```

### 4.3 Handling Correctness

For multi-outcome events, success criteria:
1. **Strict:** Predicted winner actually wins
2. **Partial:** Predicted winner finishes top 2
3. **ROI-based:** Betting our prediction at crowd price would profit

---

## Part 5: Edge Cases & Fallbacks

### 5.1 SM Disagreement Handling

When elite wallets disagree:

```typescript
interface DisagreementAnalysis {
  // Price point analysis
  yes_avg_entry: number;    // Avg entry price of YES bettors
  no_avg_entry: number;     // Avg entry price of NO bettors
  entry_spread: number;     // Difference in entry timing

  // Tier breakdown
  sf_direction: 'YES' | 'NO' | 'SPLIT';
  smart_direction: 'YES' | 'NO' | 'SPLIT';

  // Recommendation
  action: 'FOLLOW_SF' | 'NO_SIGNAL' | 'CAUTION';
}

function handleDisagreement(market: MarketAnalysis): DisagreementAnalysis {
  // If SFs agree but others don't, trust SFs
  if (market.sf_unanimous && !market.overall_unanimous) {
    return { action: 'FOLLOW_SF', ... };
  }

  // If everyone disagrees, no signal
  return { action: 'NO_SIGNAL', ... };
}
```

### 5.2 Velocity Signals

```typescript
interface VelocityMetrics {
  flow_24h: number;
  flow_48h: number;        // Need to compute
  flow_acceleration: number; // flow_24h - flow_48h

  wallet_count_change_24h: number;
  new_elite_wallets_24h: number;

  // Velocity signals
  is_accelerating: boolean;  // flow_acceleration > 0
  is_decelerating: boolean;  // flow_acceleration < 0
  has_new_elite: boolean;    // new_elite_wallets_24h > 0
}
```

**Velocity Signal Enhancement:**
- `ACCELERATING + UNANIMOUS`: Boost confidence
- `DECELERATING + UNANIMOUS`: Reduce confidence
- `NEW_ELITE_ENTRY`: High confidence (fresh information)

### 5.3 No/Little SM Data Fallback

```typescript
function getEffectiveOdds(market: MarketState): number {
  const { elite_count, total_usd, sm_odds, crowd_price } = market;

  // No SM data: use crowd
  if (elite_count === 0 || total_usd < 1000) {
    return crowd_price;
  }

  // Sparse SM data: weighted blend
  if (elite_count < 3 || total_usd < 10000) {
    const smWeight = Math.min(elite_count / 5, total_usd / 20000, 1);
    return sm_odds * smWeight + crowd_price * (1 - smWeight);
  }

  // Sufficient SM data: use SM odds
  return sm_odds;
}
```

---

## Part 6: Sell Pressure Detection

### 6.1 Exit Signal Detection

```typescript
interface ExitSignal {
  market_id: string;

  // Exit metrics
  wallets_exited_24h: number;
  usd_exited_24h: number;
  exit_vs_entry_ratio: number;   // exits / entries in 24h

  // Elite-specific
  elite_exits_24h: number;
  elite_remaining: number;

  // Signal
  is_mass_exit: boolean;         // >30% of position exited
  is_elite_exit: boolean;        // Elite specifically exiting
}

function detectSellPressure(current: Snapshot, prev: Snapshot): ExitSignal {
  const usdChange = current.total_usd - prev.total_usd;
  const walletChange = current.wallet_count - prev.wallet_count;

  return {
    is_mass_exit: usdChange < -0.3 * prev.total_usd,
    is_elite_exit: current.elite_count < prev.elite_count,
    // ...
  };
}
```

### 6.2 Exit Signal Actions

| Signal | Action |
|--------|--------|
| Elite exit, others holding | Warning, reduce confidence |
| Mass exit (all tiers) | Strong warning, consider fade |
| Elite entry, others exit | Maintain/increase confidence |

---

## Part 7: TDD Validation Framework

### 7.1 Benchmark Tests

```typescript
describe('Prediction Engine V2', () => {
  describe('Crowd Benchmark', () => {
    it('should beat crowd accuracy at 4h by 5%', async () => {
      const results = await backtest({
        timeframe: '4h',
        signal_type: 'unanimous_consensus'
      });
      expect(results.accuracy).toBeGreaterThan(0.623); // 57.3% + 5%
    });

    it('should beat crowd accuracy at 7d by 6%', async () => {
      const results = await backtest({
        timeframe: '7d',
        signal_type: 'unanimous_consensus'
      });
      expect(results.accuracy).toBeGreaterThan(0.677); // 61.7% + 6%
    });
  });

  describe('Unanimous Consensus', () => {
    it('should achieve 80%+ accuracy when 5+ SFs unanimous on Crypto', async () => {
      const results = await backtest({
        category: 'Crypto',
        min_elite: 5,
        unanimous: true
      });
      expect(results.accuracy).toBeGreaterThan(0.80);
    });
  });

  describe('Fallback Logic', () => {
    it('should use crowd price when elite_count < 3', async () => {
      const odds = getEffectiveOdds({ elite_count: 2, total_usd: 500 });
      expect(odds).toBe(market.crowd_price);
    });
  });
});
```

### 7.2 Continuous Validation

```sql
-- Daily validation query
SELECT
  toDate(ts_resolve) as date,
  category,
  -- Our signal accuracy
  avgIf(correct, has_unanimous_signal) as signal_accuracy,
  -- Crowd baseline
  avgIf(crowd_correct, has_unanimous_signal) as crowd_accuracy_same_markets,
  -- Our edge
  signal_accuracy - crowd_accuracy_same_markets as edge
FROM validation_results
WHERE date >= today() - 30
GROUP BY date, category
ORDER BY date DESC
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1)
1. Create `wio_elite_wallets_v1` table
2. Add consensus detection to API
3. Update chart visualization with flow colors

### Phase 2: Event Aggregation (Week 2)
1. Implement event-level prediction aggregation
2. Add multi-market consensus view
3. Create event prediction API

### Phase 3: Edge Cases (Week 3)
1. Implement disagreement handling
2. Add velocity signals
3. Build fallback logic

### Phase 4: Validation (Week 4)
1. Set up continuous validation pipeline
2. Implement TDD test suite
3. Create performance dashboard

---

## API Endpoints (New/Updated)

### GET /api/smart-money/consensus/{condition_id}
```json
{
  "market_id": "abc123...",
  "consensus": {
    "direction": "YES",
    "is_unanimous": true,
    "elite_count": 7,
    "confidence": "HIGH",
    "expected_accuracy": 0.85
  },
  "flow": {
    "state": "ACCUMULATING",
    "24h_change_usd": 15000,
    "24h_change_pct": 0.12
  }
}
```

### GET /api/events/{event_id}/prediction
```json
{
  "event_id": "12345",
  "title": "Super Bowl Winner",
  "markets": [...],
  "prediction": {
    "winner": "Kansas City Chiefs",
    "probability": 0.42,
    "confidence": "MEDIUM",
    "consensus_count": 12
  }
}
```

---

## Key Metrics to Track

| Metric | Target | Current |
|--------|--------|---------|
| Unanimous signal accuracy (Crypto) | 85% | TBD |
| Unanimous signal accuracy (Tech) | 75% | TBD |
| Edge over crowd (all signals) | +8% | TBD |
| False positive rate | <20% | TBD |
| Coverage (markets with signal) | 30% | TBD |

---

*Document created: January 14, 2026*
*Based on analysis of 60M+ positions, 1.6M snapshots, 65K resolved markets*
