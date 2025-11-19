# Available Skills for Cascadian Project

**Purpose**: Document reusable skills to save tokens and time on repetitive tasks

**Token Savings**: Skills are loaded on-demand (30-50 tokens until needed), full content only when relevant

---

## 📚 What are Skills?

Skills are reusable workflows stored in `.claude/skills/` that Claude automatically invokes when relevant. They package expertise into discoverable capabilities, reducing repetitive prompting and context overhead.

**Key Benefits**:
- ✅ Extend Claude's abilities for specific workflows
- ✅ Share expertise across team via git
- ✅ Save tokens (progressive file disclosure)
- ✅ Compose multiple skills for complex tasks

---

## 🎯 Current Skills (Project-Specific)

### 1. Performance Profiler ⭐ NEW
**File**: `.claude/skills/performance-profiler/SKILL.md`
**Status**: ✅ Production-ready (validated on Goldsky CLOB optimization)
**When to Use**: Diagnosing why parallel workers aren't achieving expected speedup
**Time Saved**: 15-20 min per optimization task
**Token Savings**: ~1,950 tokens (97% reduction)

**Real-world validation**:
- Used to diagnose Goldsky backfill (64 workers = 24-hour ETA)
- Identified 74x serialization factor due to ClickHouse write contention
- Recommended batched inserts → achieved 3.5x improvement per worker
- Final result: 26-minute ETA with 128 workers (55x total improvement)

**How to Use**:
```
"Use performance-profiler skill to diagnose the [task name]"
→ Generates timing breakdown, identifies bottleneck, recommends specific fix
```

---

### 2. Database Query Builder
**File**: `.claude/skills/database-query/SKILL.md`
**Status**: ⚠️ To be created
**When to Use**: Need to query ClickHouse for data
**Time Saved**: 5-10 min per query (avoid syntax errors, know table structures)
**Token Savings**: ~500 tokens (avoids re-explaining schema each time)

**What it should include**:
```markdown
---
name: database-query
description: Query ClickHouse database for Cascadian data. Use when analyzing wallets, markets, trades, or PnL.
---

# Database Query Builder

## Available Tables
- `default.trades_canonical` - All trades with direction
- `default.wallet_positions` - Current positions
- `default.market_resolutions` - Resolved markets
- `default.fact_pnl` - P&L calculations

## Query Patterns
[Common query templates]

## Data Verification
Always verify: normalization, join formats, array indexing (1-based)
```

---

### 2. Vector Search Past Solutions
**File**: Built-in (claude-self-reflect MCP)
**Status**: ✅ Already available
**When to Use**: "Have we solved this before?", "What approach did we use?"
**Time Saved**: 10-20 min vs. Explore agent
**Token Savings**: ~1000 tokens (avoids re-reading conversations)

**How to Use**:
```typescript
// In conversation, ask:
"Search claude-self-reflect for: how we fixed PnL normalization"

// Claude will use claude-self-reflect MCP to search
// Returns relevant past conversations with context
```

---

### 3. Backfill Runner
**File**: `.claude/skills/backfill-runner/SKILL.md`
**Status**: ⚠️ To be created
**When to Use**: Historical data import needed
**Time Saved**: 15-20 min per run (setup + monitoring)
**Token Savings**: ~800 tokens (avoids re-explaining backfill patterns)

**What it should include**:
```markdown
---
name: backfill-runner
description: Run historical data backfill for Polymarket. Use when importing trades, positions, or market data.
---

# Backfill Runner

## Pattern
1. Check existing data coverage
2. Run backfill script with checkpointing
3. Monitor progress
4. Verify data quality

## Available Scripts
- `scripts/backfill-market-resolutions.ts`
- `scripts/backfill-wallet-trades.ts`

## Best Practices
- Use 8 workers for speed
- Enable checkpointing
- Verify coverage after completion
```

---

### 4. Report Organization
**File**: Built-in (RULES.md + `.claude/REPORT_ORGANIZATION_RULES.md`)
**Status**: ✅ Just created
**When to Use**: Starting a session, documenting findings
**Time Saved**: 5 min per session (no duplicate files)
**Token Savings**: ~300 tokens (avoids explaining organization each time)

**How to Use**:
- Follow RULES.md "Report & Documentation Organization" section
- Use ONE session report: `reports/sessions/YYYY-MM-DD-session-N.md`
- Update throughout session instead of creating multiple files

