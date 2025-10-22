# Insider Activity Interface

A comprehensive interface for tracking wallets with suspected information advantages and early market positioning in prediction markets.

## Overview

The Insider Activity component provides real-time monitoring and analysis of trading patterns that suggest information advantages, helping users identify potentially valuable signals from informed traders.

## Features

### 1. Header Section
- **Gradient Background**: Modern rounded-3xl container with radial gradient overlay using brand color (#00E0AA)
- **Icon Badge**: Red-themed shield icon with shadow effects
- **Time Filters**: 24h, 7d, 30d timeframe selectors with brand color accents
- **Risk Filters**: ALL, HIGH, MEDIUM, LOW risk level filters with red color theme

### 2. Summary Cards (5 Metrics)
- **24h Volume**: Total insider trading volume with alert indicator
- **Transactions**: Count of suspected insider transactions
- **Average Score**: Mean insider score across active wallets
- **Suspected Wallets**: Number of flagged wallets with high insider scores
- **Top Market**: Market with most insider activity
- Each card features:
  - Rounded-2xl borders
  - Gradient backgrounds
  - Hover effects with enhanced borders and shadows
  - Red-themed icons in circular backgrounds

### 3. Charts Section (4 Visualizations)

#### Insider Volume Over Time
- Line chart with area gradient (red theme)
- Shows hourly insider trading volume for 24h
- Interactive tooltips with formatted data

#### Insider Score Distribution
- Bar chart showing wallet distribution by score ranges
- Vertical gradient bars (60-69, 70-79, 80-89, 90-100)
- Helps identify concentration of high-risk wallets

#### Top Markets by Insider Activity
- Horizontal bar chart
- Markets sorted by insider volume
- Red gradient bars with rounded corners

#### Market Analysis Cards
- Detailed breakdown per market
- Shows volume, transactions, risk score, and average entry timing
- Hover effects with red accent borders
- Linked market titles

### 4. Suspected Insider Wallets

**Card-based layout** featuring:
- Wallet alias (linked to wallet detail page)
- Risk level badge (HIGH/MEDIUM/LOW with color coding)
- Insider score with dynamic color (red for 90+, orange for 80-89, yellow for 70-79)
- WIS (Wallet Intelligence Score)
- Win rate percentage
- Average entry timing (hours before resolution)
- Total profit (highlighted in green)
- Total trades and active positions count
- Hover effects with border color changes
- Responsive grid layout

**Risk Level Color Coding:**
- HIGH: Red background/border
- MEDIUM: Orange background/border
- LOW: Green (#00E0AA) background/border

### 5. Recent Insider Transactions Table

**Columns:**
1. **Time**: Transaction timestamp
2. **Wallet**: Linked wallet alias with hover arrow
3. **Score**: Insider score badge with dynamic coloring
4. **Market**: Linked market title (truncated)
5. **Action**: BUY/SELL with icon and outcome badge
6. **Amount**: Transaction value in USD
7. **Entry Time**: Hours before resolution (red-themed)
8. **Advantage**: Information advantage level badge

**Advantage Levels:**
- CONFIRMED: Red badge (highest confidence)
- LIKELY: Orange badge (medium confidence)
- SUSPECTED: Yellow badge (lower confidence)

## Data Types

### InsiderWallet
```typescript
{
  wallet_id: string
  wallet_alias: string
  wis: number
  insider_score: number (0-100)
  total_trades: number
  win_rate: number (percentage)
  avg_entry_timing: number (hours)
  total_profit: number
  active_positions: number
  last_activity: string (ISO timestamp)
  risk_level: "LOW" | "MEDIUM" | "HIGH"
}
```

### InsiderTransaction
```typescript
{
  txn_id: string
  wallet_id: string
  wallet_alias: string
  insider_score: number
  market_id: string
  market_title: string
  outcome: string
  action: "BUY" | "SELL"
  shares: number
  amount_usd: number
  price: number
  timestamp: string
  time_before_resolution: number (hours)
  information_advantage: "SUSPECTED" | "LIKELY" | "CONFIRMED"
}
```

### InsiderMarketActivity
```typescript
{
  market_id: string
  market_title: string
  insider_volume_24h: number
  insider_transactions: number
  insider_sentiment: "BULLISH" | "BEARISH" | "NEUTRAL"
  suspicious_activity_score: number (0-100)
  avg_entry_timing: number (hours)
  resolution_date: string
}
```

## Design System

### Color Palette
- **Primary Red**: `#ef4444` - Main accent for insider-related elements
- **Brand Green**: `#00E0AA` - Positive indicators (profits, CTAs)
- **Orange**: `#f97316` - Medium risk level
- **Yellow**: `#eab308` - Low risk/suspected level
- **Gradients**: Red-based linear and radial gradients

### Typography
- **Headers**: `text-3xl font-bold tracking-tight`
- **Card Titles**: `text-lg font-semibold tracking-tight`
- **Metrics**: `text-3xl font-bold tracking-tight`
- **Labels**: `text-xs font-semibold uppercase tracking-wider`

### Spacing
- Section gaps: `space-y-8`
- Card gaps: `gap-5`
- Card padding: `p-4` to `p-8`
- Border radius: `rounded-2xl` to `rounded-3xl`

### Interactive States
- Hover: Enhanced borders with red accent (`hover:border-red-500/50`)
- Hover: Elevated shadows (`hover:shadow-xl`)
- Focus: Brand color outlines
- Active: Darker backgrounds with increased opacity

## Responsive Design

- **Mobile**: Single column layout, stacked cards
- **Tablet (sm)**: 2 columns for summary cards
- **Desktop (lg)**: 5 columns for summary cards, 2 columns for charts
- **Large (xl)**: Optimized spacing and typography

## Integration

### Required Props
None - Component is self-contained with mock data

### API Integration Points
Replace mock data with:
- `/api/insider/summary` - Summary statistics
- `/api/insider/wallets` - Suspected insider wallets
- `/api/insider/transactions` - Recent transactions
- `/api/insider/markets` - Market activity data
- `/api/insider/charts` - Time series data

### Route Setup
```typescript
// app/(dashboard)/analysis/insiders/page.tsx
import { InsiderActivity } from "@/components/insider-activity-interface";

export default function InsidersPage() {
  return <InsiderActivity />;
}
```

## Performance Considerations

1. **Chart Rendering**: Uses canvas renderer for better performance
2. **Data Pagination**: Should implement virtual scrolling for large transaction lists
3. **Lazy Loading**: Charts load on demand
4. **Memoization**: Consider memoizing chart options and filtered data
5. **Real-time Updates**: WebSocket integration for live transaction feed

## Key Metrics Explained

### Insider Score
Proprietary algorithm measuring:
- Entry timing (how early before resolution)
- Win rate consistency
- Position sizing patterns
- Market selection correlation
- Information advantage indicators

### Risk Level
Classification based on:
- HIGH: Score 85+, consistent early entries, high win rate
- MEDIUM: Score 70-84, moderate early entries
- LOW: Score below 70, less consistent patterns

### Information Advantage
- **CONFIRMED**: Multiple signals align, very early entry, perfect timing
- **LIKELY**: Strong signals, early entry, good timing
- **SUSPECTED**: Some signals, moderately early entry

## Usage Example

```tsx
import { InsiderActivity } from "@/components/insider-activity-interface";

export default function InsidersPage() {
  return (
    <div className="container">
      <InsiderActivity />
    </div>
  );
}
```

## Future Enhancements

1. **Real-time Alerts**: Notifications for new high-score insider activity
2. **Wallet Watchlist**: Save and monitor specific suspected insiders
3. **Pattern Detection**: ML-based pattern recognition for insider behavior
4. **Social Graph**: Analyze wallet connections and coordinated activity
5. **Historical Analysis**: Track insider performance over time
6. **Export Functionality**: Download insider activity reports
7. **Advanced Filters**: Filter by market category, position size, timing windows
8. **Comparison Tools**: Compare multiple insider wallets side-by-side

## Compliance & Ethics

This interface is designed for analytical purposes to:
- Improve market transparency
- Help users understand trading patterns
- Identify potentially valuable signals
- Promote informed decision-making

**Note**: The presence of suspected insider activity does not guarantee:
- Illegal activity has occurred
- Information was obtained improperly
- Future performance will match historical results

Users should always:
- Conduct their own research
- Consider multiple data sources
- Follow applicable laws and regulations
- Trade responsibly

## Dependencies

- `react`
- `next/link`
- `echarts-for-react`
- `lucide-react`
- `@/components/ui/*` (shadcn/ui components)

## Related Components

- `/components/whale-activity-interface` - Large wallet tracking
- `/components/wallet-detail-interface` - Individual wallet analysis
- `/components/market-detail-interface` - Market-specific insights
- `/components/intelligence-signals` - Signal definitions (includes Insider Activity signal)
