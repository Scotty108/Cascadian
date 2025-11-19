# Vector Search Best Practices Guide

**System:** claude-self-reflect with 350+ indexed conversations
**Search Type:** Semantic vector search (384-dimensional embeddings)
**Response Time:** Sub-3ms average
**Update Frequency:** Real-time with safe-watcher (2-60 second indexing)

---

## When to Use Vector Search

### ✅ Use Vector Search When:

1. **Before starting new work** - "Have we solved this before?"
2. **Stuck on a problem** - "What approaches did we try for X?"
3. **Need architecture context** - "How is the wallet system designed?"
4. **Debugging** - "Previous bugs related to condition_id normalization"
5. **Learning patterns** - "Examples of using the database-query skill"
6. **Finding decisions** - "Why did we choose ClickHouse over Postgres?"
7. **Avoiding rework** - "Did we already build a market screener?"

### ❌ Don't Use Vector Search When:

1. Question is about code syntax (use docs instead)
2. Need exact file location (use Glob tool)
3. Need current data (use database queries)
4. Question is trivial (use CLAUDE.md quick reference)

---

## Query Patterns That Work

### ✅ GOOD Queries (Problem/Concept-Based)

These work because they match the **narrative extraction** system:

```
"How did we solve the zero-ID trades issue?"
"What approaches have we used for wallet metrics calculation?"
"Find discussions about strategy execution validation"
"Previous attempts at market resolution backfill"
"Why did the PnL calculation fail for wallet 0x4ce7?"
"What patterns did we use for ERC1155 token decoding?"
"Explain the atomic rebuild pattern we developed"
"Find conversations about ClickHouse performance optimization"
"How did we handle the 77M missing trades gap?"
"What's our approach to multi-terminal coordination?"
```

**Why these work:** They describe problems, concepts, and outcomes that were extracted during indexing.

### ❌ BAD Queries (Keyword-Based)

These fail because they're too generic:

```
"wallet metrics"           → Too vague, 100+ results
"zero ID"                  → Ambiguous, no context
"strategy"                 → Too broad
"PnL"                      → Everything mentions PnL
"database"                 → Matches almost everything
```

**Why these fail:** The system extracts narratives and concepts, not just keywords.

---

## Query Syntax by Agent

### For Codex (Orchestrator)

**Pattern:** Search first, then delegate with context

```typescript
// Example Codex workflow
1. User asks: "Implement wallet PnL tracking"

2. Codex searches:
   query: "How did we implement wallet PnL calculations before?"

3. Codex reviews results:
   - Found: "Used payout vectors + atomic rebuild pattern"
   - Found: "Applied IDN and PNL skills for normalization"

4. Codex delegates to Claude:
   "Implement wallet PnL using payout vector approach from [previous conversation].
   Apply IDN and PNL skills. Use atomic rebuild pattern."
```

**MCP Call (if available):**
```javascript
use_mcp("claude_self_reflect", {
  query: "How did we handle wallet PnL calculations?",
  limit: 5
})
```

### For Claude (Implementer)

**Pattern:** Search for context when stuck

```typescript
// Example Claude workflow
1. Assigned task: "Fix condition_id join failure"

2. Claude is stuck after 15 min

3. Claude searches:
   "Previous condition_id join issues and how they were solved"

4. Claude finds:
   - "Always normalize: lower(replaceAll(condition_id, '0x', ''))"
   - "Use String type, avoid FixedString casts"
   - "Apply IDN pattern from Stable Pack"

5. Claude applies solution, tests, succeeds
```

**When Claude Should Search:**
- Stuck for >10 minutes
- Repeating patterns (check if we already documented this)
- Need to understand system design
- Before major refactors

---

## Real Query Examples from This Project

### Database Queries

**Query:** "How do we handle condition_id normalization in ClickHouse joins?"

**Expected Results:**
- IDN (ID Normalize) pattern from Stable Pack
- Examples of normalized joins in trades_raw
- Why FixedString causes issues

**Usage:** Before writing any condition_id join

---

