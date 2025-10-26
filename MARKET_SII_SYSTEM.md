# Market SII (Smart Investor Index) System

Continuous tracking system that identifies which side of each market (YES or NO) has smarter money based on Omega ratios of top traders.

## Overview

The Market SII System compares the performance (Omega scores) of the top 20 traders on the YES side vs the top 20 traders on the NO side of each market. This generates actionable signals showing where smart money is positioned.

## How It Works

### Algorithm

1. **Get Top Positions**: For each market, identify the top 20 positions (by volume) on both YES and NO sides
2. **Calculate Average Omega**: Look up each wallet's Omega score and calculate the average for each side
3. **Generate Signal**: The side with higher average Omega = smarter money
4. **Calculate Confidence**: Based on sample size, Omega quality, and balance

### Signal Strength

**Formula:**
```typescript
signalStrength = (normalizedDifferential) * (sampleSizeFactor)

where:
  normalizedDifferential = min(abs(differential) / 0.5, 1.0)
  sampleSizeFactor = min(minSampleSize / 10, 1.0)
```

**Interpretation:**
- `1.0` = Strong signal (large Omega diff, good sample size)
- `0.5` = Moderate signal
- `< 0.3` = Weak signal (ignore)

### Confidence Score

**Formula:**
```typescript
confidence = (qualityFactor * 0.4) + (sizeFactor * 0.3) + (balanceFactor * 0.3)

where:
  qualityFactor = min(avgOmega / 2.0, 1.0)
  sizeFactor = min(totalWallets / 40, 1.0)
  balanceFactor = minWallets / maxWallets (1.0 = balanced)
```

## Architecture

### Data Flow

```
Goldsky Positions Subgraph
  ↓ (Top 20 YES + Top 20 NO positions)
  ↓
calculateMarketSII() [lib/metrics/market-sii.ts]
  ↓ (Looks up Omega scores from wallet_scores)
  ↓
market_sii table (Postgres)
  ↓
API Endpoints + Continuous Updates
  ↓
Frontend Display
```

### Files

**Core Calculation:**
- `lib/metrics/market-sii.ts` - SII calculation engine

**Database:**
- `supabase/migrations/20251024220000_create_market_sii.sql` - Schema
- Table: `market_sii` with continuous updates

**API Endpoints:**
- `app/api/markets/[id]/sii/route.ts` - Get SII for single market
- `app/api/sii/refresh/route.ts` - Batch refresh endpoint

**Continuous Updates:**
- `scripts/continuous-sii-update.ts` - Update script (cron or continuous)

## Database Schema

```sql
CREATE TABLE market_sii (
  id BIGSERIAL PRIMARY KEY,
  market_id TEXT NOT NULL UNIQUE,

  -- YES side metrics
  yes_top_wallets TEXT[],      -- Top 20 wallet addresses
  yes_avg_omega DECIMAL(10,4),  -- Average Omega ratio
  yes_total_volume DECIMAL,     -- Total position size
  yes_wallet_count INTEGER,     -- Wallets with valid scores

  -- NO side metrics
  no_top_wallets TEXT[],
  no_avg_omega DECIMAL(10,4),
  no_total_volume DECIMAL,
  no_wallet_count INTEGER,

  -- Signal
  smart_money_side TEXT,        -- 'YES', 'NO', or 'NEUTRAL'
  omega_differential DECIMAL,   -- YES avg - NO avg
  signal_strength DECIMAL,      -- 0.0 to 1.0
  confidence_score DECIMAL,     -- 0.0 to 1.0

  -- Context
  market_question TEXT,
  current_yes_price DECIMAL,
  current_no_price DECIMAL,

  -- Timestamps
  calculated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

### Indexes

- `idx_market_sii_signal` - Filter by smart_money_side and signal_strength
- `idx_market_sii_strongest` - Sort by strongest signals
- `idx_market_sii_recent` - Sort by most recent updates

## Usage

### 1. Get SII for a Single Market

```bash
# Get cached SII (1-hour TTL)
GET /api/markets/{conditionId}/sii

# Force fresh calculation
GET /api/markets/{conditionId}/sii?fresh=true
```

**Response:**
```json
{
  "market_id": "0x...",
  "market_question": "Will Bitcoin reach $100k by end of 2024?",

  "yes_avg_omega": 2.15,
  "yes_wallet_count": 18,
  "yes_total_volume": 125430.50,
  "yes_top_wallets": ["0x...", "0x...", ...],

  "no_avg_omega": 1.42,
  "no_wallet_count": 15,
  "no_total_volume": 98200.00,
  "no_top_wallets": ["0x...", "0x...", ...],

  "smart_money_side": "YES",
  "omega_differential": 0.73,
  "signal_strength": 0.85,
  "confidence_score": 0.78,

  "cached": false,
  "cache_age_seconds": 0
}
```

### 2. Get Strongest Signals Across All Markets

```bash
GET /api/markets/strongest/sii?limit=20
```

Returns top 20 markets with strongest SII signals.

### 3. Batch Refresh (Continuous Updates)

```bash
# Refresh all active markets
POST /api/sii/refresh
{}

# Refresh specific markets
POST /api/sii/refresh
{
  "market_ids": ["0x...", "0x..."],
  "force": true
}
```

**Response:**
```json
{
  "success": true,
  "total": 100,
  "refreshed": 95,
  "failed": 5,
  "timestamp": "2024-10-24T20:00:00Z"
}
```

## Continuous Updates

### Option 1: Cron Job (Recommended)

Run the update script every hour:

```bash
# One-time run
npx tsx scripts/continuous-sii-update.ts

