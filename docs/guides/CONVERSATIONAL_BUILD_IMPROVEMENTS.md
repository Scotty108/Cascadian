# Conversational Build API - Strategy Parsing Improvements

## Problem Statement

The AI conversational builder was only creating 1 DATA_SOURCE node when users provided detailed strategy descriptions, instead of building complete workflows with multiple filters, logic nodes, aggregations, and actions.

### Example Input (What Users Provide)
```
Strategy 11: "The Contrarian" (Orthogonal Alpha) 🦉

Goal: Find skilled, non-consensus thinkers to balance a portfolio.
Methodology: This is a portfolio construction strategy to find traders whose performance is uncorrelated with the general crowd.

Filters (The "Independent Thinker" gate):
- Skill: Brier Score (#25): Must be in the top 20% (A verifiably skilled forecaster).
- Bias: YES/NO Direction Bias (#98): Must show a strong bias (e.g., < 30% YES bets).
- Signal: Edge Source Decomposition (#102): Must show a high share of P&L from the "post-close drift to outcome"

Sort By (The "Most Unique" rank):
- Crowd Orthogonality (#68) (Ascending, from lowest correlation to highest).

Action: Adding a wallet from this list to a portfolio
```

### Expected Output (What Should Be Built)
1. DATA_SOURCE node - Fetch wallets from `wallet_metrics_complete`
2. FILTER node - Brier score in top 20% (IN_PERCENTILE operator)
3. FILTER node - YES/NO bias < 30%
4. FILTER node - Edge source decomposition > threshold
5. LOGIC node - Combine all filters with AND
6. AGGREGATION node - Sort by crowd_orthogonality (MIN for ascending)
7. ACTION node - Add to watchlist

**Total: 7 nodes, 6 connections**

### Previous Behavior
- Only created 1 DATA_SOURCE node
- No filters, logic, aggregation, or action nodes
- Responded with "1 action • addDataSourceNode"

---

## Root Cause Analysis

### 1. Batch Request Detection Was Too Narrow
The `detectBatchRequest()` function didn't detect strategy descriptions.

**Before:**
```typescript
const batchIndicators = [
  'build me a bot',
  'build a bot',
  'create a workflow',
  // ... only explicit "build" commands
]
```

**After:**
```typescript
const batchIndicators = [
  'build me a bot',
  'build a bot',
  'create a workflow',
  'strategy:',           // Detects "Strategy 11: ..."
  'goal:',               // Detects "Goal: ..."
  'filters:',            // Detects "Filters: ..."
  'methodology:',        // Detects "Methodology: ..."
  'sort by:',            // Detects "Sort By: ..."
]

// Also detect if message has multiple filters listed
const filterCount = (message.match(/filter|must|should|top \d+%|< \d+|> \d+/gi) || []).length
if (filterCount > 2) {
  return true
}
```

### 2. System Prompt Was Too Simplistic
The batch system prompt was actively telling the AI to build ONLY 4-6 nodes and keep it simple!

**Before:**
```
🚨 CRITICAL RULES:
1. Create SIMPLE, FOCUSED workflows (4-6 nodes maximum!)
2. For EVERY node, IMMEDIATELY call connectNodes to connect it
3. ONE data source node (not 10+)
4. Keep it clean and efficient
```

This was the opposite of what we needed for complex strategies!

**After:**
- Detailed strategy parsing guide
- Clear instructions for handling Filters, Logic, Sorting, and Actions
- 102 available metrics listed
- Step-by-step workflow pattern
- Concrete examples
- Emphasis on building COMPLETE strategies

### 3. Workflow Summary Was Generic
The summary didn't explain what the strategy does or show filter details.

**Before:**
```
✅ **Workflow Complete!**

📊 Summary:
- Nodes: 7
- Connections: 6
- Actions: 12

📦 Created:
- DATA_SOURCE: 1
- FILTER: 3
- LOGIC: 1
- AGGREGATION: 1
- ACTION: 1
```

