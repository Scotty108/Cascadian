# Implementation Task Breakdown: Wallet & Market Detail Redesign

**Sprint:** 6-day implementation cycle
**Team:** Frontend developer + Designer (pair programming recommended)
**Start Date:** TBD
**End Date:** TBD + 6 days

---

## Sprint Overview

### Day 1-2: Foundation & Shared Components
**Goal:** Build reusable components and data infrastructure

### Day 3-4: Wallet Detail Redesign
**Goal:** Refactor Wallet Detail with new compact layouts

### Day 5-6: Market Detail Redesign
**Goal:** Remove tabs, implement progressive disclosure

---

## Day 1: Shared Components & Data Infrastructure

### Morning Session (9am-12pm): Component Library

**Task 1.1: Create MetricCard Component (2 hours)**
- File: `/components/ui/metric-card.tsx`
- Features:
  - Prop types: label, value, change, changeType, icon, sparklineData
  - Responsive sizing (180×120px desktop, full-width mobile)
  - Color coding for change (green positive, red negative)
  - Optional sparkline integration
- **Acceptance Criteria:**
  - [ ] Renders correctly with all prop combinations
  - [ ] Sparkline displays when data provided
  - [ ] Mobile responsive (stacks vertically)
  - [ ] Accessible (ARIA labels)
- **Files to Create:**
  - `components/ui/metric-card.tsx`
  - `components/ui/metric-card.stories.tsx` (Storybook)

**Task 1.2: Create Sparkline Component (1 hour)**
- File: `/components/ui/sparkline.tsx`
- Features:
  - Accepts number array data
  - Configurable height, color
  - Renders as inline SVG
  - Smooth curve interpolation
- **Acceptance Criteria:**
  - [ ] Renders polyline correctly from data
  - [ ] Scales to container width
  - [ ] Handles empty/invalid data gracefully
  - [ ] Performance: <10ms render for 100 points
- **Files to Create:**
  - `components/ui/sparkline.tsx`
  - Tests: `components/ui/sparkline.test.tsx`

### Afternoon Session (1pm-5pm): More Shared Components

**Task 1.3: Create CollapsibleSection Component (1.5 hours)**
- File: `/components/ui/collapsible-section.tsx`
- Features:
  - Default expanded/collapsed state
  - Smooth height animation
  - "Show more" / "Show less" button
  - Optional row count display
  - Compact preview mode
- **Acceptance Criteria:**
  - [ ] Animation smooth (300ms ease-in-out)
  - [ ] Works with any child content
  - [ ] Accessible (keyboard toggle, ARIA)
  - [ ] Shows item count when provided
- **Files to Create:**
  - `components/ui/collapsible-section.tsx`

**Task 1.4: Create TruncatedTable Component (1.5 hours)**
- File: `/components/ui/truncated-table.tsx`
- Features:
  - Generic table with progressive disclosure
  - Show N rows by default, expand to all
  - Render functions for header and rows
  - Empty state handling
- **Acceptance Criteria:**
  - [ ] Shows initialRows count by default
  - [ ] Expands to show all on click
  - [ ] Type-safe (TypeScript generics)
  - [ ] Works with existing Table component
- **Files to Create:**
  - `components/ui/truncated-table.tsx`

**Task 1.5: Create TruncatedText Component (1 hour)**
- File: `/components/ui/truncated-text.tsx`
- Features:
  - Truncate at N characters
  - "Read more" / "Read less" toggle
  - Preserve word boundaries
- **Acceptance Criteria:**
  - [ ] Doesn't cut mid-word
  - [ ] Toggle works smoothly
  - [ ] Handles short text (no truncation needed)
- **Files to Create:**
  - `components/ui/truncated-text.tsx`

---

## Day 2: Data Generation & Utilities

### Morning Session (9am-12pm): Random Utilities

**Task 2.1: Implement Statistical Distributions (2 hours)**
- File: `/lib/random-utils.ts`
- Functions:
  - `normalDistribution(mean, stdDev, min, max)`
  - `powerLawRandom(min, max, alpha)`
  - `betaDistribution(alpha, beta)`
  - `randomFloat(min, max)`
  - `randomInt(min, max)`
  - `weightedRandom(options, weights)`
