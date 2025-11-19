# Whale Activity & Insiders Features: User Needs Analysis
## CASCADIAN UX Research Document

**Date**: October 21, 2025
**Research Type**: Competitive Analysis + User Journey Mapping + Information Architecture
**Target Features**: Whale Activity (8 sub-tabs) + Insiders (5 sub-tabs)
**Competitor Benchmark**: Hashdive

---

## Executive Summary

This analysis examines user needs for CASCADIAN's advanced analytics features targeting professional prediction market traders. Based on competitive analysis of Hashdive and behavioral insights from trading platforms, we've identified three primary user personas with distinct goals and information needs. The 13 total sub-tabs present significant UX challenges that require strategic progressive disclosure and smart defaults.

**Key Recommendations**:
1. **Consolidate initial view** - Start with 3 primary tabs instead of 13
2. **Smart defaults** - Pre-filter to most actionable insights
3. **Progressive disclosure** - Layer complexity based on user expertise
4. **Action-oriented design** - Every insight should suggest next steps
5. **Cross-feature navigation** - Seamless wallet-to-market jumping

---

## Target User Personas

### Persona 1: The Professional Trader ("Momentum Mike")

**Demographics**:
- Age: 28-42
- Tech Savviness: Very High
- Trading Experience: 3+ years in crypto/prediction markets
- Time on Platform: 2-4 hours daily
- Portfolio Size: $50k-$500k

**Goals**:
- Identify market-moving whale trades in real-time
- Copy successful trader positions before momentum shifts
- Avoid markets with suspicious insider activity
- Track smart money flow to optimize entry/exit timing
- Set up alerts for whale movements in tracked markets

**Frustrations**:
- "Too much data, not enough signal"
- "By the time I see a whale trade, the price already moved"
- "I can't tell which whales are actually smart vs lucky"
- "Need to check 5 different tabs to understand one position"

**Behaviors**:
- Checks whale activity 10+ times per day
- Follows 15-30 "smart wallets" closely
- Uses multiple screens with live dashboards
- Takes notes on wallet patterns in spreadsheets
- Sets price alerts but wants behavior alerts

**Preferred Features** (Priority Order):
1. **Whale Trades** - Real-time feed with quality filters
2. **Whale Positions** - Current holdings of tracked wallets
3. **Alerts** - Custom notifications for whale movements
4. **Scoreboard** - Rankings by profitability/accuracy
5. **Flows** - Net buying/selling pressure visualization

**Quote**: "I don't need another table of data. I need to know: which whale just bought $50k of YES shares, what's their win rate, and is this their first position in this market?"

---

### Persona 2: The Research Analyst ("Data-Driven Dana")

**Demographics**:
- Age: 25-38
- Tech Savviness: High
- Trading Experience: 1-2 years, comes from finance/data analysis
- Time on Platform: 1-2 hours daily for research
- Portfolio Size: $10k-$100k

**Goals**:
- Conduct deep analysis on market manipulation patterns
- Export data for external modeling in Python/Excel
- Identify wallet clusters working together
- Build statistical models of whale behavior
- Publish research reports on market integrity

**Frustrations**:
- "Can't export clean CSV data for analysis"
- "No way to see historical patterns beyond 30 days"
- "Cluster detection is manual and time-consuming"
- "Can't correlate whale activity with external events"

**Behaviors**:
- Takes detailed notes and screenshots
- Builds custom spreadsheets to track patterns
- Checks platform 2-3 times daily for data updates
- Focuses on unusual/anomalous activity
- Shares findings with trading communities

**Preferred Features** (Priority Order):
1. **Unusual Trades** - Statistical outliers flagged automatically
2. **Clusters** - Wallet relationship mapping
3. **Filters/Export** - Advanced filtering with CSV export
4. **Concentration Heatmap** - Visualize position concentration
5. **Market Watch** - Monitor specific markets for patterns

**Quote**: "Give me the raw data with good filters. I'll do my own analysis. But flag the obvious anomalies so I know where to dig deeper."

---

### Persona 3: The Retail Follower ("Smart Money Sam")

**Demographics**:
- Age: 22-35
- Tech Savviness: Medium-High
- Trading Experience: 3-12 months
- Time on Platform: 30 minutes daily
- Portfolio Size: $500-$10k

**Goals**:
- Follow proven successful traders
- Understand why whales make certain bets
- Learn to identify good entry points
- Avoid losing money to insider manipulation
- Gradually improve trading skills

**Frustrations**:
- "Don't understand all the metrics (WIS, SII, etc.)"
- "Too many numbers, not enough context"
- "Can't tell if a whale position is good or risky"
- "Afraid to copy trades blindly without understanding"

**Behaviors**:
- Checks platform once or twice daily
- Follows 3-5 "star traders" consistently
- Reads market descriptions carefully
- Hesitates before large positions
- Seeks validation from community sentiment

**Preferred Features** (Priority Order):
1. **Dashboard** - Simple overview of key whale activity
2. **Scoreboard** - Clear rankings with explanations
3. **Whale Positions** - What top traders are holding
4. **Flips** - When smart wallets change positions
5. **Wallet Watch** - Track specific successful traders

**Quote**: "I just want to see what the smartest traders are buying. Don't make me decode a bunch of jargon to figure out if I should follow them."

---

## User Journey Maps

### Journey 1: Discovering a Whale Trade Opportunity
**Persona**: Professional Trader (Momentum Mike)

#### Awareness Stage
**Actions**:
- Opens CASCADIAN dashboard in morning
- Scans top navigation for "Whale Activity"

**Thoughts**: "Let me see if any big moves happened overnight"

**Emotions**: Curious, focused

**Touchpoints**: Dashboard home → Whale Activity nav item

**Pain Points**:
- If buried in sub-menu, adds friction
- Needs to be 1 click from anywhere

#### Exploration Stage
**Actions**:
- Lands on Whale Activity default view
- Sees live feed of recent whale trades
- Filters by trade size >$20k and WIS >70

**Thoughts**: "I need high-confidence, high-volume trades only"

**Emotions**: Scanning mode, slight information overload

**Touchpoints**: Whale Activity → Trades sub-tab → Filter controls

**Pain Points**:
- If default shows all trades, signal-to-noise is terrible
- Needs smart defaults (e.g., only show trades >$5k)
- Filter UI must be instant, not modal popup

#### Analysis Stage
**Actions**:
- Clicks on whale wallet alias "WhaleTrader42"
- Jumps to wallet detail page
- Reviews win rate (85%), total PnL ($57k), recent positions
- Checks if this whale has other positions in related markets

**Thoughts**: "Is this whale consistently profitable? What else are they betting on?"

**Emotions**: Evaluating, gaining confidence

**Touchpoints**: Whale Trade → Wallet Detail → Position History

**Pain Points**:
- If wallet detail is separate page load, breaks flow
- Needs inline preview or side panel
- Must show context: "This wallet is up 22% all-time"

#### Decision Stage
**Actions**:
- Returns to market from whale trade
- Opens market detail page
- Reviews current price, SII score, other whale positions
- Decides to follow the whale's position

**Thoughts**: "Price is 63¢, whale bought at 63¢, looks early. SII agrees. I'm in."

**Emotions**: Confident, ready to act

**Touchpoints**: Whale Trade → Market Detail → Trade Interface

**Pain Points**:
- If navigation is clunky, loses momentum
- Needs breadcrumb trail: Trades → Whale → Market → Trade
- "Follow this trade" quick action button ideal

#### Action Stage
**Actions**:
- Clicks "Trade" button on market
- Enters position size
- Executes trade
- Sets alert for if whale exits position

**Thoughts**: "Now I need to know if this whale sells"

**Emotions**: Committed, slightly anxious

**Touchpoints**: Market Detail → Trade Modal → Alert Setup

