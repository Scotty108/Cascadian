# Wallet Intelligence Scoring System

## Overview

The Wallet Intelligence Scoring System evaluates prediction market traders on a category-by-category basis, identifying specialists and experts in specific domains like Politics, Economics, Commodities, Crypto, Sports, etc.

## Architecture

The system is designed to be **modular** and **configurable**, with three core components:

### 1. `scoring-config.ts` - Configuration Layer
All scoring parameters are defined here. **This is where you tweak the system.**

- **Category Configurations**: Keywords, difficulty multipliers, custom thresholds
- **Metric Thresholds**: What constitutes "excellent", "good", "fair" performance
- **Scoring Weights**: How much each metric (win rate, ROI, Sharpe) contributes
- **Adjustment Factors**: Recency decay, sample size requirements, consistency bonuses

### 2. `scoring-engine.ts` - Core Logic
The engine that calculates scores using the configuration. **Don't modify unless changing core algorithms.**

- Smart component scoring with piecewise linear functions
- Recency weighting (exponential decay)
- Consistency bonus calculations
- Sample size confidence adjustments
- Difficulty multiplier application

### 3. `wallet-scoring.ts` - Public API
The interface that components use to get scores. **This is what your UI calls.**

- `calculateCategoryScore()` - Get scores for all categories
- `calculateWalletScore()` - Get overall wallet rating
- `categorizeMarket()` - Classify markets by category

---

## How Scoring Works

### Step-by-Step Process

```
1. Categorize markets → Politics, Economics, Commodities, etc.
2. Calculate base metrics → Win Rate, ROI, Sharpe Ratio
3. Apply category thresholds → Different expectations per category
4. Weight metrics → 35% Win Rate + 35% ROI + 30% Sharpe
5. Add consistency bonus → Up to 5 points for low volatility
6. Apply sample size penalty → Fewer trades = lower confidence
7. Apply difficulty multiplier → Harder categories get bonus
8. Final score (0-100) → Convert to letter grade (S/A/B/C/D/F)
```

### Scoring Formula

```typescript
// Base Score (0-100)
baseScore = (winRateScore × 0.35) + (roiScore × 0.35) + (sharpeScore × 0.30)

// Add Consistency Bonus (0-5 points)
withBonus = baseScore + consistencyBonus

// Apply Sample Size Factor (0.2-1.0)
withSampleSize = withBonus × sampleSizeFactor

// Apply Difficulty Multiplier (0.9-1.4)
finalScore = withSampleSize × difficultyMultiplier
```

---

## Configuration Guide

### Category Difficulty Multipliers

Different categories have different difficulty levels:

| Category | Multiplier | Reasoning |
|----------|-----------|-----------|
| **Global Events** | 1.40 | Geopolitics is extremely complex |
| **Sports** | 1.30 | High unpredictability |
| **Crypto** | 1.25 | Extreme volatility |
| **Pop Culture** | 1.20 | Trend-based, hard to predict |
| **Economics** | 1.15 | Requires deep expertise |
| **Science & Tech** | 1.15 | Technical knowledge required |
| **Politics** | 1.10 | Polls can be misleading |
| **Commodities** | 1.05 | Data-driven but volatile |
| **Other** | 1.00 | Baseline |

**Example**: A trader with 80/100 in Crypto (1.25×) is more impressive than 80/100 in Commodities (1.05×).

### Metric Thresholds

**Default Thresholds** (can be overridden per category):

```typescript
winRate: {
  excellent: 0.80,  // 80%+ win rate
  good: 0.65,       // 65-80%
  fair: 0.50        // 50-65%
}

roi: {
  excellent: 0.40,  // 40%+ ROI
  good: 0.20,       // 20-40%
  fair: 0.10        // 10-20%
}

sharpe: {
  excellent: 2.0,   // Excellent risk-adjusted returns
  good: 1.5,        // Very good
  fair: 1.0         // Good
}
```

**Category-Specific Overrides**:

```typescript
// Sports has lower win rate expectations
'Sports': {
  thresholds: {
    winRate: {
      excellent: 0.70,  // 70% is excellent in sports
      good: 0.58,
      fair: 0.48
    }
  }
}

// Crypto has lower Sharpe expectations
'Crypto': {
  thresholds: {
    sharpe: {
      excellent: 1.5,   // Lower due to volatility
      good: 1.0,
      fair: 0.7
    }
  }
}
```