**After:**
```
✅ **Strategy Built Successfully!**

📦 **Nodes Created (7 total):**
1. **Data Source** - Fetch wallets from database
2-4. **Filters (3)** - brier_score IN_PERCENTILE {"min":80,"max":100}, yes_no_bias LESS_THAN 30, edge_source_decomposition GREATER_THAN 0.5
5. **Logic (AND)** - Combine all filters
6. **Aggregation** - MIN by crowd_orthogonality
7. **Action** - ADD TO WATCHLIST (Contrarian Traders)

🔗 **Connections:** 6 edges created

This workflow implements a complete screening strategy. You can now test it or make adjustments!
```

---

## Changes Made

### File: `/app/api/ai/conversational-build/route.ts`

#### 1. Enhanced `detectBatchRequest()` Function
- **Location:** Lines 77-112
- **Changes:**
  - Added 5 new batch indicators: `strategy:`, `goal:`, `filters:`, `methodology:`, `sort by:`
  - Added filter count detection (if 3+ filters mentioned, trigger batch mode)
  - Kept existing step detection logic

#### 2. Completely Rewrote `buildBatchSystemPrompt()` Function
- **Location:** Lines 530-640
- **Changes:**
  - Removed "4-6 nodes maximum" limitation
  - Added comprehensive strategy parsing guide:
    - How to parse filters (look for "Must", "Should", "Top X%", operators)
    - How to combine filters (LOGIC node with AND)
    - How to handle sorting (AGGREGATION with MIN/MAX)
    - How to parse actions (ADD_TO_WATCHLIST, SEND_ALERT, etc.)
  - Added complete workflow pattern with 7 steps
  - Listed 102 available metrics organized by category
  - Added clear example with 12-step tool call sequence
  - Emphasized building COMPLETE strategies

#### 3. Enhanced `generateWorkflowSummary()` Function
- **Location:** Lines 680-751
- **Changes:**
  - Changed title to "Strategy Built Successfully!"
  - Added detailed node-by-node breakdown
  - Extract filter details from tool calls and display them
  - Show logic operator (AND/OR/etc.)
  - Show aggregation function and field
  - Show action type and parameters (e.g., watchlist name)
  - More helpful final message

---

## Testing Guide

### Test Case 1: The Contrarian Strategy
**Input:**
```
Strategy 11: "The Contrarian" (Orthogonal Alpha)

Goal: Find skilled, non-consensus thinkers to balance a portfolio.

Filters:
- Brier Score: Must be in the top 20%
- YES/NO Direction Bias: Must be < 30%
- Edge Source Decomposition: Must show high post-close drift

Sort By: Crowd Orthogonality (Ascending)

Action: Add to watchlist
```

**Expected Result:**
- 7 nodes created
- 3 FILTER nodes for the three conditions
- 1 LOGIC node (AND)
- 1 AGGREGATION node (MIN on crowd_orthogonality)
- 1 ACTION node (ADD_TO_WATCHLIST)
- 6 connections

### Test Case 2: Simple Filter Strategy
**Input:**
```
Find wallets with omega > 2 and win rate > 60%, sort by PnL
```

**Expected Result:**
- 5 nodes created
- 2 FILTER nodes (omega_ratio, win_rate)
- 1 LOGIC node (AND)
- 1 AGGREGATION node (MAX on net_pnl)
- 1 ACTION node
- 4 connections

### Test Case 3: Multiple Filters with OR Logic
**Input:**
```
Strategy: High Volume Traders

Filters:
- Total volume > $100k OR Bets per week > 50
- Must have Omega > 1.5

Action: Send alert
```

**Expected Result:**
- 6 nodes created
- 3 FILTER nodes
- 2 LOGIC nodes (1 OR for volume/bets, 1 AND to combine with omega)
- 1 ACTION node (SEND_ALERT)
- 5 connections

### Test Case 4: Percentile-Based Strategy
**Input:**
```
Find wallets in:
- Top 10% by Sortino Ratio
- Top 20% by Kelly Utilization
- Win rate > 55%

Sort by: Sharpe Ratio (descending)
```

**Expected Result:**
- 6 nodes created
- 3 FILTER nodes (2 with IN_PERCENTILE, 1 with GREATER_THAN)
- 1 LOGIC node (AND)
- 1 AGGREGATION node (MAX on sharpe_ratio)
- 1 ACTION node
- 5 connections

