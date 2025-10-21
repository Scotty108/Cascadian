# Implementation Roadmap: Compact Layout Redesign

**Sprint Duration:** 4 weeks (6-day sprints × 4)
**Team:** 1 Developer + 1 Designer
**Goal:** Transform Wallet Detail and Market Detail pages to Hashdive-inspired compact layouts

---

## Week 1: Foundation & High-Impact Changes

### Sprint Goals
- Build core component library
- Implement metric card grids
- Reduce primary chart heights
- Add basic truncation

### Day 1-2: Component Library Setup

**Tasks:**
1. Create reusable component files
   - `/components/ui/metric-card.tsx`
   - `/components/ui/metric-card-large.tsx`
   - `/components/ui/risk-metrics-card.tsx`
   - `/components/ui/mini-sparkline.tsx`

2. Build layout utilities
   - `/components/ui/two-column-section.tsx`
   - `/components/ui/responsive-container.tsx`

**Deliverables:**
```tsx
// Example: metric-card.tsx
export function MetricCard({ label, value, change, sparklineData }: MetricCardProps) {
  return (
    <div className="border rounded-lg p-4 bg-card w-[180px] h-[120px]">
      {/* Implementation from ui-components-reference.md */}
    </div>
  );
}
```

**Success Criteria:**
- [ ] All 5 core components built and tested
- [ ] Storybook stories created for each
- [ ] TypeScript types defined
- [ ] Components responsive

---

### Day 3-4: Wallet Detail - Top Section Redesign

**Tasks:**
1. Replace stacked metrics with grid layout
   - Refactor lines 977-1048 in wallet-detail-interface/index.tsx
   - Create 4×2 metric card grid
   - Add sparklines to cards

2. Add Risk Metrics card
   - 30D Sharpe ratio display
   - Volume sparkline
   - Badge for Sharpe level

3. Create PnL Leaderboard Ranks card
   - 1D, 7D, 30D, All time ranks
   - Compact table format

**Before:**
```tsx
// Lines 977-1048: Long vertical sections
<div className="space-y-4">
  <div className="border rounded-lg p-4">Total PnL: $57,000</div>
  <div className="border rounded-lg p-4">Win Rate: 62.8%</div>
  {/* ... more stacked sections */}
</div>
```

**After:**
```tsx
<MetricsGrid metrics={[
  { label: 'Total PnL', value: '$57,000', change: { value: '+22.8%', trend: 'up' }},
  { label: 'Win Rate', value: '62.8%', change: { value: '+5.2%', trend: 'up' }},
  // ... 6 more
]} />

<TwoColumnSection
  left={<RiskMetricsCard {...wallet.risk_metrics} />}
  right={<PnLRanksCard ranks={wallet.pnl_ranks} />}
/>
```

**Success Criteria:**
- [ ] All key metrics visible above fold
- [ ] Grid responsive (1/2/4/6 columns)
- [ ] Sparklines rendering correctly
- [ ] Mobile layout stacks properly

---

### Day 5-6: Chart Height Reductions

**Tasks:**
1. Reduce PnL chart from default to 350px
   - Update line 612 in wallet-detail-interface/index.tsx
   - Test readability at new height

2. Reduce price chart in market-detail-interface
   - Update line 612 in market-detail-interface/index.tsx

3. Update chart grid configurations
   - Ensure labels don't overlap
   - Adjust font sizes if needed

**Changes:**
```tsx
// Before
<div className="h-[450px]">
  <ReactECharts option={pnlChartOption} ... />
</div>

// After
<div className="h-[350px]">
  <ReactECharts option={pnlChartOption} ... />
</div>
```

**Success Criteria:**
- [ ] Charts render at 350px height
- [ ] All data still visible
- [ ] Axis labels readable
- [ ] Legend not cut off

---

## Week 2: Side-by-Side Layouts & Truncation

### Day 1-2: Secondary Charts Side-by-Side

**Tasks:**
1. Win Rate + Category Performance (Wallet Detail)
   - Currently: two full-width charts
   - After: 50% width each, side-by-side

2. SII Trend + Signal Breakdown (Market Detail)
   - Currently: two sections
   - After: 50% width each

3. Order Book + Whale Trades (Market Detail)
   - Create side-by-side layout

**Implementation:**
```tsx
// Wallet Detail - around line 843
<TwoColumnSection
  left={
    <SecondaryChart
      title="Win Rate Trend"
      option={winRateChartOption}
      height={250}
    />
  }
  right={
    <SecondaryChart
      title="Category Performance"
      option={distributionChartOption}
      height={250}
    />
  }
/>
```

