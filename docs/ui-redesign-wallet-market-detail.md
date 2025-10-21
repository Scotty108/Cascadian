# Wallet Detail & Market Detail Pages - Compact Layout Design Specification

**Version:** 1.0
**Date:** 2025-10-21
**Design Philosophy:** Hashdive-inspired compact, digestible layouts with progressive disclosure

---

## Design Goals

1. **Reduce cognitive load** - Show essential info first, details on demand
2. **Optimize chart real estate** - Not every chart needs full width
3. **Enable quick scanning** - Use card-based metric displays with sparklines
4. **Implement smart truncation** - Show top N items with expandable sections
5. **Maximize information density** - Multi-column grids where appropriate
6. **Mobile-first responsive** - Stack on mobile, grid on desktop

---

## Page 1: Wallet Detail Redesign

### Layout Structure (Desktop: 1440px+ width)

```
┌─────────────────────────────────────────────────────────────┐
│ Header Section (Full Width)                                 │
│ - Wallet alias, address, WIS badge, DNA badges              │
│ - Quick copy, back button                                   │
└─────────────────────────────────────────────────────────────┘
┌──────────────────────────┬──────────────────────────────────┐
│ Key Metrics Grid (4x2)   │ Risk Metrics (Compact)           │
│ - Total PnL              │ - Sharpe Ratio: 1.85 (Good)      │
│ - Win Rate               │ - 30d Volume: $150k              │
│ - Total Invested         │ - Sparkline (80px height)        │
│ - Active Positions       │                                  │
│ (Each: 200px width)      │ (400px width, 180px height)      │
└──────────────────────────┴──────────────────────────────────┘
┌──────────────────────────┬──────────────────────────────────┐
│ Trading DNA Summary      │ PnL Leaderboard Ranks            │
│ - Contrarian: 62%        │ ┌────────────────────────────┐   │
│ - Bagholder: 69.9%       │ │ 1D: #45  (+$850)           │   │
│ - Whale Splash: 212      │ │ 7D: #28  (+$4,200)         │   │
│ - Lottery Tickets: 3     │ │ 30D: #23 (+$12,800)        │   │
│ (250px width, compact)   │ │ All: #23 (+$57,000)        │   │
│                          │ └────────────────────────────┘   │
└──────────────────────────┴──────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ PnL History Chart (Full Width)                              │
│ - Realized, Unrealized, Total lines                         │
│ - 350px height (reduced from default)                       │
│ - Primary chart deserves full width                         │
└─────────────────────────────────────────────────────────────┘
┌──────────────────────────┬──────────────────────────────────┐
│ Win Rate Trend           │ Category Performance             │
│ - Line chart             │ - Donut chart                    │
│ - 250px height           │ - 250px height                   │
│ - 50% width              │ - 50% width                      │
└──────────────────────────┴──────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ Trading Bubble Map (Reduced Size)                           │
│ - 400px height (reduced from full screen)                   │
│ - Show top 20 positions with "View All Positions" button    │
│ - Collapsible section (default: expanded)                   │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ Trading Activity Calendar                                    │
│ - 300px height (compact heatmap)                            │
│ - Full year visible, scrollable if needed                   │
│ - Collapsible section (default: expanded)                   │
└─────────────────────────────────────────────────────────────┘
┌──────────────────────────┬──────────────────────────────────┐
│ Active Positions (Top 5) │ Best/Worst Trades                │
│ ┌──────────────────────┐ │ ┌──────────────────────────────┐ │
│ │ Market | Side | PnL  │ │ │ Best:  DOGE $27.9k (+456%)   │ │
│ │ Trump  | YES  | +$3k │ │ │ Worst: Lakers -$6.8k (-100%) │ │
│ │ ETH5k  | YES  | -$1k │ │ └──────────────────────────────┘ │
│ │ AGI    | NO   | -$3k │ │                                  │
│ │ ...               │ │                                  │
│ └──────────────────────┘ │                                  │
│ [Show All 8 Positions]   │                                  │
└──────────────────────────┴──────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ Recent Trading History (Top 10)                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Time      | Market       | Action | Amount | Outcome   │ │
│ │ 2h ago    | Trump 2024   | BUY YES| $31.5k | OPEN      │ │
│ │ 1d ago    | BTC 100k     | SELL NO| $13.5k | +$4.5k    │ │
│ │ ...                                                     │ │
│ └─────────────────────────────────────────────────────────┘ │
│ [Show All 156 Trades]                                       │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ Finished Positions by Category (Collapsible Sections)       │
│ ┌─── Crypto (9 positions) ────────────────── [Collapse] ┐  │
│ │ Top 3 visible by default:                             │  │
│ │ - DOGE: $27.9k (+456%)                                │  │
│ │ - BTC 100k: $21k (+233%)                              │  │
│ │ - Solana Outage: $16.2k (+138%)                       │  │
│ │ [Show All 9 Crypto Positions]                         │  │
│ └────────────────────────────────────────────────────────┘  │
│ ┌─── Finance (5 positions) ───────────────── [Collapse] ┐  │
│ │ (Collapsed by default - click to expand)              │  │
│ └────────────────────────────────────────────────────────┘  │
│ ┌─── Sports (6 positions) ────────────────── [Collapse] ┐  │
│ │ (Collapsed by default - click to expand)              │  │
│ └────────────────────────────────────────────────────────┘  │
│ (Continue for all categories...)                            │
└─────────────────────────────────────────────────────────────┘
┌──────────────────────────┬──────────────────────────────────┐
│ Entry Price Preferences  │ Platform Comparison              │
│ - Histogram chart        │ - Radar chart or table           │
│ - 250px height           │ - 250px height                   │
│ - 50% width              │ - 50% width                      │
└──────────────────────────┴──────────────────────────────────┘
```