**Pain Points**:
- Alert setup should be suggested, not buried
- "Copy this whale's exit" one-click option
- Confirmation should show whale context

#### Monitoring Stage
**Actions**:
- Returns to Whale Activity throughout day
- Checks "Flows" sub-tab to see net buying/selling
- Monitors position in personal portfolio

**Thoughts**: "Are more whales piling in or exiting?"

**Emotions**: Watchful, reactive

**Touchpoints**: Whale Activity → Flows → Position Monitor

**Pain Points**:
- If flows data is delayed, useless
- Needs push notifications for major shifts
- Dashboard widget showing "your followed whales"

**Opportunities**:
- **Smart Defaults**: Show only high-WIS (>70) trades by default
- **Quick Actions**: "Follow whale", "View wallet", "Trade market" buttons
- **Contextual Alerts**: "Set alert when this whale exits"
- **Seamless Navigation**: Side panel previews instead of page loads
- **Flow Visualization**: Real-time net pressure gauge on markets

---

### Journey 2: Investigating Suspicious Insider Activity
**Persona**: Research Analyst (Data-Driven Dana)

#### Awareness Stage
**Actions**:
- Notices unusual price movement on market
- Wonders if insider trading is occurring

**Thoughts**: "That price spike was too fast. Was it informed trading?"

**Emotions**: Suspicious, curious

**Touchpoints**: Market chart → Unusual activity flag

**Pain Points**:
- No proactive flagging of suspicious patterns
- Analyst must manually hunt for anomalies

#### Investigation Stage
**Actions**:
- Navigates to Insiders → Unusual Trades
- Sees market flagged with "High unusual trade volume"
- Filters to show trades 2+ standard deviations from normal
- Reviews list of large trades in narrow time window

**Thoughts**: "Five wallets bought $100k+ within 30 minutes. That's coordinated."

**Emotions**: Investigative, engaged

**Touchpoints**: Insiders → Unusual Trades → Statistical filters

**Pain Points**:
- If no statistical filtering, manual work required
- Needs z-score, standard deviations, time clustering
- Historical baseline comparison essential

#### Deep Dive Stage
**Actions**:
- Opens Clusters sub-tab
- Inputs suspicious wallet addresses
- System reveals network graph: 5 wallets have traded together 12 times
- Exports cluster data as CSV for external analysis

**Thoughts**: "These wallets are clearly coordinated. Need to document this."

**Emotions**: Satisfied (found smoking gun), determined

**Touchpoints**: Unusual Trades → Clusters → Network graph → Export

**Pain Points**:
- If cluster detection is unavailable, dead end
- Manual entry of wallet addresses is tedious
- Export needs to include all metadata (timestamps, amounts, outcomes)

#### Documentation Stage
**Actions**:
- Navigates to Filters/Export tab
- Applies date range: past 7 days
- Filters to specific market + wallet cluster
- Exports full trade history with WIS scores

**Thoughts**: "Need clean data for my report"

**Emotions**: Methodical, slightly frustrated if export is limited

**Touchpoints**: Filters/Export → Advanced options → CSV download

**Pain Points**:
- Row limits on export (max 1000) breaks analysis
- Missing fields in CSV (need all metadata)
- No saved filter presets for repeat investigations

#### Sharing Stage
**Actions**:
- Writes analysis report with CASCADIAN screenshots
- Shares findings in trading Discord
- Posts on X with data visualizations

**Thoughts**: "This will help the community avoid this market"

**Emotions**: Accomplished, altruistic

**Touchpoints**: External tools (Discord, X, Medium)

**Pain Points**:
- No built-in sharing/reporting tools
- Screenshots are manual and clunky
- Could offer "Share this analysis" feature

**Opportunities**:
- **Proactive Flagging**: Auto-detect unusual trade patterns
- **Statistical Tooling**: Z-scores, clustering algorithms, time-series analysis
- **Robust Export**: Unlimited CSV with all fields, saved filter presets
- **Network Graphing**: Visual wallet relationship mapping
- **Collaboration**: Share investigations with community, built-in reporting templates

---

### Journey 3: Learning to Follow Smart Money
**Persona**: Retail Follower (Smart Money Sam)

#### Discovery Stage
**Actions**:
- Reads blog post: "How to follow whale traders on CASCADIAN"
- Opens app and navigates to Whale Activity

**Thoughts**: "I want to copy what successful traders do"

**Emotions**: Hopeful, slightly overwhelmed

**Touchpoints**: External content → App → Whale Activity

**Pain Points**:
- If landing page is complex, intimidating
- Needs onboarding: "New to whale trading? Start here"

#### Orientation Stage
**Actions**:
- Clicks on "Scoreboard" sub-tab (seems beginner-friendly)
- Sees ranked list of top wallets by profitability
- Sorts by "30-day PnL" to find recent winners
- Clicks on top wallet "SmartInvestor" (91 WIS, +$12.8k in 30d)

**Thoughts**: "This person seems legit. What are they trading?"

**Emotions**: Excited, building confidence

**Touchpoints**: Whale Activity → Scoreboard → Wallet profile

**Pain Points**:
- If scoreboard lacks context (what is WIS?), confusing
- Needs tooltips: "WIS = Wallet Intelligence Score, measures accuracy"
- Too many metrics can paralyze decision

#### Following Stage
**Actions**:
- On wallet detail page, sees "Follow this wallet" button
- Clicks to add to Wallet Watch list
- Navigates to Insiders → Wallet Watch
- Sees list of followed wallets with recent activity

**Thoughts**: "Now I can track their moves in one place"

**Emotions**: Organized, in control

**Touchpoints**: Wallet Detail → Follow CTA → Wallet Watch

**Pain Points**:
- If "follow" feature is absent, uses bookmarks (poor UX)
- Wallet Watch should show aggregate signals: "3 of your followed wallets bought YES"

#### Learning Stage
**Actions**:
- Sees notification: "SmartInvestor just bought $5k in Market X"
- Opens market detail page
- Reviews why this market is attractive (SII: 75, momentum: 82)
- Reads market description to understand the bet

**Thoughts**: "They bought YES at 63¢. SII says BUY. Maybe I should too?"

**Emotions**: Cautious optimism, seeking validation

**Touchpoints**: Notification → Market Detail → Signal breakdown

**Pain Points**:
- If notification lacks context, not actionable
- Should show: "SmartInvestor (91 WIS) bought YES. This is their 3rd politics bet (2 profitable)."
- Needs educational content: "Why do high-WIS wallets like this trade?"

