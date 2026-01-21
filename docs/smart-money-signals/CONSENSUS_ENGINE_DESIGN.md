# Consensus Engine Design

> **Status:** Design Phase
> **Key Change:** Pure consensus (wallet count), NOT USD-weighted
> **Granularity:** Hourly snapshots

---

## Core Principle: One Wallet = One Vote

**Remove all USD weighting.** The signal is in WHO bets, not HOW MUCH.

Why:
1. "Eggman" betting $5K in a niche market = same signal as whale betting $100K
2. Information is in the decision, not the capital
3. Avoids whale manipulation (can't game by betting big)
4. Aligns with data finding: unanimous CONSENSUS is the key signal

---

## Schema Changes: `wio_smart_money_metrics_v2`

### New Columns (Add to existing table)

```sql
-- Add consensus count columns
ALTER TABLE wio_smart_money_metrics_v2
ADD COLUMN sf_yes_count UInt16 DEFAULT 0,
ADD COLUMN sf_no_count UInt16 DEFAULT 0,
ADD COLUMN smart_yes_count UInt16 DEFAULT 0,
ADD COLUMN smart_no_count UInt16 DEFAULT 0;

-- Computed at query time (or materialized):
-- elite_yes = sf_yes_count + smart_yes_count
-- elite_no = sf_no_count + smart_no_count
-- elite_total = elite_yes + elite_no
-- is_unanimous = (elite_yes = 0 OR elite_no = 0) AND elite_total > 0
-- consensus = CASE WHEN elite_yes > 0 AND elite_no = 0 THEN 'UNANIMOUS_YES'
--                  WHEN elite_no > 0 AND elite_yes = 0 THEN 'UNANIMOUS_NO'
--                  WHEN elite_total > 0 THEN 'DIVIDED'
--                  ELSE 'NONE' END
```

### Why NOT Add Computed Columns

ClickHouse doesn't support computed columns. Options:
1. **Compute at query time** (recommended) - expressions are cheap
2. **Store redundantly** - wastes space
3. **Materialized view** - adds complexity

**Decision:** Compute `is_unanimous`, `consensus_direction`, `elite_total` at query time.

---

## Hourly Snapshot Computation

### In Rebuild Script

The existing `backfill-smart-money-sql.ts` already processes positions per hour.
Add to the INSERT SELECT:

```sql
-- Add to the SELECT statement
-- Superforecaster counts (active at this hour)
uniqExactIf(p.wallet_id,
  p.tier = 'superforecaster' AND p.side = 'YES'
  AND p.ts_open <= hp.hour AND (p.ts_close IS NULL OR p.ts_close > hp.hour)
) as sf_yes_count,

uniqExactIf(p.wallet_id,
  p.tier = 'superforecaster' AND p.side = 'NO'
  AND p.ts_open <= hp.hour AND (p.ts_close IS NULL OR p.ts_close > hp.hour)
) as sf_no_count,

-- Smart counts
uniqExactIf(p.wallet_id,
  p.tier = 'smart' AND p.side = 'YES'
  AND p.ts_open <= hp.hour AND (p.ts_close IS NULL OR p.ts_close > hp.hour)
) as smart_yes_count,

uniqExactIf(p.wallet_id,
  p.tier = 'smart' AND p.side = 'NO'
  AND p.ts_open <= hp.hour AND (p.ts_close IS NULL OR p.ts_close > hp.hour)
) as smart_no_count
```

### Why This is Fast

1. **Batched:** Processes many markets in one query
2. **Index-friendly:** Uses `ts_open`, `ts_close` which are indexed
3. **Memory-efficient:** `uniqExact` is streaming, doesn't load all wallets
4. **Pre-joined:** Tier info comes from the same position row (joined once)

---

## Consensus Detection Logic

### At Query Time

```sql
SELECT
  market_id,
  ts,
  crowd_price,
  smart_money_odds,

  -- Raw counts
  sf_yes_count,
  sf_no_count,
  smart_yes_count,
  smart_no_count,

  -- Computed: Elite totals
  sf_yes_count + smart_yes_count as elite_yes,
  sf_no_count + smart_no_count as elite_no,
  elite_yes + elite_no as elite_total,

  -- Computed: Consensus
  if(elite_yes > 0 AND elite_no = 0, 'UNANIMOUS_YES',
     if(elite_no > 0 AND elite_yes = 0, 'UNANIMOUS_NO',
        if(elite_total > 0, 'DIVIDED', 'NONE'))) as consensus,

  -- Computed: Alignment (for gradient)
  if(elite_total > 0, abs(elite_yes - elite_no) / elite_total, 0) as alignment,

  -- Signal conditions
  (elite_total >= 3 AND elite_yes > 0 AND elite_no = 0) as has_unanimous_yes_signal,
  (elite_total >= 3 AND elite_no > 0 AND elite_yes = 0) as has_unanimous_no_signal

FROM wio_smart_money_metrics_v2
WHERE market_id = 'xxx'
ORDER BY ts
```

### Confidence Levels

Based on data analysis:

| Elite Count | Unanimous | Category | Confidence | Historical Accuracy |
|-------------|-----------|----------|------------|-------------------|
| 5+ | Yes | Crypto | HIGH | 85% |
| 5+ | Yes | Finance | HIGH | 76% |
| 5+ | Yes | Tech | HIGH | 74% |
| 3-4 | Yes | Any | MEDIUM | ~70% |
| 3+ | No (Divided) | Any | NO_SIGNAL | ~50% (noise) |
| <3 | Any | Any | INSUFFICIENT | n/a |

---

## API Response Changes

### GET /api/markets/{condition_id}/smart-money-signals

```typescript
interface SmartMoneySignalPoint {
  timestamp: number;
  crowd_odds: number;
  smart_money_odds: number;
  divergence: number;

  // Consensus (NEW - pure counts, no USD)
  sf_yes_count: number;
  sf_no_count: number;
  smart_yes_count: number;
  smart_no_count: number;
  elite_total: number;
  consensus: 'UNANIMOUS_YES' | 'UNANIMOUS_NO' | 'DIVIDED' | 'NONE';
  alignment: number;  // 0-1, how aligned

  // Signal
  signal_type: string | null;
  signal_action: 'BET_YES' | 'BET_NO' | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | null;

  // DEPRECATED (still returned for backwards compat)
  wallet_count: number;  // total (all tiers)
  total_usd: number;     // total USD (informational only)
}
```

### GET /api/markets/{condition_id}/consensus-history

New endpoint for consensus evolution chart:

```typescript
interface ConsensusHistoryResponse {
  market_id: string;
  history: Array<{
    timestamp: number;
    elite_yes: number;
    elite_no: number;
    consensus: 'UNANIMOUS_YES' | 'UNANIMOUS_NO' | 'DIVIDED' | 'NONE';
    // For change detection
    consensus_changed: boolean;  // Different from previous hour
    new_elite_entries: number;   // Net new elite wallets this hour
  }>;
  current_consensus: {
    direction: 'YES' | 'NO' | null;
    is_unanimous: boolean;
    elite_count: number;
    confidence: string;
    hours_at_consensus: number;  // How long current consensus held
  };
}
```

---

## Visualization Changes

### Chart Line Colors

Based on consensus state, NOT flow direction:

| Consensus | Line Color | Meaning |
|-----------|------------|---------|
| UNANIMOUS_YES | Bright Green (#22c55e) | Elite agrees: YES |
| UNANIMOUS_NO | Bright Red (#ef4444) | Elite agrees: NO |
| DIVIDED | Amber (#f59e0b) | Elite split |
| NONE | Gray (#9ca3af) | No elite data |

### Line Styling

```typescript
const lineStyle = {
  UNANIMOUS_YES: { color: '#22c55e', width: 3, type: 'solid' },
  UNANIMOUS_NO: { color: '#ef4444', width: 3, type: 'solid' },
  DIVIDED: { color: '#f59e0b', width: 2, type: 'dashed' },
  NONE: { color: '#9ca3af', width: 1, type: 'dotted' },
};
```

### Signal Markers

When consensus CHANGES (e.g., goes from DIVIDED to UNANIMOUS):

```typescript
const consensusChangeMarkers = history
  .filter((p, i) => i > 0 && p.consensus !== history[i-1].consensus)
  .map(p => ({
    timestamp: p.timestamp,
    type: p.consensus,
    // Only mark significant changes
    isSignificant: p.consensus.startsWith('UNANIMOUS') && p.elite_total >= 3,
  }));
```

---

## Velocity & Entry Detection

### New Elite Entry Signal

When a new elite wallet enters a market:

```sql
-- Detect new elite entries per hour
SELECT
  market_id,
  ts,
  elite_yes - lagInFrame(elite_yes) OVER (PARTITION BY market_id ORDER BY ts) as new_yes,
  elite_no - lagInFrame(elite_no) OVER (PARTITION BY market_id ORDER BY ts) as new_no,
  new_yes + new_no as net_new_elite
FROM consensus_metrics
```

**Signal enhancement:**
- New elite enters UNANIMOUS side → Increases confidence
- New elite enters OPPOSITE side → Breaks unanimity, reduces confidence
- Multiple new elites same hour → Strong signal (coordinated entry)

### Consensus Velocity

Track how fast consensus is building or breaking:

```typescript
interface ConsensusVelocity {
  // Change in elite alignment over time
  alignment_1h_ago: number;
  alignment_now: number;
  alignment_delta: number;  // + = strengthening, - = weakening

  // Is consensus building or fracturing?
  trend: 'BUILDING' | 'STABLE' | 'FRACTURING';
}
```

---

## Fallback Logic (When No/Little Elite Data)

### Decision Tree

```
IF elite_total >= 5 AND is_unanimous:
  → Use SM signal (HIGH confidence)

ELIF elite_total >= 3 AND is_unanimous:
  → Use SM signal (MEDIUM confidence)

ELIF elite_total >= 3 AND alignment > 0.66:
  → Use SM signal (LOW confidence) - strong majority

ELIF elite_total > 0:
  → No signal (DIVIDED or insufficient)
  → Display: "Elite wallets disagree" or "Insufficient elite data"

ELSE:
  → Fallback to crowd
  → Display: "No elite activity - showing crowd consensus"
```

### UI Treatment

```typescript
const getDisplayMode = (snapshot: ConsensusSnapshot) => {
  if (snapshot.elite_total >= 3 && snapshot.is_unanimous) {
    return {
      primary: 'ELITE_CONSENSUS',
      showSmLine: true,
      lineStyle: snapshot.consensus === 'UNANIMOUS_YES' ? 'green' : 'red',
      confidence: snapshot.elite_total >= 5 ? 'HIGH' : 'MEDIUM',
    };
  }

  if (snapshot.elite_total > 0) {
    return {
      primary: 'ELITE_DIVIDED',
      showSmLine: true,
      lineStyle: 'amber-dashed',
      confidence: 'LOW',
      message: `Elite split: ${snapshot.elite_yes} YES, ${snapshot.elite_no} NO`,
    };
  }

  return {
    primary: 'CROWD_ONLY',
    showSmLine: false,
    message: 'No elite activity',
  };
};
```

---

## Implementation Phases

### Phase 1: Schema & Backfill (Day 1-2)
1. Add `sf_yes_count`, `sf_no_count`, `smart_yes_count`, `smart_no_count` columns
2. Update `backfill-smart-money-sql.ts` to compute counts
3. Run backfill for active markets first, then resolved

### Phase 2: API Updates (Day 3)
1. Update `/api/markets/[condition_id]/smart-money-signals` to return consensus fields
2. Add new `/api/markets/[condition_id]/consensus-history` endpoint
3. Deprecate (but keep) USD-based fields

### Phase 3: Visualization (Day 4-5)
1. Update chart line colors based on consensus
2. Add consensus change markers
3. Update signal detection UI

### Phase 4: Validation (Day 6)
1. Run accuracy tests on unanimous consensus signals
2. Compare to baseline (crowd accuracy)
3. Adjust confidence thresholds if needed

---

## Validation Queries

### Test: Unanimous Consensus Accuracy

```sql
WITH consensus AS (
  SELECT
    market_id,
    ts,
    category,
    outcome_resolved,
    sf_yes_count + smart_yes_count as elite_yes,
    sf_no_count + smart_no_count as elite_no,
    elite_yes + elite_no as elite_total,
    (elite_yes > 0 AND elite_no = 0) as is_unanimous_yes,
    (elite_no > 0 AND elite_yes = 0) as is_unanimous_no
  FROM wio_smart_money_metrics_v2
  WHERE is_resolved = 1 AND outcome_resolved IN (0, 1)
    AND dateDiff('day', ts, end_date) BETWEEN 5 AND 14
)
SELECT
  category,
  CASE
    WHEN elite_total >= 5 THEN '5+ elite'
    WHEN elite_total >= 3 THEN '3-4 elite'
    ELSE '<3 elite'
  END as elite_bucket,
  countIf(is_unanimous_yes OR is_unanimous_no) as unanimous_markets,
  avgIf(
    if((is_unanimous_yes AND outcome_resolved = 1) OR
       (is_unanimous_no AND outcome_resolved = 0), 1, 0),
    is_unanimous_yes OR is_unanimous_no
  ) * 100 as unanimous_accuracy
FROM consensus
GROUP BY category, elite_bucket
HAVING unanimous_markets >= 50
ORDER BY category, unanimous_accuracy DESC
```

### Expected Results (Based on Earlier Analysis)

| Category | 5+ Elite Unanimous | 3-4 Elite Unanimous |
|----------|-------------------|---------------------|
| Crypto | 85%+ | 75%+ |
| Finance | 76%+ | 65%+ |
| Tech | 74%+ | 68%+ |
| Other | 55%+ | 50%+ |

---

*Document created: January 14, 2026*
*Supersedes USD-weighted approach in PREDICTION_ENGINE_V2_DESIGN.md*
