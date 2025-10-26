# Wallet Filtering System - Complete Guide

## Overview

The wallet filtering system provides **flexible formula controls** for selecting high-performing wallets based on omega ratios, ROI metrics, and other performance indicators. Use this in strategy builder nodes, copy trading setup, and custom alerts.

## Features

### 1. Database Tables

**`wallet_scores`** - Overall performance across all categories
- Omega ratio, momentum, PnL, win rate, etc.
- Used for general wallet ranking

**`wallet_scores_by_category`** - Performance broken down by market category
- Politics, Crypto, Sports, Business, Science, Pop Culture
- Identifies category specialists (e.g., "S grade in Politics, C grade in Crypto")

**`wallet_tracking_criteria`** - Saved filter configurations
- Pre-built filters: "Elite Performers", "Consistent Winners", etc.
- User-defined custom filters

### 2. API Endpoints

#### POST `/api/wallets/filter`
Filter wallets with dynamic criteria:

```typescript
const criteria = {
  // Omega criteria
  min_omega_ratio: 2.0,        // Minimum omega ratio
  max_omega_ratio: 50,         // Maximum (filters outliers)

  // Performance criteria
  min_roi_per_bet: 500,        // Min $500 profit per trade
  min_total_pnl: 10000,        // Min $10k total profit
  min_win_rate: 0.50,          // Min 50% win rate

  // Volume criteria
  min_closed_positions: 20,    // Min 20 trades (statistical significance)

  // Grade criteria
  allowed_grades: ['S', 'A', 'B'],  // Only S/A/B grades

  // Momentum criteria
  allowed_momentum: ['improving'],  // Only improving wallets

  // Category criteria (when available)
  categories: ['Politics', 'Crypto'],

  // Sorting
  sort_by: 'omega_ratio',     // or 'roi_per_bet', 'total_pnl', etc.
  sort_direction: 'desc',     // 'desc' or 'asc'
  limit: 50                   // Max results
};

const response = await fetch('/api/wallets/filter', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(criteria),
});

const { data, count } = await response.json();
// data = array of matching wallets
// count = number of matches
```

#### GET `/api/wallets/filter?criteria_id=1`
Apply a saved criteria by ID

```typescript
const response = await fetch('/api/wallets/filter?criteria_id=1');
const { data } = await response.json();
```

#### GET `/api/wallets/filter`
List all saved criteria

```typescript
const response = await fetch('/api/wallets/filter');
const { data } = await response.json();
// Returns all saved criteria configurations
```

### 3. React Component

**`<WalletFilterNode />`** - Reusable filter UI with sliders and toggles

```tsx
import { WalletFilterNode } from '@/components/wallet-filter-node';

function MyStrategy() {
  const handleFilterChange = (criteria, matchCount) => {
    console.log(`Found ${matchCount} wallets matching:`, criteria);
    // Use the filtered wallets for copy trading, alerts, etc.
  };

  return (
    <WalletFilterNode
      onFilterChange={handleFilterChange}
      showPreview={true}  // Show live count of matching wallets
      initialCriteria={{
        min_omega_ratio: 2.0,
        allowed_grades: ['S', 'A'],
      }}
    />
  );
}
```

## Use Cases

### 1. Copy Trading Setup

**Goal:** Find wallets to automatically copy trade

```typescript
const criteria = {
  min_omega_ratio: 3.0,          // S grade performers
  min_roi_per_bet: 600,          // $600+ per trade average
  min_closed_positions: 50,      // Proven track record
  allowed_momentum: ['improving'], // Hot streak
  categories: ['Politics'],       // Politics specialists
};

// Returns wallets ready for copy trading
```

**Expected Results:**
- 5-15 elite wallets
- Average ROI/bet: $640-$1,500
- If copying 100 trades each: $64k-$150k profit projection

### 2. Strategy Builder Node

**Goal:** Build a workflow that auto-selects wallets

```
[Wallet Filter Node] → [Top N Selector] → [Copy Trade Executor]
      ↓ Criteria            ↓ Pick top 5       ↓ Mirror trades
   Omega > 2.0
   Trades > 20
```

```tsx
function StrategyWorkflow() {
  const [filteredWallets, setFilteredWallets] = useState([]);

  return (
    <div className="workflow">
      <WalletFilterNode
        onFilterChange={(criteria, count) => {
          // Fetch filtered wallets
          fetchWallets(criteria).then(setFilteredWallets);
        }}
      />

      {/* Next node: Select top 5 */}
      <TopNSelector wallets={filteredWallets} count={5} />

      {/* Next node: Execute trades */}
      <CopyTradeExecutor wallets={selectedWallets} />
    </div>
  );
}
```

### 3. Custom Alerts

**Goal:** Get notified when new wallets meet criteria

```typescript
const criteria = {
  min_omega_ratio: 5.0,
  min_roi_per_bet: 1000,
  allowed_momentum: ['improving'],
};

// Poll API every hour
setInterval(async () => {
  const { data } = await fetch('/api/wallets/filter', {
    method: 'POST',
    body: JSON.stringify(criteria),
  }).then(r => r.json());

  // Send notification if new wallets found
  if (data.length > 0) {
    notify(`${data.length} elite wallets detected!`);
  }
}, 3600000);
```