**Success Criteria:**
- [ ] Charts render at 250px height
- [ ] Side-by-side on desktop (≥1024px)
- [ ] Stacked on mobile (<1024px)
- [ ] Both charts fully functional

---

### Day 3-4: Table Truncation Components

**Tasks:**
1. Build TruncatedTable component
   - Show top N rows
   - "Show All X" button
   - Smooth expansion

2. Apply to Active Positions (Wallet)
   - Show top 5 positions
   - Expandable to all 8

3. Apply to Trading History (Wallet)
   - Show top 10 trades
   - Expandable to all 156

4. Apply to Holders tables (Market)
   - Show top 5 per side
   - Expandable

**Component:**
```tsx
<TruncatedTable
  data={tradingHistory}
  columns={[
    { header: 'Time', cell: (row) => formatTime(row.timestamp) },
    { header: 'Market', cell: (row) => <TruncatedCell text={row.market_title} /> },
    // ... more columns
  ]}
  initialRows={10}
  expandButtonText="Show All Trades"
/>
```

**Success Criteria:**
- [ ] Tables show only top N rows
- [ ] Expand button appears
- [ ] Expansion smooth (no layout jump)
- [ ] Works with all table types

---

### Day 5-6: Text Truncation

**Tasks:**
1. Build TruncatedText component
2. Apply to market description (Market Detail)
   - Truncate at 150 characters
   - "Read more" expands

3. Apply to table cells
   - Market titles truncate at 30-40 chars
   - Tooltip shows full text

**Implementation:**
```tsx
// Market Detail header
<TruncatedText
  text={market.description}
  maxLength={150}
  className="text-sm text-muted-foreground"
/>

// Table cells
<TruncatedCell text={trade.market_title} maxLength={30} />
```

**Success Criteria:**
- [ ] Long text truncates with ellipsis
- [ ] "Read more" button functional
- [ ] Tooltips show full text
- [ ] No text overflow

---

## Week 3: Collapsible Sections & Category Accordions

### Day 1-3: Category Accordion (Wallet Detail)

**Tasks:**
1. Build CategoryAccordion component
2. Group finished positions by category
   - Crypto, Finance, Sports, Tech, Pop Culture, Politics

3. Show top 3 per category by default
4. Crypto expanded, others collapsed
5. Add "Show All X Positions" per category

**Implementation:**
```tsx
<CategoryAccordion
  categories={[
    {
      name: 'Crypto',
      count: 9,
      pnl: 91200,
      positions: cryptoPositions
    },
    // ... other categories
  ]}
  defaultExpanded={['Crypto']}
/>
```

**Data Transformation:**
```tsx
// Group finished positions by category
const categorizedPositions = finishedBets.reduce((acc, bet) => {
  if (!acc[bet.category]) {
    acc[bet.category] = {
      name: bet.category,
      count: 0,
      pnl: 0,
      positions: []
    };
  }
  acc[bet.category].count++;
  acc[bet.category].pnl += bet.realized_pnl;
  acc[bet.category].positions.push(bet);
  return acc;
}, {} as Record<string, CategoryGroup>);
```

**Success Criteria:**
- [ ] Positions grouped correctly
- [ ] Crypto category expanded by default
- [ ] Each category shows top 3
- [ ] Expansion reveals full list
- [ ] Category headers show count + total PnL

---

### Day 4-5: Collapsible Sections

**Tasks:**
1. Build CollapsibleSection component
2. Apply to Trading Bubble Map
   - Default expanded
   - User can collapse

3. Apply to Trading Calendar
   - Default expanded

4. Apply to OHLC Chart (Market Detail)
   - Default collapsed (advanced feature)

**Implementation:**
```tsx
<CollapsibleSection
  title="Trading Bubble Map"
  count={wallet.active_positions}
  defaultOpen={true}
>
  <TradingBubbleChart
    height={400}
    data={positions}
  />
</CollapsibleSection>
```

**Success Criteria:**
- [ ] Sections collapse smoothly
- [ ] Chevron icon rotates
- [ ] State persists during session
- [ ] Mobile-friendly tap targets

---

### Day 6: Related Markets & Smart Positions Truncation

**Tasks:**
1. Market Detail - Related Markets
   - Show top 3 markets
   - "Show All 6 Related Markets" button