- **Acceptance Criteria:**
  - [ ] Normal distribution follows bell curve
  - [ ] Power law creates long tail
  - [ ] All functions bounded correctly
  - [ ] Unit tests with statistical validation
- **Files to Create:**
  - `lib/random-utils.ts`
  - `lib/random-utils.test.ts`

**Task 2.2: Implement Name Generators (1 hour)**
- File: `/lib/name-generators.ts`
- Functions:
  - `generateEthAddress(seed?)` → "0x1a2b3c..."
  - `generateTraderName(seed?)` → "WhaleTrader42"
  - `generateMarketId(category, seed?)` → "trump-2024-election"
  - `generateMarketTitle(category)` → "Will Trump win 2024?"
  - `generateMarketDescription(category, title)` → Full description
- **Acceptance Criteria:**
  - [ ] Names sound realistic
  - [ ] Eth addresses valid format
  - [ ] Market titles grammatically correct
  - [ ] Deterministic with seed
- **Files to Create:**
  - `lib/name-generators.ts`
  - `lib/name-generators.test.ts`

### Afternoon Session (1pm-5pm): Data Generators

**Task 2.3: Implement Wallet Profile Generator (2 hours)**
- File: `/lib/generate-wallet-profile.ts`
- Features:
  - Generate complete WalletProfile
  - Correlated metrics (WIS ↔ PnL)
  - Archetype-based style flags
  - Realistic distributions
- **Acceptance Criteria:**
  - [ ] All metrics within realistic ranges
  - [ ] Correlations correct (WIS vs PnL r≈0.5-0.7)
  - [ ] Archetypes produce distinct patterns
  - [ ] Passes validation checks
- **Files to Create:**
  - `lib/generate-wallet-profile.ts`
  - `lib/validate-wallet-profile.ts`
  - Tests

**Task 2.4: Implement Market Detail Generator (2 hours)**
- File: `/lib/generate-market-detail.ts`
- Features:
  - Generate complete MarketDetail
  - Price history with trends
  - Holders with power law distribution
  - Whale trades
- **Acceptance Criteria:**
  - [ ] Price stays in 0.05-0.95 range
  - [ ] Bid < current < ask
  - [ ] Liquidity correlates with volume
  - [ ] Holders sum to ~100% supply
- **Files to Create:**
  - `lib/generate-market-detail.ts`
  - `lib/validate-market-detail.ts`
  - Tests

---

## Day 3: Wallet Detail Redesign (Part 1)

### Morning Session (9am-12pm): Hero Metrics & Core Layout

**Task 3.1: Refactor Wallet Detail Main Component (1.5 hours)**
- File: `/components/wallet-detail-interface/index.tsx`
- Changes:
  - Remove old single-scroll layout
  - Add new hero metrics grid
  - Reorganize section order per spec
  - Update imports for new components
- **Acceptance Criteria:**
  - [ ] Hero metrics visible above fold
  - [ ] Sections in correct priority order
  - [ ] No TypeScript errors
  - [ ] Compiles successfully

**Task 3.2: Create Hero Metrics Grid (1.5 hours)**
- File: `/components/wallet-detail-interface/components/hero-metrics.tsx`
- Features:
  - 2×4 grid on desktop
  - 2×2 grid on mobile
  - 8 key metrics with sparklines
  - MetricCard integration
- **Acceptance Criteria:**
  - [ ] All 8 metrics displayed
  - [ ] Responsive grid (2×4 → 2×2)
  - [ ] Sparklines render correctly
  - [ ] Cards properly spaced
- **Files to Create:**
  - `components/wallet-detail-interface/components/hero-metrics.tsx`

### Afternoon Session (1pm-5pm): Charts & DNA

**Task 3.3: Create Compact Trading DNA Component (2 hours)**
- File: `/components/wallet-detail-interface/components/compact-trading-dna.tsx`
- Features:
  - Summary view: 150px height
  - One-line style descriptor
  - Strengths & watch items (3 each)
  - "View Detailed Analysis" expansion
  - Full breakdown in expanded view