### Architecture Understanding

**Query:** "How is the multi-terminal coordination system designed?"

**Expected Results:**
- session-state.json structure
- Terminal ID assignment rules
- Coordination protocol between Codex and Claude terminals

**Usage:** When spawning additional terminals

---

### Debugging Historical Issues

**Query:** "What caused the 77M missing trades gap and how was it solved?"

**Expected Results:**
- Root cause analysis
- Coverage verification approach
- Gate-based validation
- Final solution (blockchain reconstruction)

**Usage:** Similar coverage issues in future

---

### Pattern Learning

**Query:** "Show me examples of using the database-query skill effectively"

**Expected Results:**
- Skill invocation patterns
- Token savings achieved
- Common query templates
- When to use TABLES.md vs EXAMPLES.md

**Usage:** Learning to use new skills

---

### Decision Context

**Query:** "Why did we choose ReplacingMergeTree over MergeTree for trades_raw?"

**Expected Results:**
- Idempotent updates requirement
- No UPDATE statement needed
- Deduplication by primary key
- Trade-offs discussed

**Usage:** Understanding architecture decisions

---

## Search Results Interpretation

### Good Result Indicators

- ✅ **Timestamp relevance:** Recent conversations rank higher (90-day decay)
- ✅ **Narrative match:** Result describes problem AND solution
- ✅ **Tool mentions:** Lists files modified, commands run
- ✅ **Concept extraction:** Key terms extracted (IDN, NDR, PNL, etc.)

### Warning Signs

- ⚠️ **Old conversation (>90 days):** Might be outdated
- ⚠️ **Vague narrative:** No clear problem/solution
- ⚠️ **Different project:** Check if result is from this codebase

### When to Search Again

If first search doesn't help:
1. **Rephrase as question:** "What is X?" → "How did we implement X?"
2. **Add context:** "wallet metrics" → "wallet metrics calculation with PnL aggregation"
3. **Focus on problem:** "database" → "database performance issue with large table scans"

---

## Integration with Workflow

### Codex's Vector Search Workflow

```
1. USER REQUEST received

2. SEARCH FIRST:
   - "Have we done {task} before?"
   - Review top 3-5 results

3. DECIDE:
   ✅ Found solution → Delegate to Claude with context
   ❌ No solution → Delegate for research

4. DELEGATE with enriched context:
   "Implement {task} using approach from {conversation}.
   Reference: {files}, Apply: {skills}, Use: {patterns}"
```

### Claude's Vector Search Workflow

```
1. ASSIGNED TASK received

2. START WORK:
   - Apply known patterns (from RULES.md, CLAUDE.md)

3. IF STUCK (>10 min):
   - SEARCH: "How did we solve {similar problem}?"
   - Review results
   - Apply learned pattern

4. IF SUCCESS:
   - Document new pattern
   - Update session report

5. IF STILL STUCK:
   - Report blocker to Codex
   - Suggest vector search query for Codex
```

---

## Performance Expectations

### Search Speed
- **Target:** <3ms average
- **Typical:** 1-5ms
- **Slow:** >10ms (check if safe-watcher indexing)

### Result Quality
- **Top result:** 70-80% relevant
- **Top 3 results:** 90%+ chance of finding answer
- **Top 5 results:** 95%+ comprehensive

### Index Freshness
- **Real-time:** New conversations indexed within 2-60 seconds
- **Update trigger:** safe-watcher monitoring `~/.claude/projects/`
- **Verify:** Check `~/.claude-self-reflect/index/` timestamp

---

## Troubleshooting

### Search Returns No Results

**Possible causes:**
1. Query too specific or keyword-based
2. Conversation not indexed yet (new session)
3. claude-self-reflect not running

**Solutions:**
1. Rephrase as broader concept question
2. Wait 60 seconds for indexing
3. Check: `ps aux | grep claude-self-reflect`

---

### Search Returns Irrelevant Results

**Possible causes:**
1. Query too vague
2. Matching different project/context
3. Old conversations ranked too high

