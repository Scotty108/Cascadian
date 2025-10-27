# Flexible Strategy Architecture

**Date:** 2025-10-26
**Status:** Active templates fixed, documenting workflow patterns

---

## ✅ Fixed: Active Status

All predefined strategies now show as **inactive** (templates). Users can activate them individually from the UI.

---

## Current Architecture: Two Workflow Types

The system is **flexible** and supports both approaches:

### 1. Simple Copy Trading (Wallet → Positions)
**Goal:** Find best wallets and copy their trades

```
┌─────────────────────────────────────────────────────────────┐
│ Step 1: Find Best Wallets                                   │
│ DATA_SOURCE (WALLETS)                                       │
│   • Source: wallet_scores_by_category                       │
│   • Get all wallets with metrics                            │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 2: Filter Wallets                                      │
│ ENHANCED_FILTER                                             │
│   • omega_ratio >= 2.5                                      │
│   • total_pnl > 1000                                        │
│   • win_rate >= 0.55                                        │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 3: Pick Top Wallets                                    │
│ AGGREGATION                                                 │
│   • TOP_N by total_pnl                                      │
│   • Limit: 10 wallets                                       │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 4: Get Their Positions                                 │
│ DATA_SOURCE (WALLET_POSITIONS) ← Second data source!        │
│   • inputField: wallet (from previous step)                 │
│   • status: open                                            │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 5: Filter Positions                                    │
│ ENHANCED_FILTER                                             │
│   • liquidity > 1000                                        │
│   • volume > 5000                                           │
│   • price range: 0.15 - 0.85                                │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 6: Size Positions                                      │
│ ORCHESTRATOR                                                │
│   • Kelly sizing                                            │
│   • Risk management                                         │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 7: Execute Copy Trades                                 │
│ ACTION                                                      │
│   • Place limit orders                                      │
│   • Follow wallet side                                      │
└─────────────────────────────────────────────────────────────┘
```

**Example:** Category Copy Trading strategy (already built!)

---

### 2. Category-First Analysis (Category → Wallets → Positions)
**Goal:** Find most winnable categories, then best wallets in those categories

```
┌─────────────────────────────────────────────────────────────┐
│ Step 1: Analyze Categories (MANUAL FOR NOW)                 │
│ ⚠️  No CATEGORY node type yet                               │
│                                                              │
│ Workaround:                                                 │
│   1. Run analysis script to find top categories by Omega    │
│   2. Manually set category filter in strategy               │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 2: Find Wallets in Top Category                        │
│ DATA_SOURCE (WALLETS)                                       │
│   • Source: wallet_scores_by_category                       │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 3: Filter by Category + Performance                    │
│ ENHANCED_FILTER                                             │
│   • category = "Politics" (from analysis)                   │
│   • omega_ratio >= 2.5                                      │
│   • win_rate >= 0.55                                        │
│   • closed_positions >= 20                                  │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 4: Calculate Category Omega                            │
│ ⚠️  Missing: Per-category Omega aggregation                 │
│                                                              │
│ Workaround:                                                 │
│   • Filter assumes wallet_scores_by_category already has    │
│     category-specific metrics                               │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 5: Pick Top in Category                                │
│ AGGREGATION                                                 │
│   • TOP_N by total_pnl                                      │
│   • Or by category_omega (when available)                   │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 6-8: Same as Simple Copy Trading                       │
│   • Get positions                                           │
│   • Filter positions                                        │
│   • Size & execute                                          │
└─────────────────────────────────────────────────────────────┘
```

**Example:** Can build this today by:
1. Manually analyzing categories
2. Setting category filter in ENHANCED_FILTER
3. Rest of workflow is identical to copy trading

---

## What's Currently Supported ✅

### Node Types Available:
1. **DATA_SOURCE**
   - WALLETS (wallet_scores_by_category)
   - MARKETS (polymarket markets)
   - WALLET_POSITIONS (positions of specific wallets)

2. **ENHANCED_FILTER**
   - Multi-condition filtering
   - AND/OR logic
   - Supports both wallet and market fields

3. **AGGREGATION**
   - TOP_N (select top by field)
   - Sorting (ASC/DESC)

4. **ORCHESTRATOR**
   - Kelly criterion sizing
   - Risk management
   - Portfolio heat limits

5. **ACTION**
   - PLACE_LIMIT_ORDER
   - Exit rules
   - Follow wallet side

### Workflow Patterns Supported:
✅ **Direct market trading:** MARKETS → FILTER → ORCHESTRATOR → ACTION
✅ **Simple copy trading:** WALLETS → FILTER → AGG → POSITIONS → FILTER → ORCH → ACTION
✅ **Category filtering:** WALLETS → FILTER(category) → AGG → POSITIONS → ORCH → ACTION

---

## What's Missing ⚠️

### 1. WATCHLIST Node
**Purpose:** Add opportunities to persistent watchlist for monitoring

**Current:** Strategies execute immediately on each CRON run
**Desired:** Add to watchlist, monitor continuously

```
MARKETS → FILTER → WATCHLIST ← Missing!
                      ↓
                   Monitor...
```

### 2. SIGNAL Node
**Purpose:** Wait for momentum/trigger conditions before executing

**Current:** No trigger-based execution
**Desired:** Trade when momentum crosses threshold

```
WATCHLIST → SIGNAL (momentum > threshold) → ACTION ← Missing!
                ↓
         SIGNAL (momentum reverses) → EXIT
```

### 3. CATEGORY Analysis Node
**Purpose:** Automatically find top categories by Omega ratio

**Current:** Manual analysis + hardcode category in filter
**Desired:** Dynamic category discovery