- **Acceptance Criteria:**
  - [ ] Compact view ≤150px
  - [ ] Expanded view shows all badges
  - [ ] Animation smooth
  - [ ] Mobile friendly
- **Files to Create:**
  - `components/wallet-detail-interface/components/compact-trading-dna.tsx`

**Task 3.4: Create PnL Ranks Card (1 hour)**
- File: `/components/wallet-detail-interface/components/pnl-ranks-card.tsx`
- Features:
  - 4 period cards (1D, 7D, 30D, All)
  - Rank with percentile
  - Trend indicators (↑↓)
  - PnL values
- **Acceptance Criteria:**
  - [ ] All 4 periods shown
  - [ ] Trend arrows displayed
  - [ ] Responsive layout
- **Files to Create:**
  - `components/wallet-detail-interface/components/pnl-ranks-card.tsx`

**Task 3.5: Reduce PnL Chart Height (30 min)**
- File: `/components/wallet-detail-interface/index.tsx`
- Change PnL chart from 450px → 350px
- Add expandable breakdown (realized vs unrealized)
- **Acceptance Criteria:**
  - [ ] Chart height = 350px
  - [ ] Breakdown hidden by default
  - [ ] "Show breakdown" expands details

---

## Day 4: Wallet Detail Redesign (Part 2)

### Morning Session (9am-12pm): Tables & Positions

**Task 4.1: Implement Progressive Disclosure for Active Positions (1.5 hours)**
- File: `/components/wallet-detail-interface/components/truncated-positions-table.tsx`
- Features:
  - Show top 5 positions
  - "Show All N Positions" button
  - Use TruncatedTable component
  - Maintain all columns
- **Acceptance Criteria:**
  - [ ] Shows 5 rows by default
  - [ ] Expands to all on click
  - [ ] Table formatting preserved
  - [ ] Mobile horizontal scroll
- **Files to Create:**
  - `components/wallet-detail-interface/components/truncated-positions-table.tsx`

**Task 4.2: Implement Progressive Disclosure for Finished Positions (1 hour)**
- Same as 4.1 but for finished positions
- Show recent 10 instead of top 5
- Sort by closed date descending
- **Acceptance Criteria:**
  - [ ] Shows 10 most recent
  - [ ] Sorted correctly
  - [ ] Expand works

**Task 4.3: Create Risk Metrics Compact Component (1.5 hours)**
- File: `/components/wallet-detail-interface/components/risk-metrics-compact.tsx`
- Features:
  - Compact grid layout (250px height)
  - Sharpe ratio with level badge
  - 30d volume total
  - Volume sparkline (30 points)
- **Acceptance Criteria:**
  - [ ] Height ≤250px
  - [ ] All metrics visible
  - [ ] Sparkline renders
  - [ ] Responsive
- **Files to Create:**
  - `components/wallet-detail-interface/components/risk-metrics-compact.tsx`

### Afternoon Session (1pm-5pm): Categories & Final Touches

**Task 4.4: Create Category Accordion Component (2 hours)**
- File: `/components/wallet-detail-interface/components/category-accordion.tsx`
- Features:
  - 5 category sections (Politics, Crypto, Tech, Finance, Pop Culture)
  - Collapsed by default
  - Expand to show win rate, PnL, ROI, chart
  - Charts load on expansion (lazy)
- **Acceptance Criteria:**
  - [ ] All categories listed
  - [ ] Starts collapsed
  - [ ] Expands smoothly
  - [ ] Charts lazy load
- **Files to Create:**
  - `components/wallet-detail-interface/components/category-accordion.tsx`

**Task 4.5: Resize Trading Bubble Map & Calendar (1 hour)**
- Modify existing components:
  - `components/wallet-detail-interface/components/trading-bubble-chart.tsx`
  - `components/wallet-detail-interface/components/trading-calendar-heatmap.tsx`
- Changes:
  - Bubble chart: 300px height, 50% width
  - Calendar: 300px height, 50% width
  - Side-by-side layout on desktop
  - Stacked on mobile