# Continuous mode (runs every hour)
npx tsx scripts/continuous-sii-update.ts --continuous
```

**Add to crontab:**
```cron
# Update SII scores every hour
0 * * * * cd /path/to/project && npx tsx scripts/continuous-sii-update.ts
```

### Option 2: API Trigger

Call the batch refresh endpoint from:
- Webhook when new trades occur
- Frontend action (admin panel)
- Scheduled cloud function

### Option 3: Real-time Event Listener

Listen for new trade events and trigger updates:

```typescript
// Pseudo-code
onNewTrade(async (trade) => {
  // Update wallet score
  await calculateWalletOmegaScore(trade.wallet)

  // Update market SII
  await refreshMarketSII(trade.marketId)
})
```

## Update Behavior

The continuous update script:

1. **Updates Wallet Scores** (50 oldest per run)
   - Recalculates Omega for wallets with stale scores
   - Updates `wallet_scores` table
   - Takes ~30-60 seconds

2. **Updates Market SII** (Top 100 markets by volume)
   - Recalculates SII for active markets
   - Processes in batches of 5 (to avoid rate limits)
   - Takes ~2-3 minutes

3. **Total Cycle Time**: ~3-4 minutes
4. **Recommended Frequency**: Every hour
5. **Cache TTL**: 1 hour (configurable)

## Interpreting Signals

### Strong Bullish Signal (Buy YES)
- `smart_money_side = 'YES'`
- `signal_strength > 0.7`
- `confidence_score > 0.6`
- `omega_differential > 0.5`

**Meaning:** Top traders on YES side have significantly higher Omega than NO side

### Strong Bearish Signal (Buy NO)
- `smart_money_side = 'NO'`
- `signal_strength > 0.7`
- `confidence_score > 0.6`
- `omega_differential < -0.5`

**Meaning:** Top traders on NO side have significantly higher Omega than YES side

### Neutral / No Signal
- `smart_money_side = 'NEUTRAL'`
- `signal_strength < 0.3`
- `abs(omega_differential) < 0.1`

**Meaning:** Both sides have similar Omega scores, no clear edge

## Example Use Cases

### 1. Market Screener Filter

Show markets where smart money has clear preference:

```sql
SELECT *
FROM market_sii
WHERE signal_strength > 0.7
  AND confidence_score > 0.6
ORDER BY signal_strength DESC
LIMIT 20
```

### 2. Portfolio Alert

Alert when smart money flips sides:

```typescript
const previousSII = await getMarketSII(marketId)
const currentSII = await refreshMarketSII(marketId, undefined, true)

if (previousSII.smart_money_side !== currentSII.smart_money_side) {
  alert(`🚨 Smart money flipped to ${currentSII.smart_money_side} on "${marketId}"`)
}
```

### 3. Strategy Builder Trigger

Execute trades when SII signal appears:

```typescript
const sii = await refreshMarketSII(marketId)

if (sii.signal_strength > 0.8 && sii.smart_money_side === 'YES') {
  // Smart money is strongly on YES
  executeTrade({ market: marketId, side: 'YES', size: 100 })
}
```

## Performance Optimization

### Caching Strategy

- **Level 1**: In-memory cache (application)
- **Level 2**: Postgres `market_sii` table (1-hour TTL)
- **Level 3**: Wallet scores cached separately (reduces recalculation)

### Batch Processing

- Process markets in batches of 5 to avoid rate limits
- Use `Promise.allSettled()` to handle failures gracefully
- Add 1-second delay between batches

### Index Optimization

Queries are optimized with:
- `idx_market_sii_signal` for filtering by signal
- `idx_market_sii_strongest` for ranking
- `idx_market_sii_recent` for freshness checks

## Monitoring & Debugging

### Check Update Status

```sql
-- How many markets have SII calculated?
SELECT COUNT(*) FROM market_sii;

-- When was last update?
SELECT MAX(calculated_at) FROM market_sii;

-- Markets with strongest signals
SELECT market_question, smart_money_side, signal_strength
FROM market_sii
WHERE signal_strength > 0.7
ORDER BY signal_strength DESC
LIMIT 10;
```

### Debug Failed Calculations

```typescript
// Check if market has positions
const positions = await getTopPositions(conditionId, '1', 20)
console.log('YES positions:', positions.length)

// Check if wallets have Omega scores
const wallets = positions.map(p => p.user)
const scores = await getWalletOmegaScores(wallets)
console.log('Wallets with scores:', scores.size)
```

## Next Steps

1. **Frontend Integration**
   - Display SII badge on market cards
   - Show "Smart Money on YES" / "Smart Money on NO"
   - Add SII filter to Market Screener

2. **Advanced Signals**
   - Track SII changes over time (momentum)
   - Alert on SII flips (smart money changing sides)
   - Combine with price momentum for stronger signals

3. **Machine Learning**
   - Train model on SII + market outcomes
   - Predict win probability based on SII
   - Optimize signal thresholds

## Credits

Built based on Austin's requirements:
- Compare top 20 YES vs top 20 NO positions per market
- Grade wallets using Omega ratios
- Generate market-level signals
- Update continuously