```
DATA_SOURCE (CATEGORIES) ← Missing!
    ↓
AGGREGATION (top 2-3 categories)
    ↓
DATA_SOURCE (WALLETS in those categories)
```

### 4. Leaderboard Momentum
**Purpose:** Track wallets jumping ranks (getting better relative to others)

**Current:** Can filter by absolute Omega momentum
**Desired:** Track relative rank changes over time

---

## How to Build Each Workflow Today

### Simple Copy Trading (10 Best Wallets)
```typescript
{
  nodes: [
    // 1. Find wallets
    {
      type: 'DATA_SOURCE',
      config: {
        source: 'WALLETS',
        prefilters: { table: 'wallet_scores_by_category' }
      }
    },

    // 2. Filter by performance
    {
      type: 'ENHANCED_FILTER',
      config: {
        conditions: [
          { field: 'omega_ratio', operator: 'GREATER_THAN_OR_EQUAL', value: '2.5' },
          { field: 'total_pnl', operator: 'GREATER_THAN', value: '1000' },
          { field: 'win_rate', operator: 'GREATER_THAN_OR_EQUAL', value: '0.55' }
        ]
      }
    },

    // 3. Top 10
    {
      type: 'AGGREGATION',
      config: {
        function: 'TOP_N',
        field: 'total_pnl',
        limit: 10
      }
    },

    // 4. Get their positions
    {
      type: 'DATA_SOURCE',
      config: {
        source: 'WALLET_POSITIONS',
        inputField: 'wallet'
      }
    },

    // 5-7: Filter, size, execute...
  ]
}
```

### Category-First (Politics Category Example)
```typescript
{
  nodes: [
    // 1. Find wallets
    {
      type: 'DATA_SOURCE',
      config: {
        source: 'WALLETS',
        prefilters: { table: 'wallet_scores_by_category' }
      }
    },

    // 2. Filter to Politics category + performance
    {
      type: 'ENHANCED_FILTER',
      config: {
        conditions: [
          // Category first!
          { field: 'category', operator: 'EQUALS', value: 'Politics' },

          // Then performance in that category
          { field: 'omega_ratio', operator: 'GREATER_THAN_OR_EQUAL', value: '2.5' },
          { field: 'total_pnl', operator: 'GREATER_THAN', value: '1000' },
          { field: 'closed_positions', operator: 'GREATER_THAN_OR_EQUAL', value: '20' }
        ],
        logic: 'AND'
      }
    },

    // 3. Top 10 in Politics
    {
      type: 'AGGREGATION',
      config: {
        function: 'TOP_N',
        field: 'total_pnl', // Or omega_ratio
        limit: 10
      }
    },

    // 4-7: Get positions, filter, size, execute...
  ]
}
```

---

## Scotty's Strategy Pattern (Market-Based)

**Your specific requirements:**
- Last 12 hours only
- Default to NO
- Profit > fees + spread
- Limit orders only
- YES 10-40%
- Liquid markets
- Momentum triggers

**Current Implementation:**
```
MARKETS → FILTER → ORCHESTRATOR → ACTION
```

**What's Missing:**
```
MARKETS → FILTER → WATCHLIST ← Need this!
                      ↓
                 SIGNAL (momentum up) ← Need this!
                      ↓
                 ORCHESTRATOR
                      ↓
                 ACTION (enter)
                      ↓
                 SIGNAL (momentum levels out) ← Need this!
                      ↓
                 ACTION (exit)
```

---

## Next Steps

### To Support Full Vision:

1. **Add WATCHLIST Node Type**
   - Stores opportunities for monitoring
   - Persistent across CRON runs
   - UI shows watchlist items

2. **Add SIGNAL Node Type**
   - Momentum indicators (RMA, EMA, TSI)
   - Threshold triggers
   - Event-driven execution

3. **Add CATEGORY Data Source**
   - Auto-analyze all categories
   - Calculate Omega ratio per category
   - Return top N categories

4. **Enhance ORCHESTRATOR**
   - Leaderboard tracking
   - Relative rank momentum
   - Category-aware sizing

### Quick Win: Analysis Script

Before building new node types, create a script to analyze categories:

```bash
npm exec tsx scripts/analyze-categories.ts

Output:
┌──────────────┬────────────┬─────────────┬───────────┐
│ Category     │ Avg Omega  │ Win Rate    │ Volume    │
├──────────────┼────────────┼─────────────┼───────────┤
│ Politics     │ 3.2        │ 68%         │ High      │
│ Sports       │ 2.1        │ 55%         │ Very High │
│ Crypto       │ 1.8        │ 52%         │ High      │
│ AI           │ 2.9        │ 64%         │ Medium    │
└──────────────┴────────────┴─────────────┴───────────┘

Recommendation: Focus on Politics and AI
```

Then manually use those categories in your strategies.

---

## Summary

**Current System:**
- ✅ Flexible (supports both workflows)
- ✅ Can do simple copy trading (Category Copy Trading example)
- ✅ Can do category filtering (manual category selection)
- ❌ No watchlist persistence
- ❌ No momentum signal triggers
- ❌ No automated category analysis

**To Build Full Vision:**
- Add WATCHLIST node (persistent monitoring)
- Add SIGNAL node (momentum triggers)
- Add CATEGORY data source (auto-analysis)
- Switch from CRON batch to event-driven

**Immediate Workaround:**
- Use existing nodes with manual category selection
- CRON execution instead of signals
- Works, but less sophisticated than full vision

---

**Status:** System is flexible, but needs WATCHLIST/SIGNAL nodes for full momentum trading
**Last Updated:** 2025-10-26