- **Acceptance Criteria:**
  - [ ] Both 300px height
  - [ ] Side-by-side on desktop
  - [ ] Stacked on mobile
  - [ ] Maintain interactivity

**Task 4.6: Update Identity Badges with Progressive Disclosure (1 hour)**
- File: `/components/wallet-detail-interface/index.tsx`
- Features:
  - Show top 3 badges
  - "Show N More Badges" button
  - Preserve badge styling
- **Acceptance Criteria:**
  - [ ] Top 3 visible
  - [ ] Rest hidden
  - [ ] Expand works
  - [ ] Badges styled correctly

---

## Day 5: Market Detail Redesign (Part 1)

### Morning Session (9am-12pm): Remove Tabs & Hero Section

**Task 5.1: Remove Tab Navigation (1 hour)**
- File: `/components/market-detail-interface/index.tsx`
- Changes:
  - Remove Tabs, TabsList, TabsContent
  - Convert to single scroll layout
  - Reorganize sections per spec
  - Remove tab state management
- **Acceptance Criteria:**
  - [ ] No tabs present
  - [ ] All content visible in scroll
  - [ ] Section order correct
  - [ ] No broken references

**Task 5.2: Create Hero Sentiment Section (2 hours)**
- File: `/components/market-detail-interface/components/hero-sentiment.tsx`
- Features:
  - 4-card grid (sentiment, smart money, momentum, signal)
  - Donut chart for sentiment
  - Smart money % indicator
  - Momentum sparklines
  - Signal badge with confidence
- **Acceptance Criteria:**
  - [ ] All 4 cards render
  - [ ] Donut chart works
  - [ ] Responsive (2×2 on mobile)
  - [ ] Height ~180px per card
- **Files to Create:**
  - `components/market-detail-interface/components/hero-sentiment.tsx`
  - `components/market-detail-interface/components/smart-money-indicator.tsx`

### Afternoon Session (1pm-5pm): Holders & Whale Activity

**Task 5.3: Create Compact Holders Summary (2 hours)**
- File: `/components/market-detail-interface/components/compact-holders-summary.tsx`
- Features:
  - YES/NO summary cards (holders count, PnL, avg entry, smart %)
  - Top 3 holders per side
  - "Show All N Holders" expansion
  - Whale badges (🐋) for >10% supply
- **Acceptance Criteria:**
  - [ ] Summary cards display
  - [ ] Top 3 per side shown
  - [ ] Expansion works
  - [ ] Whale badges visible
- **Files to Create:**
  - `components/market-detail-interface/components/compact-holders-summary.tsx`

**Task 5.4: Create Whale Activity Feed (1 hour)**
- File: `/components/market-detail-interface/components/whale-activity-feed.tsx`
- Features:
  - Recent 5 whale trades
  - Time ago format ("2 min ago")
  - Visual indicators (🟢 YES, 🔴 NO)
  - WIS score badge
  - "Show All Whale Trades" expansion
- **Acceptance Criteria:**
  - [ ] Shows 5 recent trades
  - [ ] Time formatting correct
  - [ ] Colors match side
  - [ ] Expansion works
- **Files to Create:**
  - `components/market-detail-interface/components/whale-activity-feed.tsx`

**Task 5.5: Reduce Price Chart Height (30 min)**
- Modify price chart rendering in main component
- 450px → 350px
- Add view toggle (Line / OHLC / Volume)
- **Acceptance Criteria:**
  - [ ] Height = 350px
  - [ ] Toggle works
  - [ ] Both views render correctly

---

## Day 6: Market Detail Redesign (Part 2)

### Morning Session (9am-12pm): Side-by-Side Charts & Order Book

**Task 6.1: Create Side-by-Side Layout for SII + Signal (1.5 hours)**
- File: `/components/market-detail-interface/components/signal-breakdown-compact.tsx`
- Changes:
  - Resize SII chart: 250px height, 50% width
  - Resize Signal breakdown: 250px height, 50% width
  - Side-by-side on desktop
  - Stacked on mobile
- **Acceptance Criteria:**
  - [ ] Both 250px height
  - [ ] Side-by-side layout
  - [ ] Mobile responsive
  - [ ] Charts readable