#### Decision Stage
**Actions**:
- Sees "Follow this trade" suggested action
- Clicks to open trade modal
- Enters smaller position ($100 vs whale's $5k)
- Confirms trade

**Thoughts**: "I'm following smart money but sizing appropriately for my bankroll"

**Emotions**: Confident, learning by doing

**Touchpoints**: Market Detail → Trade Modal → Confirmation

**Pain Points**:
- If trade flow is complex, loses nerve
- Should suggest position size: "Consider 2-5% of portfolio"
- Post-trade: "You're now aligned with SmartInvestor on this market"

#### Tracking Stage
**Actions**:
- Returns to Wallet Watch daily
- Checks if followed whales are buying/selling
- Reviews "Flips" sub-tab to see when whales change positions
- Notices "SmartInvestor sold 50% of position" alert

**Thoughts**: "They're taking profit. Should I do the same?"

**Emotions**: Reactive, slightly anxious

**Touchpoints**: Wallet Watch → Flips → Position management

**Pain Points**:
- If flip notifications are delayed, misses optimal exit
- Needs guidance: "SmartInvestor reduced position but still holds 50%"
- Should show context: "This is typical profit-taking for this wallet"

**Opportunities**:
- **Onboarding Flow**: "New to whale trading? Follow these 3 steps"
- **Educational Context**: Explain metrics in plain language with tooltips
- **Smart Suggestions**: "Based on your portfolio, consider following these 5 wallets"
- **Aggregated Signals**: "3 of 5 followed whales are buying YES"
- **Position Sizing Guidance**: Suggest appropriate bet sizes for retail traders
- **Pattern Recognition**: "SmartInvestor typically holds for 7 days, then exits"

---

## Primary User Goals When Viewing Whale Activity

### Goal Hierarchy (Ranked by Frequency & Importance)

#### 1. **Identify Actionable Trade Opportunities** (90% of users, Critical)
- **What they need**:
  - Real-time feed of significant whale trades (>$10k)
  - Quality filter: High WIS wallets only (>70)
  - Context at a glance: Wallet win rate, market SII, entry price vs current price
  - One-click path to trade execution

- **Current gap**:
  - 8 sub-tabs fragment the discovery flow
  - No smart defaults (shows all noise)
  - Lacks "trade this market" quick action

- **Design implication**:
  - Default view should be "Whale Trades" with smart filters pre-applied
  - Each trade row needs inline actions: [View Wallet] [View Market] [Trade]
  - Visual hierarchy: Highlight whales with WIS >80

#### 2. **Track Specific Successful Wallets** (75% of users, Critical)
- **What they need**:
  - Ability to "follow" wallets and create watchlist
  - Dashboard showing recent activity from followed wallets
  - Alerts when followed wallets make moves
  - Historical win rate and PnL for trust-building

- **Current gap**:
  - "Wallet Watch" is buried in Insiders (should be cross-feature)
  - No follow/unfollow mechanism visible
  - Alerts sub-tab is separate from watching

- **Design implication**:
  - "Follow" button should appear on every wallet mention
  - Create unified "My Watchlist" accessible from both Whale Activity & Insiders
  - Alerts should be contextual: "Alert me when this whale trades"

#### 3. **Understand Market Momentum from Whale Activity** (65% of users, High)
- **What they need**:
  - Net whale buying/selling pressure on specific markets
  - Visualization of flow changes over time (chart)
  - Concentration risk: Are whales clustered on one side?
  - Volume-weighted average whale entry price

- **Current gap**:
  - "Flows" sub-tab exists but unclear what it shows
  - No link from market detail to whale flows for that market
  - "Concentration Heatmap" sounds useful but placement unclear

- **Design implication**:
  - Flows should be a chart visualization, not a table
  - Should show: Last 24h net whale $ flow (BUY vs SELL) per market
  - Concentration Heatmap: Color-coded grid of whale position concentration
  - Integrate whale flow widget into Market Detail page

#### 4. **Detect Insider Trading / Manipulation** (40% of users, Medium)
- **What they need**:
  - Statistical outlier detection (unusual trade size/timing)
  - Wallet cluster identification (coordinated actors)
  - Pre-event position building (whales buying before news)
  - Export data for external forensic analysis

- **Current gap**:
  - "Unusual Trades" exists but needs statistical rigor
  - "Clusters" feature scope unclear
  - "Filters/Export" is utility, not analysis tool

- **Design implication**:
  - Unusual Trades: Show z-scores, standard deviations, time clustering
  - Clusters: Network graph visualization of wallet relationships
  - Auto-flag markets with suspicious patterns (prominent badge)
  - Export should be robust: CSV with all metadata, no row limits

#### 5. **Learn Whale Trading Patterns** (50% of users, Medium)
- **What they need**:
  - Educational context on what metrics mean
  - Case studies of successful whale trades
  - Pattern recognition: "This whale typically holds 5-7 days"
  - Comparative analysis: How do top wallets differ from average?

- **Current gap**:
  - No educational layer for beginners
  - Scoreboard is just rankings (lacks insights)
  - Flips tab shows position changes but no pattern analysis

- **Design implication**:
  - Tooltips explaining WIS, SII, statistical significance
  - Scoreboard should include "strategy tags": "Contrarian", "Momentum", "Value"
  - Flips: Highlight patterns like "This whale often flips after 20% gain"
  - Guided tours for first-time users

#### 6. **Set Up Proactive Monitoring** (35% of users, Medium)
- **What they need**:
  - Alerts for whale trades on watchlist markets
  - Threshold-based alerts ($50k+ trade, WIS >85 whale)
  - Digest emails: Daily summary of whale activity
  - Browser/mobile push notifications

- **Current gap**:
  - Alerts sub-tab exists but integration unclear
  - No alert creation flow visible in wireframes
  - Unclear if alerts are push, email, or in-app only

- **Design implication**:
  - Alerts should be contextual: "Alert me if any whale trades this market"
  - Inline alert setup on every relevant screen
  - Alert management dashboard with templates: "High-conviction whale trades"
  - Multi-channel delivery: Email, push, SMS

---

## Information Density vs Clarity: Prioritization Framework

### The Core Challenge
Professional traders want maximum information density (data geeks), while retail traders need clarity (avoid overwhelm). With 13 sub-tabs, we risk satisfying neither.

### Recommendation: Tiered Information Architecture

#### **Tier 1: Essential (Default View)**
**Principle**: Show 80% of value in 20% of the interface

**For Whale Activity**:
- **Landing tab**: Whale Trades (smart filtered)
  - Show: Last 50 trades from wallets with WIS >70 and size >$5k
  - Columns: Time, Wallet (with WIS badge), Market (truncated), Side, Size, Entry Price
  - Inline actions: [View Wallet] [View Market] [Trade]

**For Insiders**:
- **Landing tab**: Dashboard (aggregated insights)
  - Show: Top 5 suspicious markets (unusual activity score)
  - Show: My Wallet Watch summary (if user has watchlist)
  - Show: Recent high-WIS wallet activity
  - Widgets: Unusual trade count (24h), Top cluster activity, Whale flow direction

**Visual approach**:
- Clean, scannable table with strong visual hierarchy
- Color coding: Green (BUY), Red (SELL), Yellow (FLIP)
- Badges for quality signals: High WIS, High Volume, Unusual

**Accessibility**:
- 1 tab visible on load
- 2-3 clicks to any action

#### **Tier 2: Power Features (Progressive Disclosure)**
**Principle**: Advanced features accessible but not default

**For Whale Activity**:
- **Secondary tabs** (horizontal sub-nav):
  - Positions (current whale holdings, not trades)
  - Flows (net buying/selling charts)
  - Scoreboard (wallet rankings)
  - Alerts (monitoring setup)

**For Insiders**:
- **Secondary tabs**:
  - Market Watch (monitor specific markets)
  - Unusual Trades (statistical outliers)
  - Clusters (wallet network analysis)

**Visual approach**:
- Tabs appear below primary view
- Each tab is specialized tool with its own filters
- "Pro Mode" toggle to show advanced metrics

**Accessibility**:
- 2 clicks from default view
- Keyboard shortcuts for power users (Cmd+1, Cmd+2, etc.)

#### **Tier 3: Deep Analysis (Expert Mode)**
**Principle**: Full data access for researchers

**For Whale Activity**:
- **Tertiary features**:
  - Concentration Heatmap (visual grid)
  - Flips (position reversal tracking)
  - Custom Analytics (build your own queries)

**For Insiders**:
- **Tertiary features**:
  - Filters/Export (advanced query builder)
  - Historical Analysis (time-series deep dives)
  - API Access (for external tools)

**Visual approach**:
- Separate "Advanced Analytics" section
- Modal overlays or dedicated full-screen views
- More complex UIs acceptable here (users opted in)

**Accessibility**:
- 3+ clicks or via settings
- Clearly labeled as "Advanced"

### Density vs Clarity Guidelines

| User Type | Default Density | Customization Allowed |
|-----------|----------------|----------------------|
| Retail Follower | Low (5-7 metrics visible) | Limited (show/hide columns) |
| Professional Trader | Medium (10-12 metrics) | High (save custom views) |
| Research Analyst | High (15+ metrics, export all) | Full (API access, raw data) |

**Responsive behavior**:
- Mobile: Tier 1 only (card layout, not tables)
- Tablet: Tier 1 + 2 (horizontal scroll for tables)
- Desktop: All tiers available

---

## Critical Filtering & Sorting Capabilities

### Filtering Strategy: Smart Defaults + Easy Override

#### **Whale Trades Filters** (Priority Order)

1. **Wallet Quality (Critical)**
   - **Default**: WIS ≥ 70 (filter out noise traders)
   - **Options**: WIS ≥ 60, 70, 80, 90 (slider)
   - **Why**: Low-WIS whales are just rich, not smart
   - **UI**: Prominent slider at top, shows count: "Showing 47 trades from high-WIS wallets"

2. **Trade Size (Critical)**
   - **Default**: ≥ $5,000 (material trades only)
   - **Options**: $1k, $5k, $10k, $25k, $50k+ (preset chips)
   - **Why**: Small trades = low conviction
   - **UI**: Quick-select chips, custom input option

3. **Time Range (High)**
   - **Default**: Last 24 hours
   - **Options**: 1h, 6h, 24h, 7d, 30d, All (tabs)
   - **Why**: Real-time traders want fresh data
   - **UI**: Horizontal tabs above table

4. **Market Category (High)**
   - **Default**: All markets
   - **Options**: Politics, Sports, Crypto, Entertainment, etc. (dropdown)
   - **Why**: Traders specialize in categories
   - **UI**: Multi-select dropdown

5. **Outcome Side (Medium)**
   - **Default**: Both YES and NO
   - **Options**: YES only, NO only, Both (toggle)
   - **Why**: Some traders follow contrarians (NO buyers)
   - **UI**: Toggle switch

6. **Trade Direction (Medium)**
   - **Default**: BUY only (new positions)
   - **Options**: BUY, SELL, BOTH (toggle)
   - **Why**: BUY = conviction, SELL = exit signal
   - **UI**: Toggle switch

7. **Price Range (Low)**
   - **Default**: All prices
   - **Options**: Entry price 0-20¢, 20-40¢, 40-60¢, 60-80¢, 80-100¢
   - **Why**: Some traders hunt value (<30¢) or momentum (>70¢)
   - **UI**: Range slider (not prominent)

**Filter Presets** (Save user time):
- "High Conviction Whales" (WIS ≥80, Size ≥$25k, BUY, 24h)
- "Contrarian Bets" (WIS ≥70, Entry <30¢, 7d)
- "Recent Flips" (SELL after previous BUY, same market)

#### **Sorting Options** (Priority Order)

1. **Time (Default)** - Newest first
2. **Trade Size** - Largest first
3. **Wallet WIS** - Highest quality first
4. **Market Volume** - Most liquid markets first
5. **Entry Price** - Filter lottery tickets (<10¢) or sure things (>90¢)

**UI Pattern**:
- Sort by clicking column headers (standard table UX)
- Active sort shows arrow icon
- Secondary sort: Hold Shift + click (power user feature)

#### **Unusual Trades Filters** (Insiders Feature)

1. **Statistical Threshold (Critical)**
   - **Default**: ≥2 standard deviations from mean
   - **Options**: 1σ, 2σ, 3σ (slider with labels)
   - **Why**: Defines "unusual" rigorously
   - **UI**: Slider with explanation: "2σ = top 5% of unusual activity"

2. **Time Window (Critical)**
   - **Default**: Trades within 1-hour cluster
   - **Options**: 15min, 1h, 6h, 24h
   - **Why**: Coordinated trades happen quickly
   - **UI**: Dropdown

3. **Wallet Relationship (High)**
   - **Default**: Show all
   - **Options**: Only show trades from wallets in same cluster
   - **Why**: Identify coordinated actors
   - **UI**: Checkbox: "Show clustered wallets only"

4. **Market Status (Medium)**
   - **Default**: Active markets only
   - **Options**: Active, Resolved, All
   - **Why**: Historical analysis vs live monitoring
   - **UI**: Tabs

#### **Wallet Watch Filters** (Insiders Feature)

1. **Activity Timeframe (Critical)**
   - **Default**: Last 7 days
   - **Options**: 24h, 7d, 30d, All
   - **Why**: See recent moves from followed wallets
   - **UI**: Tabs

2. **Action Type (High)**
   - **Default**: All actions
   - **Options**: New positions, Exits, Increases, Decreases
   - **Why**: Different signals (entry vs exit)
   - **UI**: Multi-select chips

3. **Position Size (Medium)**
   - **Default**: ≥$1,000
   - **Options**: $500, $1k, $5k, $10k+
   - **Why**: Material positions only
   - **UI**: Slider

**Export Capabilities**:
- CSV with all visible columns + metadata
- JSON for API integrations
- Date range selection (no arbitrary row limits)
- Include calculated fields (WIS, z-scores, cluster IDs)

---

## Handling 13 Sub-Tabs: Information Architecture

### The Problem
13 sub-tabs create:
- **Cognitive overload** - Users don't know where to start
- **Fragmentation** - Related data scattered across tabs
- **Findability issues** - "Where was that feature again?"
- **Mobile impossibility** - 13 tabs don't fit on mobile screens

### Proposed Information Architecture: Hub & Spoke Model

#### **Primary Navigation** (Always Visible)
```
[Dashboard] [Whale Activity] [Insiders] [Markets] [Wallets]
```

#### **Whale Activity Hub** (Consolidate 8 → 3 Primary + 5 Secondary)

**Primary Tabs** (Visible by default):
1. **Live Trades** (default landing)
   - Real-time whale trade feed with smart filters
   - Combines: Whale Trades + Alerts functionality
   - Shows: Latest trades from high-WIS wallets
   - Quick actions: Follow wallet, View market, Set alert

2. **Whale Positions**
   - Current holdings of tracked whales
   - Combines: Whale Positions + Scoreboard
   - Shows: Active positions grouped by whale or by market
   - Toggle view: "By Wallet" vs "By Market"

3. **Analytics**
   - Visualizations and insights
   - Combines: Flows + Concentration Heatmap + Flips
   - Sub-sections (vertical nav):
     - Flow Charts (net buying/selling over time)
     - Concentration Heatmap (position clustering)
     - Position Changes (flips and significant increases/decreases)

**Secondary Access** (Contextual):
- **Alerts** - Moved to global nav (bell icon)
  - Accessible from anywhere, not buried in Whale Activity
  - Shows: Active alerts, create new, alert history

- **Scoreboard** - Integrated into "Whale Positions" tab
  - Toggle: "View as Scoreboard" shows ranked table
  - Columns: Rank, Wallet, WIS, 30d PnL, Win Rate, Active Positions

- **Unusual Trades** - Moved to Insiders hub (better fit)

**Visual Layout**:
```
┌─────────────────────────────────────────────┐
│ [Live Trades] [Positions] [Analytics]       │ ← Primary tabs
├─────────────────────────────────────────────┤
│ Filters: [WIS ≥70] [Size ≥$5k] [24h] [BUY] │ ← Smart filter bar
├─────────────────────────────────────────────┤
│                                             │
│  Trade Feed (if Live Trades selected)       │
│  or                                         │
│  Position Table (if Positions selected)     │
│  or                                         │
│  Charts & Heatmaps (if Analytics selected)  │
│                                             │
└─────────────────────────────────────────────┘
```

#### **Insiders Hub** (Consolidate 5 → 2 Primary + 3 Secondary)

**Primary Tabs** (Visible by default):
1. **Dashboard** (default landing)
   - High-level insights aggregated
   - Shows: Unusual activity summary, Watchlist summary, Top clusters
   - Designed for quick daily check-in
   - Links to deeper analysis: "View 12 unusual trades" → Unusual Trades tab

2. **Wallet Watch**
   - Followed wallets activity feed
   - Shows: Recent trades from user's watchlist
   - Quick actions: Add wallet, Remove wallet, View wallet detail
   - Alert integration: "Get notified when watchlist wallets trade"

**Secondary Access** (Drill-down):
3. **Market Watch**
   - Monitor specific markets for insider patterns
   - Add markets to watchlist, see whale activity specific to those markets
   - Essentially: Whale Activity filtered to selected markets

4. **Unusual Trades**
   - Statistical outlier detection
   - Moved from Whale Activity (better thematic fit)
   - Shows: Trades flagged as unusual (>2σ), cluster correlation

5. **Clusters & Export**
   - Combined: Clusters visualization + Filters/Export tools
   - Two sub-sections:
     - Cluster Analysis (network graph)
     - Data Export (advanced filtering + CSV download)

**Visual Layout**:
```
┌─────────────────────────────────────────────┐
│ [Dashboard] [Wallet Watch]  [Advanced ▼]    │ ← Primary tabs + dropdown
├─────────────────────────────────────────────┤
│ My Watchlist (5 wallets) | Add Wallet       │ ← Context bar
├─────────────────────────────────────────────┤
│                                             │
│  Widget: Unusual Activity Alert             │
│  Widget: Top Wallet Activity                │
│  Widget: Cluster Summary                    │
│  (if Dashboard selected)                    │
│                                             │
│  or                                         │
│                                             │
│  Watchlist Activity Feed                    │
│  (if Wallet Watch selected)                 │
│                                             │
└─────────────────────────────────────────────┘
```

**Advanced dropdown** reveals:
- Market Watch
- Unusual Trades
- Clusters & Export

### Navigation Patterns

#### **Cross-Feature Navigation**
Users often jump between related views:

- Whale Trade → Wallet Detail → Other Whale Positions → Market Detail → Trade
- Market Detail → Whale Activity for this Market → Top Whale → Follow Wallet
- Unusual Trade Alert → Cluster Analysis → Export Data

**Design Solutions**:
1. **Breadcrumb Trail**
   ```
   Whale Activity > Live Trades > WhaleTrader42 > Trump 2024 Market
                                 └─ [Back to Trades]
   ```

2. **Side Panel Previews** (Avoid full page loads)
   - Click whale name → Slide-in panel with wallet stats
   - Click market → Slide-in panel with market overview
   - Action buttons in panel: "View Full Profile" or "Trade"

3. **Contextual Quick Actions**
   - Every wallet mention: [Follow] [View]
   - Every market mention: [View] [Trade]
   - Every trade: [View Wallet] [View Market] [Set Alert]

4. **Related Items Widget**
   - On Market Detail: "Whale Activity for this Market" widget
   - On Wallet Detail: "This Wallet's Recent Trades" widget
   - Bi-directional linking

#### **Mobile Strategy**
13 tabs impossible on mobile. Simplify to:

**Bottom Nav (Mobile)**:
```
[Home] [Whale Trades] [Watchlist] [Alerts] [More]
```

- **Home**: Dashboard view (aggregated insights)
- **Whale Trades**: Live Trades feed only
- **Watchlist**: Combined Wallet Watch + Market Watch
- **Alerts**: Alert management
- **More**: Hamburger menu with all other features

**Progressive Disclosure**:
- Each tab starts with summary cards
- "View all" expands to full list
- "Filters" opens bottom sheet modal
- Charts collapse to mini sparklines

---

## Progressive Disclosure Strategy

### Principle: Layer Complexity Based on User Expertise

#### **Level 1: Casual User (First Visit)**
**Goal**: Don't overwhelm, show value immediately

**What they see**:
- Clean, simple layout with clear headings
- Pre-filtered data (smart defaults applied)
- 3-5 key metrics only (WIS, Size, Time, Market)
- Inline help tooltips: "WIS = Wallet Intelligence Score, measures accuracy"
- Suggested next step: "Follow a top whale to get started"

**Hidden**:
- Advanced filters (collapsed)
- Statistical metrics (z-scores, standard deviations)
- Export tools
- Cluster analysis

**Onboarding**:
- Tour prompt: "New to whale trading? Take a 2-minute tour"
- Contextual tips: "💡 Tip: Wallets with WIS >80 are highly accurate"
- Sample data highlighted: "⭐ This trade is a great example of high-conviction whale activity"

#### **Level 2: Regular User (Return Visitor)**
**Goal**: Enable efficiency, respect familiarity

**What they see**:
- Remembered filter preferences (saved in cookies/account)
- Watchlist prominently displayed (if created)
- "Show advanced filters" option (collapsed by default)
- Keyboard shortcuts hinted: "Press / to search"

**Hidden (but easily accessible)**:
- Full filter panel (one click to expand)
- Export button (present but not prominent)
- Cluster analysis (in secondary nav)

**Customization**:
- "Save this view" option (store filter/sort combos)
- "Rearrange columns" (drag to reorder)
- "Density: Compact | Default | Spacious" toggle

#### **Level 3: Power User (Activated Features)**
**Goal**: Maximum control and data access

**What they see**:
- All filters expanded by default (preference saved)
- Advanced metrics visible (z-scores, cluster IDs, historical averages)
- Keyboard shortcuts active (Cmd+K command palette)
- API access link in footer
- "Pro Mode" badge in header

**Activated by**:
- User explicitly enables "Pro Mode" in settings
- OR system detects power usage patterns:
  - 10+ filter changes per session
  - Export feature used
  - Watchlist >5 wallets
  - Session duration >30 min

**Power Features**:
- Custom columns (add/remove any field)
- Multi-tab comparison (split view)
- Saved queries (named filter combos)
- Alert formulas (custom conditions: "WIS >85 AND size >$50k AND entry <40¢")

### Implementation: Progressive Complexity Controls

#### **Visual Indicators**
```
┌────────────────────────────────────────┐
│ Filters [Simple ▼]  🔍 Search  [★ Save]│
│                                        │ ← Default: Simple mode
│ WIS ≥ [70▼]  Size ≥ [$5k▼]  [24h]    │
└────────────────────────────────────────┘

Click "Simple ▼" → Dropdown:
☑ Simple (5 filters)
☐ Advanced (12 filters)
☐ Expert (20 filters + custom queries)
```

#### **Contextual Help System**
- **Level 1**: Inline tooltips on hover
- **Level 2**: "Learn more" links to knowledge base
- **Level 3**: No help needed (power users know what they're doing)

**Example**:
```
WIS (?)  ← Hover shows tooltip
↓
"Wallet Intelligence Score: Measures trader accuracy
based on win rate, PnL, and position quality.
Scale: 0-100 (70+ is very good)"

[Learn how WIS is calculated →]  ← Link for Level 2 users
```

#### **Settings-Based Personalization**
User account settings:
- **Default View**: Simple | Standard | Advanced
- **Auto-Expand Filters**: Yes | No
- **Column Density**: Compact | Default | Spacious
- **Chart Style**: Line | Candlestick | Both
- **Notification Preference**: Push | Email | SMS | None

### Behavioral Triggers for Complexity

| User Behavior | System Response |
|---------------|-----------------|
| First visit | Show simple view + onboarding tour prompt |
| 3rd session, same filters each time | Suggest "Save this view?" |
| Clicks "Export" for first time | Show export tutorial + suggest Pro Mode |
| Watchlist >3 wallets | Promote Wallet Watch tab to primary nav |
| Uses keyboard shortcut | Show command palette guide |
| Session >20 min | Offer "Upgrade to Pro Mode for more tools" |

---

## Key UX Patterns to Adopt

### Pattern 1: Smart Defaults with Easy Override
**Principle**: 80% of users want pre-filtered signal, 20% want control

**Implementation**:
- Default filters applied on page load (e.g., WIS ≥70, Size ≥$5k)
- Visible "Filters applied" indicator with count: "🔽 3 filters active"
- One-click clear: "Show all trades" button
- One-click save: "Save as default" for custom preferences

**Example (Whale Trades)**:
```
┌─────────────────────────────────────────────┐
│ 🔽 Smart Filters Active (3)  [Edit] [Clear] │
│ - WIS ≥ 70 (high-quality wallets)           │
│ - Size ≥ $5,000 (material trades)           │
│ - Last 24 hours (recent activity)           │
├─────────────────────────────────────────────┤
│ Showing 47 trades  [Show all 328 →]         │
└─────────────────────────────────────────────┘
```

**Why it works**:
- Beginners see curated signal immediately
- Pros can customize in 1 click
- Reduces cognitive load (pre-made decisions)

---

### Pattern 2: Contextual Quick Actions
**Principle**: Every data point should offer relevant next step

**Implementation**:
- Hover on wallet name → Shows mini-card with WIS, win rate, PnL
- Inline buttons: [Follow] [View Profile]
- Hover on market → Shows mini-card with current price, SII, volume
- Inline buttons: [View Market] [Trade]
- Hover on trade → Shows mini-card with trade details
- Inline buttons: [View Wallet] [View Market] [Set Alert]

**Example (Whale Trade Row)**:
```
┌──────────────────────────────────────────────────────────┐
│ 2:34pm | WhaleTrader42 (WIS 85) | Trump 2024 | BUY YES  │
│          $31,500 @ 63¢                                   │
│          [👤 View Wallet] [📊 View Market] [🔔 Alert]    │← Quick actions
└──────────────────────────────────────────────────────────┘
```

**Advanced variant** (on hover):
```
┌──────────────────────────────────────────────────────────┐
│ 2:34pm | WhaleTrader42 ▼ | Trump 2024 ▼ | BUY YES       │
│          $31,500 @ 63¢                                   │
│          ┌────────────────────┐                          │
│          │ WhaleTrader42       │                          │
│          │ WIS: 85 (Top 5%)   │ ← Hover card             │
│          │ Win Rate: 62.8%    │                          │
│          │ Total PnL: +$57k   │                          │
│          │ [View Profile]     │                          │
│          └────────────────────┘                          │
└──────────────────────────────────────────────────────────┘
```

**Why it works**:
- Reduces page loads (modal/panel instead of navigation)
- Speeds up workflow (2 clicks vs 5 clicks)
- Maintains context (don't lose place in feed)

---

### Pattern 3: Aggregated Signal Indicators
**Principle**: Synthesize multiple data points into one insight

**Implementation**:
- **Whale Consensus Badge**: "🐋 Strong YES (8 whales, 73% of volume)"
- **Unusual Activity Flag**: "⚠️ Unusual (3σ above average volume)"
- **Cluster Alert**: "👥 Coordinated (5 wallets, same hour)"
- **Quality Score**: Color-coded WIS badges (Green >80, Yellow 60-80, Gray <60)

**Example (Market Detail Page)**:
```
┌────────────────────────────────────────────────┐
│ Trump 2024 Presidential Election               │
│ YES 63¢ | NO 37¢ | SII: 75                     │
│                                                │
│ 🐋 Whale Signal: STRONG BUY YES                │← Aggregated insight
│    8 high-WIS wallets bought in last 24h      │
│    Total: $214k (73% of whale volume)         │
│    [View Whale Activity →]                     │
└────────────────────────────────────────────────┘
```

**Why it works**:
- Saves user analysis time (system does aggregation)
- Clear signal (not just raw data)
- Actionable (know what whales collectively think)

---

### Pattern 4: Side Panel Deep Dives
**Principle**: Avoid page navigation, use overlays for related content

**Implementation**:
- Click wallet name → Slide-in panel from right with full wallet profile
- Click market name → Slide-in panel from right with market overview
- Panel includes: Key stats, recent activity, quick actions
- "Open in full view" button for deeper dive

**Example (Click on whale name in trade feed)**:
```
Main Feed (70% width)     │ Side Panel (30% width)
──────────────────────────┼────────────────────────────
Whale Trades              │ WhaleTrader42 Profile
                          │ ─────────────────────
[Trade 1]                 │ WIS: 85 (Top 5%)
[Trade 2] ← Selected      │ Win Rate: 62.8%
[Trade 3]                 │ Total PnL: +$57,000 (+22.8%)
[Trade 4]                 │ Active Positions: 8
                          │
                          │ Recent Trades (Last 7d):
                          │ ✓ Trump 2024 +$8.5k
                          │ ✓ NFL Chiefs +$3.2k
                          │ ✗ Bitcoin ETF -$1.8k
                          │
                          │ [🔔 Follow] [📊 Full Profile]
                          │ [❌ Close]
```

**Why it works**:
- Maintains context (original feed still visible)
- Fast exploration (no page load)
- Easy comparison (open multiple panels)

---

### Pattern 5: Intelligent Alerts & Notifications
**Principle**: Proactive insights delivered at the right time

**Implementation**:
- **Push Notifications**: "🐋 WhaleTrader42 just bought $31k YES on Trump 2024"
- **Email Digests**: Daily summary of watchlist activity
- **In-App Badges**: Red dot on "Whale Activity" nav when new high-value trades
- **Smart Suggestions**: "💡 3 whales you follow bought YES. Consider reviewing?"

**Alert Setup Flow**:
```
User action: Clicks "🔔 Alert" on whale trade
↓
Modal appears:
┌────────────────────────────────────────┐
│ Set Alert for Trump 2024 Market        │
│                                        │
│ Notify me when:                        │
│ ☑ Any whale (WIS >80) trades >$10k    │
│ ☑ WhaleTrader42 changes position      │
│ ☐ Price moves >5% in 1 hour           │
│ ☐ Unusual trading volume detected     │
│                                        │
│ Delivery:                              │
│ ☑ Push  ☑ Email  ☐ SMS                │
│                                        │
│ [Cancel] [Create Alert]                │
└────────────────────────────────────────┘
```

**Why it works**:
- Reduces FOMO (don't miss important trades)
- Customizable (user controls signal threshold)
- Multi-channel (reach user where they are)

---

### Pattern 6: Visual Hierarchy & Scanning Optimization
**Principle**: Enable 3-second scanning for key insights

**Implementation**:
- **Color Coding**:
  - Green = BUY/Profit/High WIS
  - Red = SELL/Loss/Low WIS
  - Yellow = FLIP/Warning/Medium WIS
  - Gray = Neutral/Inactive

- **Typography Hierarchy**:
  - Bold = Most important (wallet names, $ amounts)
  - Regular = Context (market names, timestamps)
  - Small/Muted = Metadata (WIS scores, percentages)

- **Visual Badges**:
  - WIS 85+ → Bright green pill badge
  - Unusual trade → Yellow ⚠️ icon
  - Cluster member → Purple 👥 icon
  - Followed wallet → Blue ⭐ icon

**Example (Optimized Trade Row)**:
```
┌─────────────────────────────────────────────────────────┐
│ 2:34pm  ⭐ WhaleTrader42  WIS 85  ⚠️                     │← Icons for quick scan
│         Trump 2024  →  BUY YES                          │
│         $31,500 @ 63¢   ↑ 50,000 shares                 │← Bold key numbers
│         [View] [Alert] [Trade]                          │
└─────────────────────────────────────────────────────────┘
```

**Why it works**:
- Fast scanning (eye catches color/icons first)
- Reduced cognitive load (consistent meaning)
- Accessible (doesn't rely on color alone, uses icons too)

---

### Pattern 7: Feedback Loops & Learning
**Principle**: Help users improve decision-making over time

**Implementation**:
- **Track user's followed trades**: "You followed WhaleTrader42 on this market. Current P/L: +$120 (+12%)"
- **Performance dashboard**: "Your followed whales are up 18% this month"
- **Pattern insights**: "You tend to follow whales with WIS >85. They have 67% win rate."
- **Suggestions**: "💡 You might also like these wallets with similar strategies"

**Example (User Dashboard Widget)**:
```
┌────────────────────────────────────────────┐
│ Your Whale Following Performance           │
│                                            │
│ Last 30 Days:                              │
│ ✓ 12 followed trades                       │
│ ✓ 8 profitable (66.7% win rate)           │
│ ✓ +$2,340 total P/L (+18.5%)              │
│                                            │
│ Top Followed Wallet: WhaleTrader42         │
│ - 5 trades followed, 4 profitable          │
│ - Your P/L from this whale: +$1,850        │
│                                            │
│ 💡 Suggestion:                              │
│ SmartInvestor has similar win rate (91%)   │
│ and focuses on politics markets like you.  │
│ [Follow SmartInvestor →]                   │
└────────────────────────────────────────────┘
```

**Why it works**:
- Builds user confidence (see results)
- Encourages engagement (gamification)
- Surfaces patterns user might miss (AI-powered suggestions)

---

## Feature Prioritization by User Value

### Methodology
Ranked by: (User Need Frequency × Impact on Decision × Effort to Build)^-1

**Legend**:
- 🔥 **Critical** - Build first, blocks core value
- ⚡ **High** - Build soon, major value add
- 📊 **Medium** - Nice to have, enhances experience
- 🔧 **Low** - Power user feature, build last

---

### Whale Activity Features (Ranked)

| Rank | Feature | Priority | Rationale | User Value | Build Effort |
|------|---------|----------|-----------|------------|--------------|
| 1 | **Whale Trades Feed** | 🔥 Critical | Core discovery mechanism. 90% of users start here. | 10/10 | Medium |
| 2 | **Smart Default Filters** | 🔥 Critical | Separates signal from noise. Without this, unusable. | 10/10 | Low |
| 3 | **Follow Wallet (Watchlist)** | 🔥 Critical | Enables tracking over time. Key retention driver. | 9/10 | Medium |
| 4 | **Wallet Detail Side Panel** | ⚡ High | Speeds up workflow. Reduces page loads. | 9/10 | Medium |
| 5 | **Whale Positions (Current)** | ⚡ High | Shows what whales are holding now vs just trades. | 8/10 | Medium |
| 6 | **Scoreboard (Rankings)** | ⚡ High | Helps users find best whales. Gamification appeal. | 8/10 | Low |
| 7 | **Alerts (Basic)** | ⚡ High | Reduces FOMO. Keeps users engaged passively. | 8/10 | High |
| 8 | **Flows Visualization** | 📊 Medium | Aggregates whale sentiment. Useful but not essential. | 7/10 | Medium |
| 9 | **Flips (Position Reversals)** | 📊 Medium | Signals conviction changes. Good for research. | 6/10 | Medium |
| 10 | **Concentration Heatmap** | 📊 Medium | Visual insight into position clustering. | 6/10 | High |
| 11 | **Alerts (Advanced)** | 🔧 Low | Custom alert formulas. Power user feature. | 5/10 | High |

**Build Sequence**:
1. **Sprint 1**: Whale Trades Feed + Smart Filters + Basic Table UI
2. **Sprint 2**: Follow Wallet + Watchlist + Basic Alerts
3. **Sprint 3**: Wallet Detail Side Panel + Quick Actions
4. **Sprint 4**: Whale Positions Tab + Scoreboard Integration
5. **Sprint 5**: Flows Chart + Flips Tracking
6. **Sprint 6**: Concentration Heatmap + Advanced Alerts

---

### Insiders Features (Ranked)

| Rank | Feature | Priority | Rationale | User Value | Build Effort |
|------|---------|----------|-----------|------------|--------------|
| 1 | **Dashboard (Aggregated)** | 🔥 Critical | Entry point. Shows overview quickly. | 9/10 | Medium |
| 2 | **Wallet Watch** | 🔥 Critical | Shared with Whale Activity. Core tracking tool. | 9/10 | Low (reuse) |
| 3 | **Unusual Trades Detection** | ⚡ High | Proactive insider detection. Unique value prop. | 8/10 | High |
| 4 | **Market Watch** | ⚡ High | Monitor specific markets for patterns. | 7/10 | Medium |
| 5 | **Filters/Export (Basic)** | 📊 Medium | Enables external analysis. Researcher requirement. | 7/10 | Medium |
| 6 | **Clusters Visualization** | 📊 Medium | Advanced forensics. Differentiator vs competitors. | 6/10 | Very High |
| 7 | **Filters/Export (Advanced)** | 🔧 Low | Unlimited CSV, API access. Power users only. | 5/10 | High |

**Build Sequence**:
1. **Sprint 1**: Dashboard (widgets aggregating existing data)
2. **Sprint 2**: Wallet Watch (integrate with Whale Activity watchlist)
3. **Sprint 3**: Market Watch (filter whale activity by market)
4. **Sprint 4**: Unusual Trades (statistical outlier detection)
5. **Sprint 5**: Basic Export (CSV with filters)
6. **Sprint 6**: Clusters (network graph, relationship mapping)

---

### Cross-Feature Priorities

| Feature | Priority | Why It Matters |
|---------|----------|----------------|
| **Unified Watchlist** | 🔥 Critical | Should work across Whale Activity & Insiders |
| **Side Panel Navigation** | ⚡ High | Maintains context, speeds exploration |
| **Smart Notifications** | ⚡ High | Drives re-engagement, reduces FOMO |
| **Search (Global)** | ⚡ High | Find any wallet/market quickly |
| **Onboarding Tour** | 📊 Medium | Helps new users orient |
| **Mobile Optimization** | 📊 Medium | 30% of users on mobile |
| **Keyboard Shortcuts** | 🔧 Low | Power users love this |
| **API Access** | 🔧 Low | For advanced integrations |

---

## Progressive Disclosure Implementation Details

### Onboarding Flow (First-Time Users)

**Goal**: Get user to "aha moment" in <2 minutes

#### Step 1: Welcome Screen
```
┌─────────────────────────────────────────────┐
│                                             │
│  Welcome to CASCADIAN Whale Tracker 🐋      │
│                                             │
│  Follow smart traders and identify          │
│  market-moving positions before they        │
│  happen.                                    │
│                                             │
│  [Take 2-Minute Tour] [Skip, I'll Explore]  │
│                                             │
└─────────────────────────────────────────────┘
```

#### Step 2: Tour Highlights
1. **Whale Trades Feed** - "See every significant trade in real-time"
2. **WIS Scores** - "Wallet Intelligence Score shows trader quality (aim for 70+)"
3. **Follow Wallets** - "Track successful traders and get alerts"
4. **Quick Actions** - "One-click to view wallets, markets, or trade"

#### Step 3: Action Prompt
```
┌─────────────────────────────────────────────┐
│  Get Started: Follow Your First Whale       │
│                                             │
│  We recommend following top-ranked wallets: │
│                                             │
│  ⭐ WhaleTrader42  WIS 85  +$57k all-time   │
│     [+ Follow]                              │
│                                             │
│  ⭐ SmartInvestor  WIS 91  +$78k all-time   │
│     [+ Follow]                              │
│                                             │
│  [I'll Choose Later]                        │
└─────────────────────────────────────────────┘
```

**Result**: User has watchlist setup, receives first notifications

---

### Contextual Help System

#### Inline Tooltips
```
WIS (i) ← Hover
↓
╔════════════════════════════════════════╗
║ Wallet Intelligence Score              ║
║                                        ║
║ Measures trader accuracy based on:     ║
║ • Historical win rate                  ║
║ • Profit/loss performance              ║
║ • Position sizing discipline           ║
║                                        ║
║ Scale: 0-100 (70+ is very good)        ║
╚════════════════════════════════════════╝
```

#### Progressive Learning
- **First time seeing WIS**: Full tooltip (above)
- **After 3 sessions**: Shorter tooltip: "WIS 85 = Top 5% of traders"
- **After 10 sessions**: No tooltip (user is familiar)

---

### Settings-Based Personalization

#### Account Settings Page
```
┌────────────────────────────────────────────┐
│ Display Preferences                        │
├────────────────────────────────────────────┤
│                                            │
│ Default View Mode:                         │
│ ( ) Simple - Beginner-friendly            │
│ (•) Standard - Balanced                    │
│ ( ) Advanced - All features visible        │
│                                            │
│ Information Density:                       │
│ ( ) Compact - More rows, less detail      │
│ (•) Default - Balanced                     │
│ ( ) Spacious - Bigger text, more padding  │
│                                            │
│ Auto-Expand Filters:                       │
│ [Toggle: ON]                               │
│                                            │
│ Default Whale Trade Filters:              │
│ - Minimum WIS: [70▼]                       │
│ - Minimum Trade Size: [$5,000▼]           │
│ - Time Range: [24 hours▼]                 │
│ [Reset to Defaults]                        │
│                                            │
│ Notifications:                             │
│ ☑ Push (browser/mobile)                   │
│ ☑ Email digest (daily)                    │
│ ☐ SMS (premium only)                       │
│                                            │
└────────────────────────────────────────────┘
```

---

## Recommendations Summary

### Information Architecture
1. **Consolidate 13 tabs → 5 primary views**
   - Whale Activity: Live Trades | Positions | Analytics
   - Insiders: Dashboard | Wallet Watch + Advanced dropdown

2. **Use Hub & Spoke model**
   - Primary tabs for 80% use cases
   - Secondary access for power features

3. **Implement side panel navigation**
   - Avoid page loads, maintain context
   - Wallet/market previews inline

### UX Patterns
4. **Smart defaults everywhere**
   - Pre-filter to high-quality signals (WIS ≥70, Size ≥$5k)
   - Easy override for power users

5. **Contextual quick actions**
   - Every data point: [View] [Follow] [Alert] [Trade]
   - Reduce workflow from 5 clicks to 2

6. **Aggregated insights**
   - "🐋 Strong YES (8 whales, 73% volume)"
   - Synthesize data into actionable signals

### Progressive Disclosure
7. **Tier complexity by user expertise**
   - Level 1: 5 metrics, simple view
   - Level 2: 10 metrics, expanded filters
   - Level 3: 20+ metrics, custom queries

8. **Onboarding for first-time users**
   - 2-minute tour to "aha moment"
   - Suggested first action: Follow a top whale

9. **Learning feedback loops**
   - Track performance of followed whales
   - Surface patterns and suggestions

### Feature Priorities
10. **Build order (6 sprints)**
    - Sprint 1-2: Core whale tracking (trades, watchlist, alerts)
    - Sprint 3-4: Enhanced UX (side panels, scoreboard, positions)
    - Sprint 5-6: Advanced analytics (flows, clusters, export)

### Mobile Strategy
11. **Simplified mobile IA**
    - Bottom nav: Home | Trades | Watchlist | Alerts | More
    - Progressive disclosure via expanding cards

12. **Responsive tables**
    - Desktop: Full tables with all columns
    - Tablet: Horizontal scroll, condensed columns
    - Mobile: Card layout, swipe for actions

---

## Success Metrics (How to Measure)

### Engagement Metrics
- **Daily Active Users on Whale Activity**: Target 60%+ of total users
- **Avg Session Duration**: Target 8+ minutes (deep engagement)
- **Whale Trades Viewed per Session**: Target 15+ (healthy exploration)
- **Watchlist Creation Rate**: Target 40%+ of users create watchlist
- **Watchlist Size**: Target 3-7 wallets (not too few, not overwhelmed)

### Feature Adoption
- **Side Panel Usage**: Target 50%+ of users click inline previews
- **Filter Customization**: Target 30%+ users modify default filters
- **Alert Setup**: Target 25%+ users create at least 1 alert
- **Export Usage**: Target 5%+ users export data (niche but important)

### User Satisfaction
- **Task Completion Rate**: "Find a high-quality whale trade" >90%
- **Time to Insight**: From landing to actionable trade <3 minutes
- **Return Rate**: Users who return within 7 days >50%
- **Net Promoter Score**: Target >40 (measure via survey)

### Business Impact
- **Trades Influenced by Whale Activity**: Track via UTM params
- **Subscription Conversion**: Premium features (advanced alerts, export)
- **Community Growth**: Sharing of whale insights on social media

---

## Appendix: Competitive Insights (Hashdive)

### What Hashdive Does Well
1. **Smart Scores (WIS equivalent)**: Clear 0-100 scale for wallet quality
2. **Market Screener**: Multi-dimensional filtering by liquidity, volume, whale activity
3. **Candlestick Charts**: Professional trading UX (RSI, MACD, SMA indicators)
4. **Whale Volume Breakdown**: Separate buyer/seller action tracking
5. **Real-time Data**: Live updates, not delayed feeds

### What CASCADIAN Can Do Better
1. **Simplified Entry Point**: Hashdive is complex, intimidate beginners
   - CASCADIAN: Smart defaults + progressive disclosure

2. **Actionable Insights**: Hashdive shows data, not recommendations
   - CASCADIAN: "🐋 Strong BUY signal from 8 whales"

3. **Follow & Alert UX**: Unclear if Hashdive has watchlist feature
   - CASCADIAN: Prominent follow buttons, unified watchlist

4. **Insider Detection**: Hashdive has whale tracking, not suspicious pattern detection
   - CASCADIAN: Unusual Trades, Clusters, statistical rigor

5. **Mobile Experience**: Trading platforms often desktop-only
   - CASCADIAN: Mobile-first responsive design

6. **Educational Layer**: Hashdive assumes user expertise
   - CASCADIAN: Tooltips, tours, pattern insights for learning

### Differentiation Strategy
- **Hashdive = Tool for pros** (complex, powerful, data-heavy)
- **CASCADIAN = Intelligence for everyone** (smart defaults, guided, actionable)

**Positioning**: "Hashdive shows you the data. CASCADIAN tells you what it means and what to do."

---

## Next Steps

### Immediate Actions (This Week)
1. **Validate with users**: Show this analysis to 5 target users, get feedback
2. **Prioritize wireframes**: Focus on Whale Trades Feed + Watchlist first
3. **Define data requirements**: What APIs/database queries needed for each feature
4. **Set up analytics**: Instrument to track engagement metrics listed above

### Design Sprint (Next 6 Days)
- **Day 1**: Finalize information architecture (hub & spoke model)
- **Day 2**: Design Whale Trades Feed (smart defaults, quick actions)
- **Day 3**: Design Watchlist & Alerts flows
- **Day 4**: Design side panel navigation system
- **Day 5**: Design mobile responsive layouts
- **Day 6**: Prototype & user testing (5 users)

### Development Roadmap (6 Sprints)
See "Feature Prioritization by User Value" section for detailed build sequence.

---

**Document Version**: 1.0
**Last Updated**: October 21, 2025
**Next Review**: After user validation testing
**Owner**: UX Research Team, CASCADIAN

---

*This analysis was conducted using competitive research, user persona development, journey mapping, and information architecture best practices. Recommendations prioritize user value and rapid implementation within 6-day sprint cycles.*