### Scoring Weights

Control how much each metric matters:

```typescript
SCORING_WEIGHTS = {
  winRate: 0.35,     // 35% - Winning consistently
  roi: 0.35,         // 35% - Profitability
  sharpe: 0.30,      // 30% - Risk-adjusted returns

  recencyDecay: 0.95,           // 5% decay per 30 days
  minTradesForFullWeight: 10,   // Need 10+ trades for full confidence
  consistencyBonus: 5           // Up to 5 bonus points
}
```

**Want to emphasize profitability more?**
```typescript
winRate: 0.30,
roi: 0.45,     // Increased from 0.35
sharpe: 0.25
```

**Want to penalize old performance more?**
```typescript
recencyDecay: 0.90  // 10% decay per 30 days (was 0.95)
```

### Recency Weighting

Recent trades matter more than old trades. Uses exponential decay:

```typescript
weight = decayRate ^ (daysSinceTradeHuman: / 30)
```

**Examples** (with default 0.95 decay rate):
- Trade today: 100% weight
- Trade 30 days ago: 95% weight
- Trade 90 days ago: 86% weight
- Trade 180 days ago: 74% weight
- Trade 1 year ago: 54% weight

### Sample Size Penalty

Fewer trades = less confidence in score:

| Trades | Confidence Factor | Effect |
|--------|------------------|--------|
| 1 trade | 20% | Score × 0.2 |
| 2 trades | 35% | Score × 0.35 |
| 5 trades | 65% | Score × 0.65 |
| 10 trades | 100% | Score × 1.0 |
| 20+ trades | 100% | Score × 1.0 |

**Example**: A trader with 90/100 raw score but only 3 trades gets:
```
90 × 0.50 (sample size factor) = 45 final score
```

### Consistency Bonus

Rewards traders who are consistently profitable (up to 5 points):

- **High consistency**: Steady returns, low volatility → +5 points
- **Medium consistency**: Some volatility → +2-3 points
- **Low consistency**: Boom-or-bust trader → +0 points

Calculated using **Coefficient of Variation** (CV = std dev / mean):
- CV < 0.5 → Full bonus (5 points)
- CV 0.5-2.0 → Partial bonus (0-5 points)
- CV > 2.0 → No bonus

---

## Grade System

| Grade | Score Range | Meaning |
|-------|------------|---------|
| **S** | 90-100 | Elite performance |
| **A** | 80-89 | Excellent |
| **B** | 70-79 | Good |
| **C** | 60-69 | Fair |
| **D** | 50-59 | Below average |
| **F** | 0-49 | Poor |
| **N/A** | 0 trades | No data |

## Specialization Levels

| Level | Requirements | Description |
|-------|-------------|-------------|
| **Expert** | 85+ score, 10+ trades | Master of the category |
| **Advanced** | 70+ score, 5+ trades | Highly skilled |
| **Intermediate** | 55+ score, 3+ trades | Competent trader |
| **Novice** | Any score, 1+ trades | Learning |
| **None** | 0 trades | No experience |

---

## How to Adjust the System

### Making a Category Easier/Harder

**Example**: Make Economics easier (currently 1.15×)

```typescript
// In scoring-config.ts
'Economics': {
  // ...
  difficultyMultiplier: 1.05,  // Changed from 1.15
}
```

### Changing Win Rate Standards

**Example**: Lower Sports win rate expectations even more

```typescript
'Sports': {
  // ...
  thresholds: {
    winRate: {
      excellent: 0.65,  // Changed from 0.70
      good: 0.53,       // Changed from 0.58
      fair: 0.43        // Changed from 0.48
    }
  }
}
```

### Adding a New Category

```typescript
'eSports': {
  name: 'eSports',
  keywords: ['league of legends', 'dota', 'valorant', 'esports', 'gaming'],
  difficultyMultiplier: 1.25,  // Very unpredictable
  description: 'Competitive video gaming predictions',
  thresholds: {
    winRate: {
      excellent: 0.68,
      good: 0.55,
      fair: 0.45
    }
  }
}
```

