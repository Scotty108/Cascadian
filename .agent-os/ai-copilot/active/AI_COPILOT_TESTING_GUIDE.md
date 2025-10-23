# AI Copilot - Manual Testing Guide

**Status**: Ready for Testing
**Date**: 2025-10-23

---

## 🚀 Quick Start

```bash
# Start the development server
pnpm dev

# Navigate to: http://localhost:3000/strategy-builder
# Press Cmd+K to open AI Copilot
```

---

## ✅ Testing Checklist

### Phase 1: Basic Node Creation (15 minutes)

#### Test 1.1: Polymarket Stream Node
**Prompt**: `"Add a Polymarket stream node for Politics markets"`

**Expected**:
- [ ] Node appears on canvas
- [ ] Node shows "Polymarket Stream" label
- [ ] Configuration shows categories: ["Politics"]
- [ ] Blue color theme

**Verify**: Click on the node → Check config panel shows Politics category

---

#### Test 1.2: Filter Node
**Prompt**: `"Add a filter node for volume > 100000"`

**Expected**:
- [ ] Filter node created
- [ ] Configuration shows: `volume gt 100000`
- [ ] Purple color theme

---

#### Test 1.3: LLM Analysis Node
**Prompt**: `"Add an LLM node with the prompt: Does this market mention Trump?"`

**Expected**:
- [ ] LLM Analysis node created
- [ ] Config shows exact prompt
- [ ] Pink color theme
- [ ] Output format: text

---

#### Test 1.4: Transform Node
**Prompt**: `"Add a transform node that calculates edge = abs(currentPrice - 0.5)"`

**Expected**:
- [ ] Transform node created
- [ ] Config shows add-column operation
- [ ] Formula: `abs(currentPrice - 0.5)`
- [ ] Orange color theme

---

#### Test 1.5: Condition Node
**Prompt**: `"Add a condition: if price > 0.6 then buy else skip"`

**Expected**:
- [ ] Condition node created
- [ ] Config shows if/then/else
- [ ] Green color theme

---

#### Test 1.6: Buy Node
**Prompt**: `"Add a buy node for Yes outcome with $100"`

**Expected**:
- [ ] Buy Order node created
- [ ] Outcome: Yes
- [ ] Amount: $100
- [ ] Teal color theme

---

### Phase 2: Conversational Building (20 minutes)

#### Test 2.1: Batch Building
**Prompt**:
```
"Build me a complete bot that:
1. Streams Politics markets
2. Filters for volume > 100000
3. Uses AI to check if it mentions Trump
4. Buys Yes for $100 if the answer is true"
```

**Expected**:
- [ ] 4-5 nodes created
- [ ] Nodes auto-connected in logical order
- [ ] Final output shows workflow summary
- [ ] All configurations correct

**Verify Steps**:
1. Count nodes (should be 4-5)
2. Check edges connect properly
3. Click each node and verify config
4. Run workflow (next phase)

---

#### Test 2.2: Iterative Building
**Prompts** (send one at a time):
1. `"Add a Polymarket stream for Crypto"`
2. `"Now add a filter for volume > 500000"`
3. `"Connect the stream to the filter"`
4. `"Add a buy node for No outcome, $50"`
5. `"Connect the filter to the buy node"`

**Expected**:
- [ ] Each prompt creates exactly one thing
- [ ] Nodes/edges added incrementally
- [ ] Final workflow has 3 nodes, 2 edges

---

#### Test 2.3: Node Modification
**Setup**: Create a filter node first

**Prompts**:
1. `"Change the volume filter to 200000"`
2. `"Update the filter to check for category = Crypto"`

**Expected**:
- [ ] Existing node updated (not new node created)
- [ ] Config reflects new values
- [ ] Toast notification confirms update

---

#### Test 2.4: Node Deletion
**Setup**: Build a 3-node workflow

**Prompt**: `"Delete the filter node"`

**Expected**:
- [ ] Filter node removed
- [ ] Connected edges also removed
- [ ] Other nodes remain

---

### Phase 3: Workflow Execution (30 minutes)

#### Test 3.1: Simple Stream + Filter
**Workflow**:
```
Stream (Politics, minVolume: 0) → Filter (volume > 100000) → End
```