### Component Specifications

#### 1. Key Metrics Cards
**Dimensions:** 200px × 140px each
**Layout:** 4 columns × 2 rows on desktop, stack on mobile
**Content:**
```tsx
<MetricCard>
  <Label>Total PnL</Label>
  <Value>$57,000</Value>
  <Change>+22.8%</Change>
  <Sparkline height={40} data={...} /> // Optional mini trend
</MetricCard>
```

**Design Details:**
- Border: 1px solid border
- Padding: 16px
- Border radius: 8px
- Label: text-sm text-muted-foreground
- Value: text-2xl font-bold
- Change: text-xs with color coding (green/red)

#### 2. Risk Metrics Card (Compact)
**Dimensions:** 400px × 180px
**Layout:** Right side of top section
**Content:**
```tsx
<RiskMetricsCard>
  <div className="flex items-center gap-2">
    <Label>Sharpe Ratio (30D)</Label>
    <Badge variant="success">Good</Badge>
  </div>
  <Value>1.85</Value>
  <Label className="mt-2">30D Volume: $150k</Label>
  <Sparkline height={80} data={volumeData} />
</RiskMetricsCard>
```

#### 3. Trading DNA Summary
**Dimensions:** 250px width, auto height (compact)
**Content:** Badge-style display
```tsx
<TradingDNACard>
  <h3>Trading DNA</h3>
  <DNABadge icon="🎯" label="Contrarian" value="62%" />
  <DNABadge icon="💼" label="Bagholder" value="69.9%" />
  <DNABadge icon="🐋" label="Whale Splashes" value="212" />
  <DNABadge icon="🎰" label="Lottery Tickets" value="3" />
</TradingDNACard>
```

#### 4. PnL History Chart (Full Width)
**Dimensions:** 100% × 350px
**Reason:** Primary metric deserves prominence
**Features:**
- 3 lines: Realized (green), Unrealized (orange), Total (blue, bold)
- Time range selector: 7D, 30D, 90D, All
- Grid: subtle
- Legend: bottom placement

#### 5. Side-by-Side Charts (Win Rate & Category)
**Dimensions:** 50% width each × 250px height
**Gap:** 16px between
**Charts:**
- Left: Win Rate trend line
- Right: Category Performance donut

#### 6. Trading Bubble Map (Reduced)
**Dimensions:** 100% × 400px (reduced from previous full-screen)
**Progressive Disclosure:**
- Show top 20 positions by default
- Button: "View All Positions" to expand
- Collapsible header with toggle

#### 7. Trading Calendar Heatmap
**Dimensions:** 100% × 300px
**Features:**
- Compact year view
- Tooltip on hover
- Collapsible section (default expanded)

#### 8. Active Positions Table (Truncated)
**Dimensions:** 50% width × auto height
**Progressive Disclosure:**
- Show top 5 positions
- Columns: Market (truncate to 30 chars), Side, Shares, Entry, Current, PnL
- Button: "Show All 8 Positions"
- Sort: by |unrealized_pnl| descending