---

### 5. Stable Pack Patterns (IDN, NDR, PNL, etc.)
**File**: Built-in (CLAUDE.md "Stable Pack" section)
**Status**: ✅ Already documented
**When to Use**: Database work, ID normalization, PnL calculations
**Time Saved**: 3-5 min per task (no re-explaining patterns)
**Token Savings**: ~500 tokens (skill labels instead of full explanations)

**Available Skills**:
- **IDN**: ID Normalize (condition_id normalization)
- **NDR**: Net Direction (BUY/SELL from flows)
- **PNL**: PnL from Vector (payout vector calculations)
- **AR**: Atomic Rebuild (CREATE TABLE AS SELECT pattern)
- **CAR**: ClickHouse Array Rule (1-based indexing)
- **JD**: Join Discipline (normalized IDs only)
- **GATE**: Quality gates (neutrality thresholds)

**Usage**: Say "Apply **IDN** for condition IDs" instead of explaining normalization

---

### 6. Agent Delegation
**File**: Built-in (RULES.md "AI Agent Roles & Workflow")
**Status**: ✅ Already documented
**When to Use**: Task requires specialized analysis or large scope
**Time Saved**: 30-60 min (parallel execution)
**Token Savings**: ~2000 tokens (preserve context for decision-making)

**Available Agents**:
- **Explore**: Codebase navigation (use when searching > 10 files)
- **Plan**: Task breakdown (use when feature scope > 4 hours)
- **database-architect**: Schema design, query optimization
- **implementer**: Executes implementation with test-first approach
- **implementation-verifier**: QA and validation

**Decision Tree**:
```
Task > 4 hours? → Use Plan agent
Need to search codebase? → Use Explore agent
Database changes? → Use database-architect agent
Implementation ready? → Use implementer agent
Need QA? → Use implementation-verifier agent
```

---

## 🚀 Skills to Build (Priority Order)

### Priority 1: HIGH ROI (Build This Week)

#### 1. Database Query Builder Skill
**Time to Create**: 30-45 min
**Time Saved per Use**: 5-10 min
**Frequency**: 5-10 times/day
**ROI**: 25-50 min/day saved

**Files Needed**:
```
.claude/skills/database-query/
├── SKILL.md (main instructions)
├── TABLES.md (schema reference)
└── EXAMPLES.md (common queries)
```

#### 2. Test-First Development Skill
**Time to Create**: 30 min
**Time Saved per Use**: 10-15 min
**Frequency**: 3-5 times/day
**ROI**: 30-45 min/day saved

**What it should include**:
- Test-first workflow (write tests → implement → verify)
- Test template patterns
- When to use focused tests vs. comprehensive

---

### Priority 2: MEDIUM ROI (Build Next 2 Weeks)

#### 3. API Integration Pattern Skill
**Time to Create**: 45 min
**Time Saved per Use**: 15-20 min
**Frequency**: 2-3 times/week
**ROI**: 30-40 min/week saved

**What it should include**:
- Polymarket API patterns (CLOB, Gamma, Data API)
- Rate limiting and retry logic
- Error handling patterns

#### 4. Schema Migration Skill
**Time to Create**: 1 hour
**Time Saved per Use**: 20-30 min
**Frequency**: 1-2 times/week
**ROI**: 20-40 min/week saved

**What it should include**:
- Atomic rebuild pattern (CREATE TABLE AS SELECT)
- Verification queries before/after
- Rollback procedures

---

### Priority 3: LOW ROI (Build Later)

#### 5. UI Component Pattern Skill
**Time to Create**: 1-2 hours
**Time Saved per Use**: 10 min
**Frequency**: 1-2 times/week
**ROI**: 10-20 min/week saved

**Only if**: Actively working on UI features

---

## 📊 Token & Time Analysis

### Current State (Before Building Skills)

**Repetitive Tasks**:
1. Database queries: ~500 tokens/task, 5-10 tasks/day = **2,500-5,000 tokens/day**
2. Backfill patterns: ~800 tokens/task, 1-2 tasks/day = **800-1,600 tokens/day**
3. Agent delegation: ~2,000 tokens/task, 1-2 tasks/day = **2,000-4,000 tokens/day**
4. Test patterns: ~600 tokens/task, 3-5 tasks/day = **1,800-3,000 tokens/day**

**Total Current**: ~7,100-13,600 tokens/day on repetitive patterns

