# OWRR: Omega-Weighted Risk Ratio

**The Smart Money Signal for Prediction Markets**

## What Is OWRR?

OWRR (Omega-Weighted Risk Ratio) is a single metric that answers: **"Which side of this market do the skilled traders favor?"**

It analyzes the top 20 wallet holders on each side (YES vs NO) and compares their:
1. **Skill** (historical Omega ratio in this category)
2. **Commitment** (money at risk on this position)

## The Formula

### Per-Wallet Voice

```
voice = Omega_category × sqrt(money_at_risk)

where:
  Omega_category = Historical gains/losses ratio in this category
  money_at_risk = Amount they'll lose if this side is wrong
```

### Market OWRR

```
S_YES = sum of all YES wallet voices
S_NO = sum of all NO wallet voices

OWRR = S_YES / (S_YES + S_NO)

Slider = round(100 × OWRR)
```

## Filters Applied

**Only qualified wallets count:**
- Must have 10+ resolved trades in the market's category
- Omega capped at [0.1, 5.0] range (prevents extreme outliers)

**Example:**
- Top 20 YES wallets: 16 have 10+ Politics trades → 16 qualify
- Top 20 NO wallets: 14 have 10+ Politics trades → 14 qualify

## Reading the Signal

### Slider Values

| Slider | OWRR | Interpretation |
|--------|------|----------------|
| 0-40 | 0-0.4 | Strong NO (smart money on NO) |
| 40-45 | 0.4-0.45 | Lean NO |
| 45-55 | 0.45-0.55 | Neutral (split) |
| 55-60 | 0.55-0.6 | Lean YES |
| 60-100 | 0.6-1.0 | Strong YES (smart money on YES) |

### Confidence Levels

| Qualified Wallets | Confidence |
|-------------------|------------|
| 20+ total | High |
| 12-19 total | Medium |
| 6-11 total | Low |
| <6 total | Insufficient data |

## Example Output

```json
{
  "owrr": 0.68,
  "slider": 68,
  "yes_score": 4250.5,
  "no_score": 2010.2,
  "yes_qualified": 16,
  "no_qualified": 14,
  "yes_avg_omega": 2.1,
  "no_avg_omega": 1.4,
  "yes_avg_risk": 12500,
  "no_avg_risk": 8200,
  "category": "Politics",
  "confidence": "high"
}
```

**Interpretation:**
- Slider: 68/100 → Strong YES signal
- YES wallets have avg Omega 2.1 (good)
- NO wallets have avg Omega 1.4 (mediocre)
- 30 total qualified wallets → High confidence
- **Conclusion: Smart money favors YES**

## Why This Works

### 1. Omega Captures True Skill

Omega ratio = Total gains / Total losses

**Why it's better than win rate:**
- Win rate: 60% wins doesn't tell you profit
- Omega 2.5: For every $1 lost, they gain $2.50
- Captures both frequency AND magnitude of wins

**Example:**
- Wallet A: 65% win rate, avg win $500, avg loss $800
  - Omega = (0.65 × $500) / (0.35 × $800) = 1.16 (barely profitable)
- Wallet B: 55% win rate, avg win $1000, avg loss $400
  - Omega = (0.55 × $1000) / (0.45 × $400) = 3.06 (highly profitable)
- **Wallet B is way better despite lower win rate!**

### 2. Category-Specific Matters

A wallet with:
- Crypto: 80 trades, Omega 3.2 (expert)
- Politics: 12 trades, Omega 0.8 (terrible)

Should NOT get voice from their Crypto skill on a Politics market.

**OWRR uses category-specific Omega only.**

### 3. sqrt(money) Prevents Whale Domination

Linear money weighting:
- $100k bet = 10x voice of $10k bet
- One whale overpowers 9 skilled traders

sqrt dampening:
- $100k bet = sqrt(100k) = 316
- $10k bet = sqrt(10k) = 100
- Ratio: 3.16x (not 10x)
- **Whales get more voice, but don't dominate**

### 4. 10-Trade Filter Removes Luck

Without filter:
- Wallet with 3 lucky wins: Omega = ∞
- Gets infinite voice
- Breaks the metric

With filter:
- Need 10+ resolved trades in category
- Filters out lucky gamblers
- Only proven traders count

## API Usage

### Endpoint

```
GET /api/markets/[marketId]/owrr
```

### Query Parameters

- `breakdown=true` - Include individual wallet votes (optional)

### Response