#### 9. Best/Worst Trades Card
**Dimensions:** 50% width × matches Active Positions height
**Content:**
```tsx
<HighlightTradesCard>
  <div className="border-b pb-3 mb-3">
    <Label>Best Trade</Label>
    <TradeSummary
      title="Will DOGE reach $1?"
      pnl="+$27,900"
      roi="+456%"
      color="green"
    />
  </div>
  <div>
    <Label>Worst Trade</Label>
    <TradeSummary
      title="Will Lakers make playoffs?"
      pnl="-$6,840"
      roi="-100%"
      color="red"
    />
  </div>
</HighlightTradesCard>
```

#### 10. Recent Trading History (Truncated)
**Dimensions:** 100% × auto
**Progressive Disclosure:**
- Show last 10 trades
- Table with columns: Time, Market, Action, Amount, Outcome
- Market names truncate with ellipsis at 40 characters
- Button: "Show All 156 Trades"

#### 11. Finished Positions by Category (Accordion)
**Progressive Disclosure Pattern:**
```tsx
<CategoryAccordion defaultExpanded={["Crypto"]}>
  <AccordionItem value="Crypto">
    <AccordionTrigger>
      Crypto (9 positions) • +$91,200 PnL
    </AccordionTrigger>
    <AccordionContent>
      <PositionsList items={topThree} />
      {totalCount > 3 && (
        <Button variant="ghost" onClick={expandAll}>
          Show All {totalCount} Crypto Positions
        </Button>
      )}
    </AccordionContent>
  </AccordionItem>
  <AccordionItem value="Finance">
    // Collapsed by default
  </AccordionItem>
  // ... other categories
</CategoryAccordion>
```

**Display Rules:**
- Crypto: Expanded by default (show top 3)
- Other categories: Collapsed
- Each category header shows: count, total PnL
- Click to expand shows top 3
- "Show All X Positions" button reveals full list

#### 12. Entry Preferences & Comparison (Side-by-Side)
**Dimensions:** 50% width each × 250px
**Charts:**
- Left: Histogram of entry price buckets
- Right: Radar chart comparing to platform avg

---

## Page 2: Market Detail Redesign

### Layout Structure (Desktop: 1440px+ width)

```
┌─────────────────────────────────────────────────────────────┐
│ Header Section                                               │
│ - Market title (truncate at 100 chars with "Read more")     │
│ - Category badge                                             │
│ - Description (show first 150 chars, "Read more" expands)   │
└─────────────────────────────────────────────────────────────┘
┌────────┬────────┬────────┬────────┬────────┬────────────────┐
│ Price  │ SII    │ 24h Vol│ Liquid.│ Signal │ Closes In      │
│ 63¢    │ 75     │ $2.4M  │ $850k  │ BUY YES│ 168h          │
│ +2.4%  │ 85% cf │ Total: │ 10 bps │ +150bp │ Nov 5          │
│ ▲      │ ●      │ $45M   │ ●      │ ●      │ ●              │
│ (Each card: 180px × 120px with small sparkline)             │
└────────┴────────┴────────┴────────┴────────┴────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ Price Chart (YES/NO) - Full Width                           │
│ - 350px height (reduced from 450px)                         │
│ - Time selector: 1h, 24h, 7d, 30d                           │
│ - YES line (blue) and NO line (orange)                      │
└─────────────────────────────────────────────────────────────┘
┌──────────────────────────┬──────────────────────────────────┐
│ SII Trend (48h)          │ Signal Breakdown                 │
│ - Line chart             │ - Progress bars showing:         │
│ - 250px height           │   • PSP: 68% (40% weight)        │
│ - 50% width              │   • Crowd: 72% (30% weight)      │
│                          │   • Momentum: 65% (20% weight)   │
│                          │   • Micro: 70% (10% weight)      │
│                          │ - Compact display                │
└──────────────────────────┴──────────────────────────────────┘
┌──────────────────────────┬──────────────────────────────────┐
│ Order Book Depth         │ Recent Whale Trades (Top 5)      │
│ - Combined bids/asks     │ ┌──────────────────────────────┐ │
│ - 250px height           │ │ Time | Wallet | WIS | Side   │ │
│ - Area chart             │ │ 2h   | Whale42| 85  | BUY YES│ │
│ - 50% width              │ │ 3h   | Smart  | 91  | BUY YES│ │
│                          │ │ ...                          │ │
│                          │ └──────────────────────────────┘ │
│                          │ [Show All Whale Activity]        │
└──────────────────────────┴──────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ Holders Analysis - Tabbed View (YES/NO)                     │
│ ┌─── YES (156 holders) ──┬─── NO (98 holders) ───────────┐ │
│ │ Summary:               │                               │ │
│ │ - Profit: +$425k       │ (Tab content switches)        │ │
│ │ - Loss: -$85k          │                               │ │
│ │ - Realized: 61¢        │                               │ │
│ │                        │                               │ │
│ │ Top Holders (show 5):  │                               │ │
│ │ ┌──────────────────┐   │                               │ │
│ │ │Wallet|Pos|PnL|%  │   │                               │ │
│ │ │Whale |125k|+15k  │   │                               │ │
│ │ │Smart |89k|+12.5k │   │                               │ │
│ │ └──────────────────┘   │                               │ │
│ │ [Show All 156 Holders] │                               │ │
│ └────────────────────────┴───────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ Smart Wallet Positions (Top 5)                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Wallet     | WIS | Side | Shares | Entry | PnL        │ │
│ │ WhaleTrader| 85  | YES  | 150k   | 61¢   | +$3k (+3%) │ │
│ │ SmartInv   | 91  | YES  | 200k   | 59¢   | +$8k (+6%) │ │
│ └─────────────────────────────────────────────────────────┘ │
│ [Show All Smart Positions]                                  │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ Related Markets (Show Top 3)                                │
│ ┌────────────┬────────────┬────────────────────────────┐   │
│ │ Biden 2024 │ Harris nom │ Popular Vote               │   │
│ │ YES 37¢    │ YES 92¢    │ YES 48¢                    │   │
│ │ Vol: $1.8M │ Vol: $980k │ Vol: $1.25M                │   │
│ └────────────┴────────────┴────────────────────────────┘   │
│ [Show All 6 Related Markets]                                │
└─────────────────────────────────────────────────────────────┘
┌──────────────────────────┬──────────────────────────────────┐
│ Order Book Tables        │ OHLC Candlestick (Collapsible)   │
│ Bids | Asks              │ - Collapsed by default           │
│ (Show top 5 each)        │ - Click to expand: 400px height  │
│ [View Full Book]         │ - 7 days, 4h candles             │
└──────────────────────────┴──────────────────────────────────┘
```