---

## How to Test Locally

1. **Start the development server:**
   ```bash
   npm run dev
   ```

2. **Navigate to the workflow builder page** (wherever the conversational interface is)

3. **Paste one of the test cases above**

4. **Verify the AI response includes:**
   - "Building pass 1..." console logs
   - Multiple tool calls (should see 12+ actions for complex strategies)
   - Detailed summary showing all nodes and connections
   - No "only created 1 node" messages

5. **Check the visual workflow:**
   - All nodes should be visible
   - Nodes should be connected properly
   - Auto-layout should work (nodes staggered horizontally)

---

## API Endpoint Details

### Endpoint
`POST /api/ai/conversational-build`

### Request Format
```json
{
  "messages": [
    {
      "role": "user",
      "content": "Strategy 11: The Contrarian..."
    }
  ],
  "currentWorkflow": {
    "nodes": [],
    "edges": []
  }
}
```

### Response Format
```json
{
  "message": "AI response text with summary",
  "toolCalls": [
    {
      "function": {
        "name": "addDataSourceNode",
        "arguments": { "source": "WALLETS", "table": "wallet_metrics_complete" }
      }
    },
    {
      "function": {
        "name": "addFilterNode",
        "arguments": { "field": "brier_score", "operator": "IN_PERCENTILE", "value": { "min": 80, "max": 100 } }
      }
    }
    // ... more tool calls
  ],
  "suggestions": ["Test workflow", "Make adjustments", "Explain how it works"],
  "workflowComplete": true,
  "nodeCount": 7,
  "passCount": 1
}
```

---

## Key Improvements Summary

| Aspect | Before | After |
|--------|--------|-------|
| **Batch Detection** | Only explicit "build" commands | Detects strategy descriptions, filters, goals |
| **System Prompt** | "Build 4-6 nodes max, keep it simple" | "Build COMPLETE strategy with all filters, logic, sorting" |
| **Strategy Parsing** | No guidance | Detailed guide for filters, logic, sorting, actions |
| **Available Metrics** | Not mentioned | 102 metrics listed with categories |
| **Workflow Summary** | Generic node counts | Detailed breakdown with filter details |
| **Tool Call Example** | None | 12-step example showing complete sequence |

---

## Future Improvements

1. **Strategy Templates**: Pre-built templates for common strategies
2. **Metric Validation**: Validate that field names exist in the database
3. **Connection Intelligence**: Smarter auto-connection based on node types
4. **Visual Preview**: Show workflow diagram as it's being built
5. **Save Strategy**: Allow saving strategy descriptions as reusable templates
6. **Multi-Source Strategies**: Support joining wallets + markets data
7. **Conditional Logic**: Support IF/THEN/ELSE branching

---

## Deployment Checklist

- [x] Update `detectBatchRequest()` function
- [x] Rewrite `buildBatchSystemPrompt()` function
- [x] Enhance `generateWorkflowSummary()` function
- [ ] Test with real user strategy descriptions
- [ ] Monitor OpenAI API usage (complex strategies may use more tokens)
- [ ] Update user documentation with strategy format examples
- [ ] Add strategy templates to UI
- [ ] Track batch request success rate in analytics

---

## Related Files

- **API Route**: `/app/api/ai/conversational-build/route.ts`
- **Frontend Interface**: (Location of conversational build UI)
- **Node Types**: `/components/workflow/node-types/` (if exists)
- **Metrics Schema**: `/lib/metrics/` or database schema

---

## Questions or Issues?

If the AI still only creates 1 node:
1. Check console logs - does it detect as batch request?
2. Verify OpenAI API key is set
3. Check if `maxDuration` is sufficient (currently 60s)
4. Look for errors in the response

If connections are missing:
1. Check if auto-connect fallback is working (lines 188-231)
2. Verify edge IDs are unique
3. Check if source/target node IDs exist

If filters have wrong operators:
1. Verify field names match database schema
2. Check operator mapping (GREATER_THAN vs >)
3. Ensure percentile values are objects: `{min: 80, max: 100}`