```typescript
{
  "success": true,
  "data": {
    "owrr": number,              // 0-1 scale
    "slider": number,            // 0-100 scale
    "yes_score": number,         // Total YES voice
    "no_score": number,          // Total NO voice
    "yes_qualified": number,     // Qualified YES wallets
    "no_qualified": number,      // Qualified NO wallets
    "yes_avg_omega": number,     // Average Omega on YES
    "no_avg_omega": number,      // Average Omega on NO
    "yes_avg_risk": number,      // Average $ at risk on YES
    "no_avg_risk": number,       // Average $ at risk on NO
    "category": string,          // Market category
    "confidence": "high" | "medium" | "low" | "insufficient_data",

    // If breakdown=true:
    "breakdown": {
      "yes_votes": [...],        // Individual wallet votes
      "no_votes": [...]
    }
  }
}
```

### Example Request

```bash
curl https://cascadian.com/api/markets/0x123abc.../owrr
```

### Example Response

```json
{
  "success": true,
  "data": {
    "owrr": 0.72,
    "slider": 72,
    "yes_score": 5840.3,
    "no_score": 2280.1,
    "yes_qualified": 18,
    "no_qualified": 15,
    "yes_avg_omega": 2.3,
    "no_avg_omega": 1.5,
    "yes_avg_risk": 15200,
    "no_avg_risk": 9500,
    "category": "Tech",
    "confidence": "high"
  }
}
```

## Implementation Details

### Data Requirements

**Tables Used:**
1. `wallet_metrics_by_category` - For Omega and trade counts
2. `trades_raw` - For current open positions
3. `markets_dim` - For market info
4. `events_dim` - For category mapping

### Caching

- Results cached for 5 minutes
- Cache key: `marketId:includeBreakdown`
- Automatic cleanup every 10 minutes

### Performance

- Query time: ~100-300ms
- Scales to any number of markets
- Top 20 wallets per side = max 40 queries

## Edge Cases Handled

### Not Enough Qualified Wallets

If <3 qualified wallets on either side:
```json
{
  "owrr": 0.5,
  "slider": 50,
  "confidence": "insufficient_data",
  "message": "Not enough qualified wallets"
}
```

### Omega = Infinity

Wallet with no losses yet:
- Omega capped at 5.0 maximum
- Prevents infinity from breaking calculation

### Zero Risk Position

Very small positions automatically get near-zero voice due to sqrt dampening.

### Omega < 1.0 (Net Loser)

- Floor at 0.1 minimum
- Even losers get small voice (not zero)
- sqrt dampening minimizes their impact

## Comparison to Other Approaches

### vs Win Rate Only

❌ **Win rate**: 60% tells you frequency, not profit
✅ **Omega**: Captures both frequency and magnitude

### vs Simple Dollar Weighting

❌ **Linear money**: Whales dominate completely
✅ **sqrt(money)**: Whales get more voice, but balanced

### vs Conviction-Squared

❌ **Conviction²**: 10x bet = 100x voice (too extreme)
✅ **sqrt(money)**: 10x bet = 3.16x voice (appropriate)

### vs Insider Detection

❌ **Behavioral signals**: High false positive rate, unproven
✅ **Historical Omega**: Proven track record required

## FAQ

**Q: Why sqrt(money) and not linear?**
A: Prevents whale domination. $100k bet is not 10x more meaningful than $10k.

**Q: Why 10 trades minimum?**
A: Filters out lucky gamblers. Need proof of skill, not 3 lucky wins.

**Q: Why category-specific?**
A: Crypto experts aren't politics experts. Domain knowledge matters.

**Q: Why Omega instead of Sharpe?**
A: Sharpe penalizes upside volatility. Omega only cares about gains vs losses (better for prediction markets).

**Q: What if market has no category?**
A: Returns null - can't calculate without category mapping.

**Q: Can wallets game this?**
A: Hard to game - need 10+ trades with good Omega in the category. Can't fake a long track record.

## Future Enhancements

### Phase 2: Tag-Level OWRR

Calculate secondary signal for specific tags (e.g., "Trump", "Bitcoin"):
- Only when 30+ markets with tag
- Minimum 15 trades per wallet in tag
- Shows as additional signal alongside category

### Phase 3: Persona Detection

Add persona labels to explain WHY one side is stronger:
- "2 insider signals detected on YES"
- "3 overconfident losers on NO"
- Explanatory, not calculational

### Phase 4: Time-Based Signals

Weight by entry timing:
- Wallets who entered 5-8 hours before resolution
- "Sweet spot" for information edge

## Summary

**OWRR is the optimal single metric because:**

1. ✅ **Simple** - One number, easy to understand
2. ✅ **Robust** - Filters luck, requires proof
3. ✅ **Balanced** - Whales don't dominate
4. ✅ **Category-specific** - Domain expertise matters
5. ✅ **Hard to game** - Need long track record
6. ✅ **Interpretable** - "Skilled money on each side"

**Use it to answer: "Where is the smart money?"**