2. Market Detail - Smart Positions
   - Show top 5 positions
   - "Show All Smart Positions" button

**Implementation:**
```tsx
// Related Markets
const [showAllRelated, setShowAllRelated] = useState(false);
const displayedMarkets = showAllRelated
  ? relatedMarkets
  : relatedMarkets.slice(0, 3);

{/* Grid of markets */}
{!showAllRelated && (
  <Button onClick={() => setShowAllRelated(true)}>
    Show All {relatedMarkets.length} Related Markets
  </Button>
)}
```

**Success Criteria:**
- [ ] Only top 3/5 visible initially
- [ ] Expansion smooth
- [ ] Button text accurate
- [ ] Grid layout maintained

---

## Week 4: Polish, Responsive, & Performance

### Day 1-2: Responsive Breakpoints

**Tasks:**
1. Test all layouts on mobile (375px)
2. Test on tablet (768px)
3. Test on desktop (1440px+)

4. Adjust breakpoints:
   - Metric cards: 1→2→4→6 columns
   - Two-column sections stack on tablet
   - Tables scroll horizontally on mobile

**Breakpoint Checks:**
```scss
// Mobile (< 768px)
- All grids stack to 1-2 columns
- Charts reduce to 250px height
- Tables horizontal scroll

// Tablet (768px - 1439px)
- Grids: 2 columns
- Charts: 300px height
- Some side-by-side sections stack

// Desktop (1440px+)
- Full grid layouts
- All features visible
- Optimal spacing
```

**Success Criteria:**
- [ ] No horizontal scroll on mobile
- [ ] All touch targets ≥44px
- [ ] Text readable on small screens
- [ ] Charts functional on all sizes

---

### Day 3-4: Loading States & Animations

**Tasks:**
1. Add skeleton loaders
   - MetricCardSkeleton
   - ChartSkeleton
   - TableSkeleton

2. Smooth expand/collapse animations
   - Use CSS transitions
   - Framer Motion for complex animations

3. Hover states
   - Cards lift on hover
   - Buttons highlight
   - Table rows highlight

**Implementation:**
```tsx
// Skeleton loader
{isLoading ? (
  <div className="grid grid-cols-6 gap-4">
    {Array.from({ length: 6 }).map((_, i) => (
      <MetricCardSkeleton key={i} />
    ))}
  </div>
) : (
  <MetricsGrid metrics={walletMetrics} />
)}

// Animations
<motion.div
  initial={{ height: 0, opacity: 0 }}
  animate={{ height: 'auto', opacity: 1 }}
  exit={{ height: 0, opacity: 0 }}
  transition={{ duration: 0.3 }}
>
  {expandedContent}
</motion.div>
```

**Success Criteria:**
- [ ] Skeletons match final layout
- [ ] Animations smooth (60fps)
- [ ] No layout shift on load
- [ ] Hover states clear

---

### Day 5: Performance Optimization

**Tasks:**
1. Lazy load charts
   - Use react-intersection-observer
   - Only render when in viewport

2. Virtualize long tables
   - Use react-virtual for 100+ rows
   - Only render visible rows

3. Memoize expensive calculations
   - Chart options
   - Sorted/filtered data

4. Code splitting
   - Lazy load OHLC chart
   - Split bubble map component

**Implementation:**
```tsx
// Lazy load chart
import { useInView } from 'react-intersection-observer';

function LazyChart({ option }: LazyChartProps) {
  const { ref, inView } = useInView({
    triggerOnce: true,
    threshold: 0.1,
  });

  return (
    <div ref={ref} className="h-[350px]">
      {inView ? (
        <ReactECharts option={option} />
      ) : (
        <ChartSkeleton />
      )}
    </div>
  );
}

// Memoize chart options
const pnlChartOption = useMemo(
  () => createPnLChartOption(pnlHistory),
  [pnlHistory]
);
```

**Success Criteria:**
- [ ] Initial page load < 2s
- [ ] Chart render < 500ms
- [ ] Table expansion < 300ms
- [ ] No jank on scroll

---

### Day 6: QA, Bug Fixes, & Documentation

**Tasks:**
1. Cross-browser testing
   - Chrome, Firefox, Safari, Edge
   - Mobile Safari, Chrome Mobile

2. Accessibility audit
   - Keyboard navigation
   - Screen reader support
   - Color contrast

3. Update component documentation
4. Create migration guide for future pages