### Component Specifications

#### 1. Market Header (Compact)
**Content Truncation:**
```tsx
<MarketHeader>
  <div className="flex items-center gap-3">
    <h1 className="text-2xl font-bold truncate max-w-[600px]">
      {title}
    </h1>
    <Badge>{category}</Badge>
  </div>
  <p className="text-sm text-muted-foreground mt-1">
    {description.slice(0, 150)}
    {description.length > 150 && (
      <Button
        variant="link"
        size="sm"
        onClick={() => setShowFullDesc(true)}
      >
        Read more
      </Button>
    )}
  </p>
</MarketHeader>
```

#### 2. Key Metrics Cards (6 columns)
**Dimensions:** 180px × 120px each
**Content:**
```tsx
<MetricCard>
  <Label>Current Price</Label>
  <Value>63¢</Value>
  <Change>+2.4%</Change>
  <MiniSparkline height={30} data={last24h} />
</MetricCard>
```

**Design:**
- Compact cards with essential data only
- Small sparklines (30px height) for 24h trends
- Color-coded indicators
- Icons for visual scanning

#### 3. Price Chart (Full Width)
**Dimensions:** 100% × 350px (reduced from 450px)
**Features:**
- YES and NO price lines
- Time range selector
- Primary chart deserves full width
- Reduced height to save space

#### 4. SII Trend & Signal Breakdown (Side-by-Side)
**Dimensions:** 50% width each × 250px
**Left:** Line chart of SII over 48h
**Right:** Progress bars showing signal components
```tsx
<SignalBreakdown>
  <SignalBar
    label="PSP Ensemble"
    weight={40}
    contribution={68}
    confidence={88}
  />
  // ... 3 more
</SignalBreakdown>
```

#### 5. Order Book Depth & Whale Trades (Side-by-Side)
**Dimensions:** 50% width each × 250px
**Left:** Combined depth chart
**Right:** Truncated whale trades table
- Show top 5 trades
- Columns: Time, Wallet (link), WIS, Side, Amount
- Button: "Show All Whale Activity"

#### 6. Holders Analysis (Tabbed)
**Progressive Disclosure:**
- Tabs: YES / NO
- Show summary stats at top
- Top 5 holders visible
- Button: "Show All X Holders"
- Table columns: Wallet, Position, Supply %, Entry, PnL