**Steps**:
1. Build workflow (via AI or manual)
2. Click "Run Strategy" button
3. Watch execution panel

**Expected**:
- [ ] Execution panel opens
- [ ] Stream node shows "running" → "completed"
- [ ] Filter node shows "running" → "completed"
- [ ] Output shows filtered markets
- [ ] Market count < initial count

**Verify Output**:
- [ ] All markets have volume > 100000
- [ ] Markets are Politics category

---

#### Test 3.2: LLM Analysis (Requires API Key)
**Workflow**:
```
Stream (Crypto) → LLM ("Does this mention Bitcoin? Answer yes or no") → End
```

**Steps**:
1. Build workflow
2. Verify OPENAI_API_KEY in .env.local
3. Run workflow
4. Check execution time (may take 10-30 seconds)

**Expected**:
- [ ] LLM node executes without errors
- [ ] Output is text ("yes" or "no")
- [ ] Response makes sense

**Note**: This makes real API calls and uses tokens!

---

#### Test 3.3: Transform + Condition
**Workflow**:
```
Stream (Politics) → Transform (add edge column) → Condition (if edge > 0.1) → End
```

**Transform Config**:
```typescript
{
  operations: [{
    type: "add-column",
    config: {
      name: "edge",
      formula: "abs(currentPrice - 0.5)"
    }
  }]
}
```

**Condition Config**:
```typescript
{
  conditions: [{
    if: "edge > 0.1",
    then: "high-edge",
    else: "low-edge"
  }]
}
```

**Expected**:
- [ ] Transform adds "edge" column to each market
- [ ] Edge values calculated correctly
- [ ] Condition branches based on edge value
- [ ] Output shows action taken

**Verify Formula**:
- Market with price 0.7 → edge = 0.2 ✓
- Market with price 0.45 → edge = 0.05 ✓

---

#### Test 3.4: Complete Trading Bot (Mock)
**Workflow**:
```
Stream → Filter → LLM → Condition → Buy → End
```

**AI Prompt**:
```
"Build a complete trading bot that:
- Fetches Politics markets with volume > 500k
- Uses AI to check if it's about the 2024 election
- If yes, calculates edge = abs(price - 0.5)
- If edge > 0.15, buys Yes for $100
- Otherwise skips"
```

**Expected**:
- [ ] 6 nodes created and connected
- [ ] All nodes execute in sequence
- [ ] Buy node only triggers if conditions met
- [ ] Mock order shows in output

**Verify Logic**:
- High edge market → Buy order created
- Low edge market → Skipped
- Non-election market → Skipped

---

### Phase 4: Session Management (15 minutes)

#### Test 4.1: Save Workflow
**Steps**:
1. Build a workflow (3+ nodes)
2. Press **Cmd+S** (or click Save button)
3. Enter workflow name if prompted
4. Check toast notification

**Expected**:
- [ ] Toast: "Workflow saved successfully"
- [ ] Unsaved indicator (•) disappears
- [ ] Workflow ID generated

**Verify Database**:
```sql
SELECT * FROM workflow_sessions ORDER BY created_at DESC LIMIT 1;
```

---

#### Test 4.2: Load Workflow
**Steps**:
1. Click "Open" button
2. Select a workflow from modal
3. Click to load

**Expected**:
- [ ] Modal shows list of saved workflows
- [ ] Click loads workflow onto canvas
- [ ] All nodes and edges restored
- [ ] Config preserved

---

#### Test 4.3: Dirty State Tracking
**Steps**:
1. Load a saved workflow
2. Modify a node (change config)
3. Look at Save button

**Expected**:
- [ ] Save button shows (•) indicator
- [ ] Save button enabled
- [ ] Cmd+S works to save changes

---

#### Test 4.4: Delete Workflow
**Steps**:
1. Open workflow list modal
2. Click delete icon on a workflow
3. Confirm deletion

**Expected**:
- [ ] Confirmation dialog appears
- [ ] After confirm, workflow removed from list
- [ ] Toast notification shown

---

### Phase 5: Execution Tracking (10 minutes)

#### Test 5.1: Create Execution Record
**Steps**:
1. Save a workflow
2. Run the workflow
3. Check database