**Checklist:**
- [ ] All interactions keyboard accessible
- [ ] Focus indicators visible
- [ ] ARIA labels correct
- [ ] Color contrast ≥4.5:1
- [ ] Semantic HTML used
- [ ] Alt text for charts

---

## Testing Strategy

### Unit Tests
```typescript
// metric-card.test.tsx
describe('MetricCard', () => {
  it('renders label and value', () => {
    render(<MetricCard label="PnL" value="$57,000" />);
    expect(screen.getByText('PnL')).toBeInTheDocument();
    expect(screen.getByText('$57,000')).toBeInTheDocument();
  });

  it('shows trend indicator for positive change', () => {
    render(
      <MetricCard
        label="PnL"
        value="$57k"
        change={{ value: '+22.8%', trend: 'up' }}
      />
    );
    expect(screen.getByTestId('trending-up-icon')).toBeInTheDocument();
  });
});
```

### Integration Tests
```typescript
// wallet-detail.test.tsx
describe('WalletDetail', () => {
  it('truncates active positions to top 5', () => {
    const mockWallet = createMockWallet({ active_positions: 8 });
    render(<WalletDetail walletAddress="0x123" />);

    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(6); // header + 5 rows
    expect(screen.getByText(/Show All 8 Positions/i)).toBeInTheDocument();
  });

  it('expands positions on button click', async () => {
    render(<WalletDetail walletAddress="0x123" />);

    const expandButton = screen.getByText(/Show All 8 Positions/i);
    await userEvent.click(expandButton);

    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(9); // header + 8 rows
  });
});
```

### Visual Regression Tests
- Capture screenshots of all major sections
- Compare before/after changes
- Test responsive breakpoints

---

## Rollout Plan

### Phase 1: Internal Testing (Day 1-2 of Week 4)
- Deploy to staging environment
- Internal team testing
- Gather feedback

### Phase 2: Beta Users (Day 3-4 of Week 4)
- Invite 10-20 power users
- A/B test: 50% new layout, 50% old
- Collect analytics

### Phase 3: Gradual Rollout (Day 5-6 of Week 4)
- 25% of users → 50% → 75% → 100%
- Monitor error rates
- Watch for performance issues

### Rollback Plan
- Feature flag: `ENABLE_COMPACT_LAYOUT`
- Can toggle off instantly
- Old components remain in codebase for 2 weeks

---

## Success Metrics

### Quantitative Goals
- [ ] Page scroll depth reduced by 50%+
- [ ] Time to key metric < 3 seconds
- [ ] Chart load time < 500ms
- [ ] Mobile bounce rate decrease by 20%
- [ ] Page load time < 2 seconds

### Qualitative Goals
- [ ] Users can assess wallet quality in < 5 seconds
- [ ] "Overwhelm" complaints decrease
- [ ] Positive feedback on compact layout
- [ ] Increased engagement with "Show More" features

### Analytics to Track
```typescript
// Track expansion interactions
analytics.track('Table Expanded', {
  table_type: 'trading_history',
  initial_rows: 10,
  total_rows: 156,
  time_to_expand: 3.2, // seconds
});

// Track scroll depth
analytics.track('Page Scroll', {
  page: 'wallet_detail',
  max_scroll_percent: 45,
  time_on_page: 28, // seconds
});

// Track chart views
analytics.track('Chart Viewed', {
  chart_type: 'pnl_history',
  viewport_time: 5.8, // seconds
});
```

---

## Risk Mitigation

### Technical Risks

**Risk:** Chart rendering performance degrades
**Mitigation:**
- Lazy load charts
- Use canvas renderer
- Limit data points to 500 max

**Risk:** Mobile layout breaks
**Mitigation:**
- Extensive mobile testing
- Progressive enhancement approach
- Fallback to single-column on error

**Risk:** Accessibility regression
**Mitigation:**
- Automated a11y tests
- Manual screen reader testing
- Keyboard navigation checklist

### User Experience Risks

**Risk:** Users miss important data in collapsed sections
**Mitigation:**
- Default critical sections to expanded
- Clear expansion buttons
- Analytics on expansion rates

**Risk:** "Show More" pattern confusing
**Mitigation:**
- User testing before launch
- Clear button copy ("Show All 156 Trades" not just "Show More")
- Consistent pattern across app

---

## Post-Launch

### Week 5: Monitor & Iterate

**Tasks:**
1. Monitor analytics daily
2. Review error logs
3. Collect user feedback
4. Fix critical bugs