- **Files to Create:**
  - `components/market-detail-interface/components/signal-breakdown-compact.tsx`

**Task 6.2: Compact Order Book Section (1.5 hours)**
- File: `/components/market-detail-interface/index.tsx`
- Changes:
  - Show top 5 bid/ask levels
  - "Show Full Order Book" expansion
  - Depth chart: 250px height
  - Tables: compact format
- **Acceptance Criteria:**
  - [ ] Top 5 levels shown
  - [ ] Expansion works
  - [ ] Depth chart 250px
  - [ ] Tables formatted

### Afternoon Session (1pm-5pm): Advanced Analytics & Related Markets

**Task 6.3: Create Advanced Analytics Accordion (2 hours)**
- File: `/components/market-detail-interface/components/advanced-analytics-accordion.tsx`
- Features:
  - 7 collapsible sections
  - Charts load on expansion (lazy)
  - Consistent styling
  - Mobile friendly
- **Sections:**
  1. USD Supply by Wallet Age
  2. Holding Duration Distribution
  3. Whale Concentration Heatmap
  4. PnL Distribution (Treemap)
  5. Unusual Trades
  6. Smart Score Comparison
  7. Trades Explorer
- **Acceptance Criteria:**
  - [ ] All 7 sections present
  - [ ] Collapsed by default
  - [ ] Charts lazy load
  - [ ] Smooth animations
- **Files to Create:**
  - `components/market-detail-interface/components/advanced-analytics-accordion.tsx`

**Task 6.4: Compact Related Markets Section (1 hour)**
- File: `/components/market-detail-interface/index.tsx`
- Changes:
  - Show 3 markets instead of 6
  - Reduce card height by 50%
  - Move to bottom of page
  - Compact information density
- **Acceptance Criteria:**
  - [ ] Only 3 markets shown
  - [ ] Cards half height
  - [ ] At page bottom
  - [ ] All info visible

**Task 6.5: Final Integration & Testing (1 hour)**
- Test complete flow
- Fix any layout issues
- Verify responsive behavior
- Check accessibility
- **Acceptance Criteria:**
  - [ ] No console errors
  - [ ] All links work
  - [ ] Responsive on mobile
  - [ ] Keyboard navigation works
  - [ ] Screen reader friendly

---

## Testing & Quality Assurance (Throughout Sprint)

### Unit Tests (15 min/component)
- Test each new component in isolation
- Mock dependencies
- Test edge cases (empty data, long text, etc.)

### Integration Tests
**End of Day 4:**
- [ ] Wallet Detail loads correctly
- [ ] All expandable sections work
- [ ] Charts render
- [ ] Mobile responsive

**End of Day 6:**
- [ ] Market Detail loads correctly
- [ ] Hero sentiment calculates correctly
- [ ] Progressive disclosure works
- [ ] Advanced analytics lazy load

### E2E Tests
**Final Day:**
- [ ] User can navigate both pages
- [ ] Expand/collapse interactions smooth
- [ ] Charts interactive
- [ ] Mobile gestures work

### Visual Regression Tests
**Final Day:**
- [ ] Screenshot hero sections (desktop)
- [ ] Screenshot compact components (desktop)
- [ ] Screenshot mobile layouts
- [ ] Compare against design specs

---

## Definition of Done

**Component-Level:**
- [ ] Code written and reviewed
- [ ] Unit tests passing (>80% coverage)
- [ ] TypeScript types correct
- [ ] Accessible (ARIA, keyboard)
- [ ] Responsive (mobile tested)
- [ ] Documented (JSDoc comments)

**Page-Level:**
- [ ] All components integrated
- [ ] Realistic dummy data populated
- [ ] Progressive disclosure working
- [ ] Charts sized correctly
- [ ] Mobile layout tested
- [ ] Performance acceptable (<3s load)

**Sprint-Level:**
- [ ] Both pages refactored
- [ ] All acceptance criteria met
- [ ] No critical bugs
- [ ] Stakeholder demo prepared
- [ ] Documentation updated

---