#### 7. Smart Wallet Positions (Truncated)
**Dimensions:** 100% × auto
**Display:**
- Top 5 smart wallet positions (WIS ≥ 70)
- Button: "Show All Smart Positions"
- Sorted by WIS descending

#### 8. Related Markets (Card Grid)
**Layout:** 3 columns on desktop
**Progressive Disclosure:**
- Show top 3 related markets
- Button: "Show All 6 Related Markets"
- Each card: ~300px wide, compact info

#### 9. Order Book Tables & OHLC (Split)
**Left (40%):** Order book tables
- Show top 5 bids/asks
- "View Full Book" button

**Right (60%):** OHLC Chart
- Collapsible section (default collapsed)
- Label: "OHLC Candlestick Chart"
- When expanded: 400px height

---

## Responsive Breakpoints

### Desktop (1440px+)
- All grids and side-by-side layouts active
- Full feature set visible

### Tablet (768px - 1439px)
- 2-column grids become 2 columns
- Some side-by-side sections stack
- Charts reduce to 300px height

### Mobile (< 768px)
- All grids stack to single column
- Charts: 250px height
- Tables: horizontal scroll with fixed first column
- Metric cards: 2 per row max
- Progressive disclosure becomes more aggressive:
  - Show top 3 instead of top 5
  - More sections collapsed by default

---

## Progressive Disclosure Pattern Summary

### "Show More" Triggers

**Wallet Detail:**
1. Active Positions: Top 5 → Show All 8
2. Trading History: Top 10 → Show All 156
3. Finished Positions: Top 3 per category → Show All X
4. Categories: Crypto expanded, others collapsed
5. Bubble Map: Top 20 → View All Positions

**Market Detail:**
1. Description: 150 chars → Full text
2. Whale Trades: Top 5 → Show All
3. Holders: Top 5 per side → Show All X Holders
4. Smart Positions: Top 5 → Show All
5. Related Markets: Top 3 → Show All 6
6. Order Book: Top 5 → View Full Book
7. OHLC Chart: Collapsed → Expand to view

### Button Styles
```tsx
// Primary expansion
<Button variant="outline" size="sm">
  Show All {count} {type}
</Button>

// Secondary/link style
<Button variant="ghost" size="sm">
  View Full Book →
</Button>

// Collapsible headers
<Collapsible>
  <CollapsibleTrigger>
    Section Name (X items) <ChevronDown />
  </CollapsibleTrigger>
</Collapsible>
```

---

## Chart Sizing Reference Table

| Chart Type | Wallet Detail | Market Detail | Justification |
|------------|---------------|---------------|---------------|
| Primary PnL/Price | 100% × 350px | 100% × 350px | Main metric deserves prominence |
| Secondary Line | 50% × 250px | 50% × 250px | Comparison/supporting data |
| Donut/Pie | 50% × 250px | - | Distribution overview |
| Bubble Map | 100% × 400px | - | Reduced from full-screen |
| Heatmap Calendar | 100% × 300px | - | Compact year view |
| Depth Chart | - | 50% × 250px | Supporting microstructure |
| Sparklines | - | 100% × 30-80px | Quick trends in cards |
| OHLC | - | 100% × 400px | Collapsed by default |

---

## Design Tokens

### Spacing
```css
--spacing-section: 24px;      /* Between major sections */
--spacing-card: 16px;         /* Between cards in grid */
--spacing-card-internal: 16px;/* Inside card padding */
--spacing-compact: 8px;       /* Tight spacing */
```

### Chart Heights
```css
--chart-primary: 350px;
--chart-secondary: 250px;
--chart-compact: 200px;
--chart-sparkline-lg: 80px;
--chart-sparkline-sm: 30px;
--chart-bubble: 400px;
--chart-calendar: 300px;
--chart-ohlc: 400px;
```

### Card Dimensions
```css
--metric-card-width: 180px;
--metric-card-height: 120px;
--metric-card-lg-width: 200px;
--metric-card-lg-height: 140px;
--risk-card-width: 400px;
--risk-card-height: 180px;
```

### Typography Scale
```css
--text-metric-label: 0.875rem;    /* 14px */
--text-metric-value: 1.5rem;      /* 24px */
--text-section-heading: 1.125rem; /* 18px */
--text-page-title: 1.5rem;        /* 24px */
```