### 4. Category Specialists

**Goal:** Find wallets that excel in specific categories

```typescript
// Politics specialist
const politicsExperts = {
  categories: ['Politics'],
  min_omega_ratio: 3.0,
  min_closed_positions: 30,
};

// Crypto specialist
const cryptoExperts = {
  categories: ['Crypto'],
  min_roi_per_bet: 800,
  allowed_grades: ['S', 'A'],
};
```

## Pre-Built Criteria Examples

The system includes 4 default criteria:

### 1. Elite Performers
```typescript
{
  name: 'Elite Performers',
  min_omega_ratio: 3.0,
  min_closed_positions: 20,
  allowed_grades: ['S', 'A'],
}
```
**Expected:** 10-20 wallets, $800-2000/bet

### 2. Consistent Winners
```typescript
{
  name: 'Consistent Winners',
  min_omega_ratio: 1.5,
  min_closed_positions: 50,
  allowed_grades: ['A', 'B', 'C'],
}
```
**Expected:** 30-50 wallets, $400-800/bet

### 3. High Volume Traders
```typescript
{
  name: 'High Volume Traders',
  min_omega_ratio: 1.0,
  min_closed_positions: 100,
  allowed_grades: ['S', 'A', 'B', 'C'],
}
```
**Expected:** 20-40 wallets, $300-600/bet

### 4. Improving Momentum
```typescript
{
  name: 'Improving Momentum',
  min_omega_ratio: 1.0,
  min_closed_positions: 10,
  allowed_grades: ['S', 'A', 'B'],
  allowed_momentum: ['improving'],
}
```
**Expected:** 15-30 wallets, $500-1000/bet

## ROI Per Bet Expectations

Based on current top 50 wallets:

| Filter Type | Median ROI/Bet | 100 Trades Projection |
|-------------|----------------|---------------------|
| All Top 50 | $882 | $88k |
| Reasonable Omega (≤50) | $640 | $64k |
| Elite (Omega >3) | $1,200 | $120k |
| Consistent (Omega 1.5-3) | $500 | $50k |
| High Volume (100+ trades) | $400 | $40k |

**Realistic Copy Trading:**
Expect **50-70%** of these numbers due to:
- Slippage and timing delays
- Different position sizes
- Market conditions
- Regression to the mean

## Category Integration (Coming Soon)

Once `wallet_scores_by_category` is populated:

### Find Politics Experts
```typescript
const { data } = await fetch('/api/wallets/filter/by-category', {
  method: 'POST',
  body: JSON.stringify({
    category: 'Politics',
    min_omega_ratio: 3.0,
  }),
});
```

### Compare Category Performance
```typescript
// Wallet performance breakdown
{
  wallet_address: '0x123...',
  overall: { omega: 2.5, grade: 'A' },
  by_category: {
    Politics: { omega: 5.2, grade: 'S', roi_per_bet: 1200 },
    Crypto: { omega: 1.8, grade: 'B', roi_per_bet: 400 },
    Sports: { omega: 1.2, grade: 'C', roi_per_bet: 200 },
  }
}
```

## Migration Guide

Run these migrations to set up the system:

```bash
# Apply database migrations
psql $DATABASE_URL -f supabase/migrations/20251024240000_create_wallet_scores_by_category.sql
psql $DATABASE_URL -f supabase/migrations/20251024240001_create_wallet_tracking_criteria.sql
```

Or via Supabase CLI:
```bash
supabase db push
```

## Testing

Test the filter API:
```bash
curl -X POST http://localhost:3000/api/wallets/filter \
  -H "Content-Type: application/json" \
  -d '{
    "min_omega_ratio": 2.0,
    "min_closed_positions": 20,
    "allowed_grades": ["S", "A"]
  }'
```

Expected response:
```json
{
  "success": true,
  "data": [ /* array of wallets */ ],
  "count": 15,
  "criteria": { /* applied criteria */ }
}
```

## Best Practices

1. **Start Conservative**
   - Use `min_closed_positions >= 20` for statistical significance
   - Filter to `max_omega_ratio <= 50` to exclude outliers
   - Use median ROI/bet, not average

2. **Layer Filters**
   - Combine omega + ROI/bet + momentum
   - Don't rely on omega alone (can be skewed)

3. **Monitor Performance**
   - Re-run filters weekly to catch new hot wallets
   - Track actual vs projected performance
   - Adjust criteria based on results

4. **Diversify**
   - Don't copy just one wallet
   - Use 5-10 wallets to spread risk
   - Mix strategies (categories, momentum, etc.)

## Future Enhancements

- [ ] Real-time wallet scoring updates
- [ ] Category-specific omega calculation
- [ ] Machine learning for optimal criteria
- [ ] Backtesting filter performance
- [ ] Auto-rebalancing based on criteria drift
- [ ] Risk-adjusted ROI metrics (Sharpe ratio)