**Solutions:**
1. Add project context: "In Cascadian, how did we..."
2. Add time constraint: "Recent approach to..."
3. Review top 5 results, not just top 1

---

### Search Is Slow (>10ms)

**Possible causes:**
1. Index rebuilding
2. Large result set
3. Qdrant performance issue

**Solutions:**
1. Wait for indexing to complete
2. Add `limit: 5` parameter
3. Restart Qdrant: `docker restart qdrant`

---

### MCP Not Available

**Possible causes:**
1. MCP not configured in config.toml
2. claude-self-reflect not installed
3. Qdrant vector DB not running

**Solutions:**
1. Check `~/.codex/config.toml` has `[mcp_servers.claude_self_reflect]`
2. Install: `pip install claude-self-reflect`
3. Start Qdrant: `docker run -p 6333:6333 qdrant/qdrant`

---

## Advanced Patterns

### Multi-Query Search

When problem is complex, search multiple angles:

```
1. "How did we implement wallet metrics?"
2. "What database schema supports wallet tracking?"
3. "Previous issues with wallet data aggregation"

Combine insights from all 3 searches.
```

### Temporal Search

When you need evolution of approach:

```
1. "Early attempts at market resolution backfill"
2. "Current approach to market resolution backfill"

Compare to see what changed and why.
```

### Cross-Reference Search

When you need related context:

```
1. "How does strategy execution work?"
2. "What validation do we do before strategy execution?"
3. "Examples of strategy execution failures"

Build complete mental model.
```

---

## Query Library (Copy-Paste Ready)

### Database Work
```
"How do we normalize condition_id for joins?"
"What's the atomic rebuild pattern?"
"How do we handle large table migrations?"
"Previous ClickHouse performance issues"
```

### Feature Implementation
```
"How did we implement [feature name]?"
"What skills were used for [feature type]?"
"Test-first approach for [feature area]"
```

### Debugging
```
"Previous [error type] errors and solutions"
"How did we debug [component] issues?"
"What causes [symptom] in our system?"
```

### Architecture
```
"Why did we choose [technology]?"
"How is [system] designed?"
"What are the trade-offs of [approach]?"
```

### Skills Usage
```
"Examples of using [skill name] skill"
"How do skills save tokens?"
"When should we use [skill] vs direct work?"
```

---

## ROI Comparison: Vector Search vs Alternatives

| Task | Vector Search | Explore Agent | Direct Search |
|------|---------------|---------------|---------------|
| Find past solution | 3-5 sec, 100 tokens | 5-10 min, 2,000 tokens | 15-20 min, N/A |
| Architecture context | 5-10 sec, 150 tokens | 10-15 min, 3,000 tokens | 30+ min, N/A |
| Debug similar issue | 5 sec, 100 tokens | 5-10 min, 2,000 tokens | 20+ min, N/A |
| Pattern learning | 10 sec, 200 tokens | 15-20 min, 4,000 tokens | 30+ min, N/A |

**Recommendation:** Always search vector DB first. Fall back to Explore agent only if no results.

---

## Best Practices Summary

### DO:
- ✅ Search **before** starting work
- ✅ Use **problem/concept** queries
- ✅ Review **top 3-5** results
- ✅ **Rephrase** if first search fails
- ✅ Search when **stuck >10 min**
- ✅ Use for **architecture context**

### DON'T:
- ❌ Use **keyword-only** queries
- ❌ Skip searching (wastes time)
- ❌ Give up after one search
- ❌ Use for **syntax questions**
- ❌ Search for **current data**
- ❌ Ignore **timestamp relevance**

---

## Related Resources

- **RULES.md:** Workflow authority
- **CLAUDE.md:** Quick reference (search here first for terminology)
- **.claude/session-state.json:** Current session context
- **~/.claude-self-reflect/:** Vector DB configuration

---

**Bottom Line:** The vector search gives you instant access to 350+ conversations of project knowledge. Use problem-based queries, review top 3-5 results, and always search before re-solving old problems. This saves 10-20 minutes per search vs Explore agent (95% fewer tokens).