**Expected**:
- [ ] New record in `workflow_executions` table
- [ ] `workflow_id` matches saved workflow
- [ ] `status` = 'running' during execution
- [ ] `status` = 'completed' after success

**Database Check**:
```sql
SELECT * FROM workflow_executions
WHERE workflow_id = 'YOUR_WORKFLOW_ID'
ORDER BY started_at DESC
LIMIT 1;
```

---

#### Test 5.2: Execution Stats in Library
**Steps**:
1. Run a workflow multiple times
2. Navigate to Strategy Library
3. Find the workflow card

**Expected**:
- [ ] Shows total executions count
- [ ] Shows successful executions
- [ ] Shows win rate percentage
- [ ] Stats update after each run

---

### Phase 6: Error Handling (10 minutes)

#### Test 6.1: Invalid Formula
**Setup**: Create transform node

**Config**:
```typescript
{
  operations: [{
    type: "add-column",
    config: {
      name: "test",
      formula: "invalid syntax here!!!"  // Bad formula
    }
  }]
}
```

**Expected**:
- [ ] Execution fails gracefully
- [ ] Error message shown in execution panel
- [ ] Node marked as "error" status (red)
- [ ] Error logged to database

---

#### Test 6.2: Missing API Key (LLM Node)
**Setup**:
1. Remove/comment out `OPENAI_API_KEY` in .env.local
2. Restart dev server
3. Run workflow with LLM node

**Expected**:
- [ ] Error message about missing API key
- [ ] Execution stops at LLM node
- [ ] Status = 'failed' in database

---

#### Test 6.3: Empty Input
**Setup**: Create filter node without connecting any input

**Expected**:
- [ ] Filter receives empty array
- [ ] Returns empty array (doesn't crash)
- [ ] Node completes successfully

---

## 📊 Results Template

After testing, fill out:

```markdown
## Test Results - [Date]

### Phase 1: Basic Node Creation
- Polymarket Stream: ✅ / ❌ (notes)
- Filter: ✅ / ❌
- LLM Analysis: ✅ / ❌
- Transform: ✅ / ❌
- Condition: ✅ / ❌
- Buy: ✅ / ❌

### Phase 2: Conversational Building
- Batch Building: ✅ / ❌
- Iterative Building: ✅ / ❌
- Node Modification: ✅ / ❌
- Node Deletion: ✅ / ❌

### Phase 3: Workflow Execution
- Stream + Filter: ✅ / ❌
- LLM Analysis: ✅ / ❌
- Transform + Condition: ✅ / ❌
- Complete Bot: ✅ / ❌

### Phase 4: Session Management
- Save: ✅ / ❌
- Load: ✅ / ❌
- Dirty State: ✅ / ❌
- Delete: ✅ / ❌

### Phase 5: Execution Tracking
- Create Record: ✅ / ❌
- Stats Display: ✅ / ❌

### Phase 6: Error Handling
- Invalid Formula: ✅ / ❌
- Missing API Key: ✅ / ❌
- Empty Input: ✅ / ❌

### Issues Found
1. [Issue description]
2. [Issue description]

### Recommendations
1. [Recommendation]
2. [Recommendation]
```

---

## 🐛 Common Issues & Solutions

### Issue: Nodes not appearing
**Solution**: Check browser console for errors. Verify node types are registered.

### Issue: Execution hangs
**Solution**: Check if all nodes have valid config. Look for infinite loops.

### Issue: LLM node timeout
**Solution**: Increase timeout in node executor. Check API key is valid.

### Issue: Database errors
**Solution**: Verify Supabase connection. Check RLS policies allow access.

### Issue: AI Copilot not responding
**Solution**: Check OpenAI API key. Verify network connection. Check server logs.

---

## ⏱️ Estimated Testing Time

- **Phase 1**: 15 min
- **Phase 2**: 20 min
- **Phase 3**: 30 min
- **Phase 4**: 15 min
- **Phase 5**: 10 min
- **Phase 6**: 10 min

**Total**: ~100 minutes (1 hour 40 min)

**Recommended**: Split into two sessions
- Session 1: Phases 1-2 (35 min)
- Session 2: Phases 3-6 (65 min)

---

**Ready to test!** Start the dev server and begin with Phase 1.