---

### After Building Skills (Estimated)

**With Skills**:
1. Database queries: ~50 tokens/task (Skill invocation) = **250-500 tokens/day** (-90%)
2. Backfill patterns: ~80 tokens/task = **80-160 tokens/day** (-90%)
3. Agent delegation: ~200 tokens/task = **200-400 tokens/day** (-90%)
4. Test patterns: ~60 tokens/task = **180-300 tokens/day** (-90%)

**Total With Skills**: ~710-1,360 tokens/day

**Savings**: ~6,400-12,200 tokens/day (**~90% reduction**)

**Cost Savings** (at $3/1M input tokens):
- Per day: $0.019-0.037 saved
- Per month: $0.57-1.11 saved
- Per year: $7-13 saved

**Time Savings** (more valuable):
- Per day: 60-120 min saved
- Per week: 7-14 hours saved
- Per month: 30-60 hours saved

---

## 📝 How to Create a Skill

### 1. Create Directory Structure
```bash
mkdir -p .claude/skills/skill-name
cd .claude/skills/skill-name
touch SKILL.md
```

### 2. Write SKILL.md with Frontmatter
```markdown
---
name: skill-name
description: What this skill does and when to use it (be specific!)
---

# Skill Name

## When to Use
[Specific triggers that indicate this skill is relevant]

## Instructions
[Step-by-step guidance for Claude]

## Examples
[Concrete examples of using this skill]

## Related Files
[Reference supporting files if needed]
```

### 3. Add Supporting Files (Optional)
```
.claude/skills/skill-name/
├── SKILL.md (required)
├── REFERENCE.md (optional - reference data)
├── EXAMPLES.md (optional - detailed examples)
└── scripts/ (optional - utility scripts)
```

### 4. Test the Skill
- Ask Claude a question that should trigger the skill
- Verify Claude recognizes when to use it
- Confirm instructions are clear and actionable

### 5. Refine Description
- If Claude doesn't invoke skill when expected: description too vague
- If Claude invokes skill incorrectly: description too broad
- Iterate until description precisely captures when to use

---

## 🎯 Quick Reference

### When to Build a Skill

**YES** - Build a skill when:
- ✅ Task is repetitive (use > 2x per week)
- ✅ Setup overhead significant (> 5 min)
- ✅ Context savings important (> 500 tokens)
- ✅ Multiple people on team need same pattern

**NO** - Don't build a skill when:
- ❌ One-time exploratory work
- ❌ Simple single-file changes
- ❌ Requires human judgment/review
- ❌ Skill doesn't exist yet

---

### Skill vs. Agent vs. Direct Work

| Approach | When to Use | Token Cost | Time Cost |
|----------|-------------|------------|-----------|
| **Direct work** | Simple, one-off tasks | High (full context) | Fast (0-1 min) |
| **Skill** | Repetitive, well-defined | Low (30-50 tokens) | Fast (0-1 min) |
| **Agent** | Complex, large scope | Medium (delegated) | Slow (5-10 min) |

---

## 🔍 Finding Skills

### Check Available Skills
```bash
# List project skills
ls -la .claude/skills/

# List personal skills (global)
ls -la ~/.claude/skills/
```

### Search Past Usage
```
"Search claude-self-reflect for: how we used [skill name]"
```

### Read Skill Documentation
```
Read .claude/skills/[skill-name]/SKILL.md
```

---

## 📚 External Resources

- **Official Skills Docs**: https://code.claude.com/docs/en/skills
- **Awesome Claude Skills**: https://github.com/travisvn/awesome-claude-skills
- **Skills Repository**: https://github.com/anthropics/skills
- **Best Practices**: https://www.anthropic.com/engineering/claude-code-best-practices

---

## ✅ Action Items

### This Session
1. [ ] Create database-query skill (HIGH priority)
2. [ ] Create test-first-development skill (HIGH priority)
3. [ ] Document skill creation in RULES.md

### Next Session
1. [ ] Create API integration pattern skill (MEDIUM priority)
2. [ ] Create schema migration skill (MEDIUM priority)
3. [ ] Measure actual token savings

### Future
1. [ ] Create UI component pattern skill (LOW priority, only if doing UI work)
2. [ ] Share skills across Cascadian projects
3. [ ] Build skill catalog for team

---

**Last Updated**: 2025-11-10
**Status**: Skills framework documented, building high-priority skills next
