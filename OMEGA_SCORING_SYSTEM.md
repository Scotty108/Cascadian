# Omega Scoring System

Smart scoring system for prediction market wallets based on Omega ratios and momentum.

## Overview

The Omega Scoring System calculates performance metrics for Polymarket wallets using realized PnL data from Goldsky's PnL subgraph. It identifies traders with asymmetric upside and improving momentum.

## Features

### 1. Omega Ratio Calculation
**Formula:** `Omega = Sum(Realized Gains) / Sum(Realized Losses)`

- **S Grade:** Omega > 3.0 (exceptional)
- **A Grade:** Omega > 2.0 (excellent)
- **B Grade:** Omega > 1.5 (good)
- **C Grade:** Omega > 1.0 (profitable)
- **D Grade:** Omega > 0.5 (marginal)
- **F Grade:** Omega ≤ 0.5 (poor)

### 2. Omega Momentum
Tracks whether a trader's edge is improving or declining over time.

- **Calculation:** Compare Omega of recent half vs older half of trades
- **Improving:** Momentum > +10%
- **Declining:** Momentum < -10%
- **Stable:** Between -10% and +10%

### 3. Minimum Trade Threshold
- Requires **5+ closed positions** to avoid noise
- Filters out wallets with insufficient data

## Architecture

### Data Flow
```
Goldsky PnL Subgraph
  ↓
calculateWalletOmegaScore() [lib/metrics/omega-from-goldsky.ts]
  ↓
Postgres wallet_scores table
  ↓
API Endpoint [/api/wallets/[address]/score]
  ↓
Frontend Display
```

### Files

**Core Calculation:**
- `lib/metrics/omega-from-goldsky.ts` - Omega calculation engine
- `lib/metrics/market-momentum.ts` - Market momentum for strategy builder

**Database:**
- `supabase/migrations/20251024210000_create_wallet_scores.sql` - Schema
- Table: `wallet_scores` with 1-hour TTL caching

**API:**
- `app/api/wallets/[address]/score/route.ts` - REST endpoint
- Supports `?fresh=true` to recalculate
- Supports `?ttl=3600` to set cache duration

**Scripts:**
- `scripts/calculate-omega-scores.ts` - Test calculations
- `scripts/sync-omega-scores.ts` - Sync scores to database

## Critical: Goldsky PnL Correction Factor

### The Problem
Goldsky PnL values are **13.2399x higher** than Polymarket's displayed values.

**Example:**
- Goldsky calculated: $422,409
- Polymarket shows: $31,904
- Ratio: 13.2399x

### Root Cause
Likely due to **multi-outcome token aggregation** in the Conditional Token Framework (CTF):
- Each market creates multiple outcome tokens (YES/NO in binary markets, N tokens in multi-outcome)
- Goldsky may be summing PnL across all outcome tokens instead of grouping by market/condition first
- This causes the same market's PnL to be counted multiple times

### The Solution
We apply a correction factor at the **earliest point in the calculation**:

```typescript
// lib/metrics/omega-from-goldsky.ts:123
const pnl = parseFloat(position.realizedPnl) / GOLDSKY_PNL_CORRECTION_FACTOR / 1e6
```

Where `GOLDSKY_PNL_CORRECTION_FACTOR = 13.2399`

### Verification
Tested against wallet `0x241f846866c2de4fb67cdb0ca6b963d85e56ef50`:
- Before correction: $422,409.56
- After correction: $31,904.33
- Polymarket profile: $31,904.33
- **Error: 0.00%** ✅

## Usage

### Calculate Omega Score for a Wallet

```typescript
import { calculateWalletOmegaScore } from '@/lib/metrics/omega-from-goldsky'

const score = await calculateWalletOmegaScore('0x...')

console.log(score)
// {
//   wallet_address: '0x...',
//   omega_ratio: 2.19,
//   grade: 'A',
//   total_pnl: 31904.33,
//   omega_momentum: 1.476,
//   momentum_direction: 'improving',
//   meets_minimum_trades: true,
//   // ... more metrics
// }
```