## Risk Mitigation

**Risk: Scope Creep**
- **Mitigation:** Stick to spec, no new features mid-sprint
- **Fallback:** Defer advanced analytics to Day 7-8

**Risk: Component Library Delays**
- **Mitigation:** Build simplest version first, iterate later
- **Fallback:** Use inline components if shared library blocked

**Risk: Data Generation Complex**
- **Mitigation:** Start with simple random, add correlations incrementally
- **Fallback:** Use static mock data if generators fail

**Risk: Mobile Layout Issues**
- **Mitigation:** Test mobile-first from Day 1
- **Fallback:** Desktop-only release, mobile in next sprint

---

## Daily Standup Questions

**Day 1:** "Are shared components building correctly?"
**Day 2:** "Is generated data realistic?"
**Day 3:** "Is Wallet Detail hero section looking good?"
**Day 4:** "Are tables expanding/collapsing smoothly?"
**Day 5:** "Did tabs removal go cleanly?"
**Day 6:** "Are we on track for demo tomorrow?"

---

## Sprint Retrospective (Post-Sprint)

### What Went Well
- [ ] Component reusability
- [ ] Design clarity
- [ ] Pair programming effectiveness

### What Could Improve
- [ ] Estimation accuracy
- [ ] Testing coverage
- [ ] Communication

### Action Items
- [ ] Apply learnings to next sprint
- [ ] Update component library
- [ ] Refine design system

---

## File Structure After Implementation

```
components/
├── ui/
│   ├── metric-card.tsx                 ✅ Day 1
│   ├── sparkline.tsx                   ✅ Day 1
│   ├── collapsible-section.tsx         ✅ Day 1
│   ├── truncated-table.tsx             ✅ Day 1
│   └── truncated-text.tsx              ✅ Day 1
│
├── wallet-detail-interface/
│   ├── index.tsx                       🔄 Day 3-4
│   ├── components/
│   │   ├── hero-metrics.tsx            ✅ Day 3
│   │   ├── compact-trading-dna.tsx     ✅ Day 3
│   │   ├── pnl-ranks-card.tsx          ✅ Day 3
│   │   ├── risk-metrics-compact.tsx    ✅ Day 4
│   │   ├── truncated-positions-table.tsx ✅ Day 4
│   │   ├── category-accordion.tsx      ✅ Day 4
│   │   ├── trading-bubble-chart.tsx    🔄 Day 4
│   │   └── trading-calendar-heatmap.tsx 🔄 Day 4
│   └── types.ts                        (unchanged)
│
├── market-detail-interface/
│   ├── index.tsx                       🔄 Day 5-6
│   ├── components/
│   │   ├── hero-sentiment.tsx          ✅ Day 5
│   │   ├── smart-money-indicator.tsx   ✅ Day 5
│   │   ├── compact-holders-summary.tsx ✅ Day 5
│   │   ├── whale-activity-feed.tsx     ✅ Day 5
│   │   ├── signal-breakdown-compact.tsx ✅ Day 6
│   │   └── advanced-analytics-accordion.tsx ✅ Day 6
│   └── types.ts                        (unchanged)
│
lib/
├── random-utils.ts                     ✅ Day 2
├── name-generators.ts                  ✅ Day 2
├── generate-wallet-profile.ts          ✅ Day 2
├── generate-market-detail.ts           ✅ Day 2
├── validate-wallet-profile.ts          ✅ Day 2
└── validate-market-detail.ts           ✅ Day 2
```

Legend:
- ✅ New file created
- 🔄 Existing file modified
- (unchanged) No changes needed

---

## Summary

This 6-day sprint transforms both Wallet Detail and Market Detail pages from overwhelming, tab-heavy layouts into scannable, progressive-disclosure experiences. By Day 6, users will see:

**Wallet Detail:**
- 66% less scrolling
- Hero metrics above fold
- Compact Trading DNA
- Progressive disclosure everywhere

**Market Detail:**
- No tabs (single scroll)
- Hero sentiment section
- Smart money insights front and center
- Advanced analytics tucked away

All powered by realistic dummy data and reusable, accessible components.