**Iteration Candidates:**
- Adjust initial row counts (5 vs 10)
- Fine-tune chart heights
- Optimize expansion animations
- Add more sparklines

### Week 6: Apply Pattern to Other Pages

**Candidates:**
- Dashboard page
- Market Screener results
- Portfolio overview

**Template:**
```tsx
// Reusable compact layout pattern
export function CompactDetailPage({
  header,
  metrics,
  primaryChart,
  secondaryCharts,
  tables,
  collapsibleSections,
}: CompactDetailPageProps) {
  return (
    <ResponsiveContainer>
      {header}
      <MetricsGrid metrics={metrics} />
      <PrimaryChart {...primaryChart} />
      <TwoColumnSection left={secondaryCharts[0]} right={secondaryCharts[1]} />
      {tables.map(t => <TruncatedTable {...t} />)}
      {collapsibleSections.map(s => <CollapsibleSection {...s} />)}
    </ResponsiveContainer>
  );
}
```

---

## Resources Needed

### Design
- Figma mockups (already in design system)
- Icon set (Lucide React - already installed)
- Color tokens (already defined)

### Development
- React 18 (installed)
- TailwindCSS 3.4 (installed)
- Framer Motion (install: `pnpm add framer-motion`)
- react-intersection-observer (install: `pnpm add react-intersection-observer`)
- react-virtual (install: `pnpm add @tanstack/react-virtual`)

### Testing
- Jest + React Testing Library (installed)
- Playwright for E2E (install: `pnpm add -D @playwright/test`)
- Chromatic for visual regression (optional)

---

## File Structure

```
/components
  /ui
    metric-card.tsx                 ← Week 1, Day 1
    metric-card-large.tsx          ← Week 1, Day 1
    risk-metrics-card.tsx          ← Week 1, Day 1
    mini-sparkline.tsx             ← Week 1, Day 1
    two-column-section.tsx         ← Week 1, Day 2
    responsive-container.tsx       ← Week 1, Day 2
    truncated-table.tsx            ← Week 2, Day 3
    truncated-text.tsx             ← Week 2, Day 5
    truncated-cell.tsx             ← Week 2, Day 5
    collapsible-section.tsx        ← Week 3, Day 4
    category-accordion.tsx         ← Week 3, Day 1
    section-header.tsx             ← Utility
    timeframe-selector.tsx         ← Utility

  /wallet-detail-interface
    index.tsx                       ← Main component (refactored)
    /components
      trading-bubble-chart.tsx      ← Existing (reduce height)
      trading-calendar-heatmap.tsx  ← Existing
      trading-dna-card.tsx          ← New Week 1, Day 3
      pnl-ranks-card.tsx            ← New Week 1, Day 3
      best-worst-trades-card.tsx    ← New Week 2, Day 6

  /market-detail-interface
    index.tsx                       ← Main component (refactored)
    /components
      signal-breakdown.tsx          ← Extract existing
      holders-analysis.tsx          ← New Week 3, Day 6

/docs
  ui-redesign-wallet-market-detail.md     ← Main spec
  ui-components-reference.md               ← Component guide
  ui-redesign-visual-comparison.md         ← Before/after
  ui-redesign-implementation-roadmap.md    ← This file
```

---

## Daily Standup Template

```markdown
### Date: YYYY-MM-DD

**Completed Yesterday:**
- [ ] Task 1
- [ ] Task 2

**Today's Goals:**
- [ ] Task 1
- [ ] Task 2

**Blockers:**
- None / [Describe blocker]

**Questions:**
- None / [Ask questions]
```

---

## Definition of Done

A task is "done" when:
- [ ] Code written and passes linting
- [ ] Unit tests written and passing
- [ ] Component documented (Storybook or inline)
- [ ] Responsive on mobile/tablet/desktop
- [ ] Accessibility checked (keyboard nav, contrast)
- [ ] Code reviewed and approved
- [ ] Merged to main branch
- [ ] Deployed to staging

---

**Document Status:** Implementation Ready
**Last Updated:** 2025-10-21
**Owner:** Development Team
**Estimated Effort:** 4 weeks (24 dev days)

**Related Files:**
- `/Users/scotty/Projects/Cascadian-app/docs/ui-redesign-wallet-market-detail.md`
- `/Users/scotty/Projects/Cascadian-app/docs/ui-components-reference.md`
- `/Users/scotty/Projects/Cascadian-app/docs/ui-redesign-visual-comparison.md`