### Rank Multiple Wallets

```typescript
import { rankWalletsByOmega } from '@/lib/metrics/omega-from-goldsky'

const wallets = ['0x...', '0x...', '0x...']
const ranked = await rankWalletsByOmega(wallets)

// Returns wallets sorted by Omega ratio (highest first)
// Only includes wallets with >5 closed trades
```

### Find Hot Wallets (Improving Momentum)

```typescript
import { getTopMomentumWallets } from '@/lib/metrics/omega-from-goldsky'

const wallets = ['0x...', '0x...', '0x...']
const hot = await getTopMomentumWallets(wallets, 10)

// Returns top 10 wallets with positive momentum
// Sorted by momentum percentage (highest first)
```

### API Endpoint

```bash
# Get cached score (1-hour TTL)
GET /api/wallets/0x.../score

# Get fresh calculation
GET /api/wallets/0x.../score?fresh=true

# Custom cache TTL (in seconds)
GET /api/wallets/0x.../score?ttl=7200
```

Response:
```json
{
  "wallet_address": "0x...",
  "omega_ratio": 2.19,
  "grade": "A",
  "total_pnl": 31904.33,
  "total_gains": 58487.93,
  "total_losses": 26583.60,
  "win_rate": 0.385,
  "avg_gain": 229.84,
  "avg_loss": 65.61,
  "omega_momentum": 1.476,
  "momentum_direction": "improving",
  "total_positions": 1000,
  "closed_positions": 662,
  "meets_minimum_trades": true,
  "cached": false,
  "cache_age_seconds": 0
}
```

## Database Schema

```sql
CREATE TABLE wallet_scores (
  id BIGSERIAL PRIMARY KEY,
  wallet_address TEXT NOT NULL UNIQUE,

  -- Omega metrics
  omega_ratio DECIMAL(10, 4),
  omega_momentum DECIMAL(10, 4),

  -- Position stats
  total_positions INTEGER DEFAULT 0,
  closed_positions INTEGER DEFAULT 0,

  -- Performance metrics
  total_pnl DECIMAL(18, 2),
  total_gains DECIMAL(18, 2),
  total_losses DECIMAL(18, 2),
  win_rate DECIMAL(5, 4),
  avg_gain DECIMAL(18, 2),
  avg_loss DECIMAL(18, 2),

  -- Classification
  momentum_direction TEXT CHECK (...),
  grade TEXT CHECK (...),
  meets_minimum_trades BOOLEAN DEFAULT FALSE,

  -- Timestamps (auto-managed)
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Indexes
- `idx_wallet_scores_wallet` - Fast lookups by address
- `idx_wallet_scores_omega` - Ranking queries (descending)
- `idx_wallet_scores_momentum` - Hot wallets (improving only)
- `idx_wallet_scores_grade` - Grade filtering

## Next Steps

1. **Market SII (Smart Investor Index)**
   - Compare top 20 YES positions vs top 20 NO positions
   - Calculate average Omega scores for each side
   - Generate market-level signals

2. **Frontend Integration**
   - Display Omega grades on wallet pages
   - Show momentum indicators (📈/📉/➡️)
   - Add filters to Market Screener

3. **Real-time Updates**
   - Sync new trades from ClickHouse
   - Recalculate scores periodically
   - Webhook triggers on new positions

## Testing

Run the test script to verify calculations:

```bash
npx tsx scripts/calculate-omega-scores.ts
```

Sync scores to database:

```bash
npx tsx scripts/sync-omega-scores.ts
```

## Performance Considerations

- **Goldsky PnL Subgraph:** Free, fast, pre-calculated PnL
- **Caching:** 1-hour TTL in Postgres reduces API load
- **Indexes:** Optimized for ranking and filtering queries
- **Batch Processing:** Can calculate scores for multiple wallets in parallel

## Credits

Built based on Austin's requirements:
- Calculate omega ratio and improving omega momentum
- Filter wallets with >5 closed trades
- Find high asymmetric upside
- Avoid stale champions (use momentum)