### Emphasizing Recent Performance

**Example**: Make old trades decay faster

```typescript
SCORING_WEIGHTS: {
  // ...
  recencyDecay: 0.90,  // Changed from 0.95 (10% decay per month)
}
```

### Requiring More Trades for Full Confidence

```typescript
SCORING_WEIGHTS: {
  // ...
  minTradesForFullWeight: 20,  // Changed from 10
}
```

---

## Examples

### Example 1: "Egg Man" (XCN Strategy)

**Profile**:
- 84% win rate
- $80K profit from egg markets
- 15 trades in Commodities
- Recent trades (last 60 days)

**Scoring**:
```
Win Rate: 84% → 95/100 (excellent)
ROI: 120% → 100/100 (excellent)
Sharpe: 2.3 → 95/100 (excellent)

Base Score: (95×0.35) + (100×0.35) + (95×0.30) = 96.75
Consistency Bonus: +4 (very consistent)
Raw Score: 100.75 (capped at 100)

Sample Size Factor: 1.0 (15 trades)
Difficulty Multiplier: 1.05 (Commodities)

Final Score: 100 × 1.0 × 1.05 = 100 (capped)
Grade: S
Specialization: Expert
```

### Example 2: Novice Crypto Trader

**Profile**:
- 55% win rate
- 8% ROI
- 3 trades in Crypto
- 2 trades were recent

**Scoring**:
```
Win Rate: 55% → 52/100 (below good)
ROI: 8% → 45/100 (below fair)
Sharpe: 0.6 → 42/100 (below fair)

Base Score: (52×0.35) + (45×0.35) + (42×0.30) = 46.55
Consistency Bonus: +0 (too few trades)
Raw Score: 46.55

Sample Size Factor: 0.50 (only 3 trades)
Difficulty Multiplier: 1.25 (Crypto is hard)

Final Score: 46.55 × 0.50 × 1.25 = 29
Grade: F
Specialization: Novice
```

---

## Testing & Validation

### Enable Debug Mode

```typescript
// In your component
const scores = calculateCategoryScore(closedPositions, true) // includeBreakdown = true

// Check breakdown
scores.forEach(score => {
  console.log(score.category, score.breakdown)
  // {
  //   winRateScore: 85,
  //   roiScore: 92,
  //   sharpeScore: 78,
  //   consistencyBonus: 3.5,
  //   sampleSizeFactor: 0.85,
  //   difficultyMultiplier: 1.15,
  //   rawScore: 88,
  //   adjustedScore: 87
  // }
})
```

### Key Metrics to Watch

- **Score Distribution**: Most wallets should be 40-70 range
- **Expert Count**: <5% of wallets should be Experts
- **Grade Distribution**: Should resemble normal curve
- **Category Balance**: All categories should have some A/B grades

---

## Future Enhancements

Ideas for making the system even smarter:

1. **Market Liquidity Adjustment**: Harder to trade low-liquidity markets
2. **Time-to-Resolution Bonus**: Predicting outcomes far in advance is harder
3. **Contrarian Bonus**: Trading against crowd sentiment
4. **Streak Detection**: Hot/cold streak identification
5. **Peer Comparison**: Score relative to other traders in category
6. **Meta-Learning**: Adjust thresholds based on actual performance data

---

## Quick Reference

### File Structure
```
lib/
├── scoring-config.ts     # ← TWEAK PARAMETERS HERE
├── scoring-engine.ts     # Core algorithm (don't modify)
├── wallet-scoring.ts     # Public API
└── SCORING_SYSTEM.md    # This file
```

### Most Common Tweaks

**1. Make category harder/easier**
```typescript
difficultyMultiplier: 1.2  // Adjust this number
```

**2. Change what "good" means**
```typescript
thresholds: {
  winRate: { excellent: 0.80, good: 0.65, fair: 0.50 }
}
```

**3. Emphasize different metrics**
```typescript
winRate: 0.40,  // More important
roi: 0.35,
sharpe: 0.25    // Less important
```

**4. Require more trades**
```typescript
minTradesForFullWeight: 20  // Need 20 trades now
```

---

## Questions?

See the inline comments in `scoring-config.ts` for more details on each parameter.