### Colors
```css
--color-pnl-positive: #10b981;
--color-pnl-negative: #ef4444;
--color-primary-chart: #3b82f6;
--color-secondary-chart: #f59e0b;
--color-tertiary-chart: #8b5cf6;
```

---

## Implementation Priority

### Phase 1: High Impact (Week 1)
1. Reduce primary chart heights (450px → 350px)
2. Implement metric card grids (replace large sections)
3. Add "Show More" buttons to all tables
4. Truncate descriptions with "Read more"

### Phase 2: Layout Restructure (Week 2)
1. Convert single-column sections to 2-column grids
2. Implement side-by-side chart layouts
3. Reduce bubble map height
4. Add sparklines to metric cards

### Phase 3: Progressive Disclosure (Week 3)
1. Implement category accordions for finished positions
2. Add collapsible sections for secondary charts
3. Create truncated table views with expansion
4. Implement responsive breakpoints

### Phase 4: Polish (Week 4)
1. Add smooth expand/collapse animations
2. Implement skeleton loaders for chart sections
3. Add hover states and tooltips
4. Performance optimization for large datasets

---

## Key Design Decisions

1. **Full-width charts only for primary metrics**
   - Rationale: PnL history and price charts are main story
   - Secondary charts benefit from side-by-side comparison

2. **Default to collapsed for advanced features**
   - OHLC chart, deep analytics collapsed
   - Keeps initial load clean and scannable

3. **Top N pattern everywhere**
   - Show 3-5 items, expand for more
   - Reduces cognitive load
   - Faster initial render

4. **Category-based organization**
   - Finished positions grouped by category
   - One category (Crypto) expanded by default
   - Reduces vertical scroll significantly

5. **Sparklines in metric cards**
   - Shows trend at a glance
   - No need for separate trend section
   - Compact and informative

---

## Accessibility Considerations

1. **Keyboard Navigation**
   - All "Show More" buttons keyboard accessible
   - Collapsible sections use proper ARIA attributes
   - Tab order follows visual hierarchy

2. **Screen Reader Support**
   - Chart alternatives with data summaries
   - Descriptive button labels ("Show All 156 Trades" not just "Show More")
   - Proper heading hierarchy

3. **Color Contrast**
   - All text meets WCAG AA standards
   - Chart colors distinguishable
   - Don't rely on color alone (use icons + text)

4. **Focus Management**
   - When expanding sections, maintain focus
   - Clear focus indicators
   - Skip links for long pages

---

## Performance Optimizations

1. **Lazy Loading**
   - Render charts only when in viewport
   - Load full tables on expansion
   - Defer non-critical sections

2. **Virtualization**
   - Use virtual scrolling for 100+ row tables
   - Only render visible chart data points

3. **Memoization**
   - Cache chart configurations
   - Memo expensive calculations (PnL aggregations)
   - Prevent unnecessary re-renders

4. **Code Splitting**
   - Load OHLC chart component only when expanded
   - Separate bundle for bubble map
   - Progressive enhancement

---

## Success Metrics

### Quantitative
- Page scroll depth reduced by 40%
- Time to key metric reduced by 60%
- Chart load time under 500ms
- Interaction rate on "Show More" buttons > 30%

### Qualitative
- Users can answer "What's the wallet's performance?" in < 5 seconds
- Market sentiment clear from top section alone
- No need to scroll for critical trading decisions
- Feels "scannable" and "organized" vs "overwhelming"

---

## References & Inspiration

1. **Hashdive.com**
   - Functional grouping
   - Action-driven expansion
   - Compact metric displays

2. **Bloomberg Terminal**
   - Multi-column layouts
   - Sparklines in summaries
   - Information density

3. **Robinhood/Webull**
   - Clean metric cards
   - Progressive disclosure
   - Mobile-first thinking

4. **TradingView**
   - Chart sizing hierarchy
   - Collapsible sections
   - Custom indicators

---

## Next Steps

1. **Design Review**
   - Stakeholder walkthrough
   - Developer feasibility check
   - Mobile mockup validation

2. **Prototype**
   - Build Figma interactive prototype
   - User testing with 5 target users
   - Iterate based on feedback

3. **Implementation**
   - Start with Phase 1 (high impact)
   - Release incrementally
   - Monitor analytics

4. **Iteration**
   - A/B test key changes
   - Gather user feedback
   - Continuous refinement

---

**Document Status:** Ready for Review
**Next Review Date:** 2025-10-28
**Owner:** Design Team
**Approvers:** Product, Engineering, UX
