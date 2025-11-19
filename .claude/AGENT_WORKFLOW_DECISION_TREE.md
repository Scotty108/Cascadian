# Agent Workflow Decision Tree

**Purpose**: Know exactly when to delegate to agents vs. do direct work vs. use skills

**Last Updated**: 2025-11-10

---

## 🎯 Quick Decision Flow

```
START: New Task
│
├─ Is this repetitive? (done > 2x/week)
│  ├─ YES → Use SKILL (if exists) or Direct Work
│  └─ NO → Continue
│
├─ Scope > 4 hours?
│  ├─ YES → Use PLAN Agent
│  └─ NO → Continue
│
├─ Need to search codebase? (>10 files)
│  ├─ YES → Use EXPLORE Agent
│  └─ NO → Continue
│
├─ Database schema design/optimization?
│  ├─ YES → Use DATABASE-ARCHITECT Agent
│  └─ NO → Continue
│
├─ Need to search past solutions?
│  ├─ YES → Use claude-self-reflect (vector search)
│  └─ NO → Continue
│
├─ Task < 30 seconds? (lookups, quick guidance)
│  ├─ YES → Ask CODEX (orchestrator)
│  └─ NO → Continue
│
└─ Default → CLAUDE Direct Work
```

---

## 🧠 Decision Matrix

| Task Type | Approach | Who | When | Time | Token Cost |
|-----------|----------|-----|------|------|------------|
| **Repetitive pattern** | Skill | Claude + Skill | Task done >2x/week | 0-1 min | Low (~50) |
| **Quick lookup** | Direct | Codex | < 30 sec answer | 0-1 min | Very Low |
| **Large scope (>4h)** | Agent | Plan agent | Complex feature | 5-10 min | Medium |
| **Codebase search** | Agent | Explore agent | >10 files to search | 5-10 min | Medium |
| **Database work** | Agent | database-architect | Schema/query design | 10-20 min | Medium |
| **Past solutions** | MCP | claude-self-reflect | "Have we done this?" | 0-3 sec | Very Low (~100) |
| **Implementation** | Direct or Agent | Claude or implementer | Ready to code | Varies | High |
| **Standard task** | Direct | Claude | Everything else | Varies | High |

---

## 🔧 Detailed Decision Trees

### Tree 1: Planning & Research

```
NEW FEATURE REQUEST
│
├─ Feature scope > 4 hours?
│  │
│  ├─ YES: Use PLAN AGENT
│  │  │
│  │  ├─ Plan agent breaks into phases
│  │  ├─ Creates task list
│  │  ├─ Identifies dependencies
│  │  └─ Suggests agent delegation
│  │
│  └─ NO: Feature scope 30min - 4 hours?
│     │
│     ├─ YES: CLAUDE DIRECT WORK
│     │  └─ Break into small chunks yourself
│     │
│     └─ NO: Feature scope < 30 min?
│        └─ YES: CLAUDE DIRECT WORK
│           └─ Just do it quickly
│
NEW INVESTIGATION / BUG
│
├─ Need to search codebase? (>10 files)
│  │
│  ├─ YES: Use EXPLORE AGENT
│  │  └─ Faster than manual search (5-10 min)
│  │
│  └─ NO: Know which files to check?
│     └─ YES: CLAUDE DIRECT WORK
│        └─ Read specific files directly
│
PAST SOLUTION LOOKUP
│
├─ "Have we solved this before?"
│  │
│  └─ YES: Use claude-self-reflect MCP
│     └─ Vector search past conversations (3 sec)
│
```

---

### Tree 2: Implementation & Execution

```
READY TO IMPLEMENT
│
├─ Is pattern documented in SKILL?
│  │
│  ├─ YES: Use SKILL
│  │  └─ Claude invokes automatically
│  │
│  └─ NO: Continue
│
├─ Implementation scope > 4 hours?
│  │
│  ├─ YES: Use IMPLEMENTER AGENT
│  │  ├─ Follows tasks.md
│  │  ├─ Test-first approach
│  │  └─ Reports progress
│  │
│  └─ NO: Implementation scope < 4 hours?
│     └─ YES: CLAUDE DIRECT WORK
│        └─ Faster for small tasks
│
DATABASE CHANGES
│
├─ Need schema design?
│  │
│  ├─ YES: Use DATABASE-ARCHITECT AGENT
│  │  ├─ Designs schema
│  │  ├─ Optimizes queries
│  │  ├─ Plans migrations
│  │  └─ Verifies normalization
│  │
│  └─ NO: Simple query or data check?
│     └─ YES: CLAUDE DIRECT WORK or DATABASE-QUERY SKILL
│
TESTING & VERIFICATION
│
├─ Need comprehensive QA?
│  │
│  ├─ YES: Use IMPLEMENTATION-VERIFIER AGENT
│  │  ├─ Runs full test suite
│  │  ├─ Validates coverage
│  │  └─ Marks roadmap complete
│  │
│  └─ NO: Quick verification?
│     └─ YES: CLAUDE DIRECT WORK
│        └─ Run specific tests
```

---

### Tree 3: Product & Specification

```
NEW PRODUCT / MAJOR PIVOT
│
└─ YES: Use PRODUCT-PLANNER AGENT
   ├─ Creates mission document
   ├─ Develops roadmap
   ├─ Defines tech stack
   └─ Sets success metrics
│
NEW FEATURE SPECIFICATION
│
├─ Need detailed requirements?
│  │
│  ├─ YES: Use SPEC-SHAPER AGENT
│  │  ├─ Asks targeted questions
│  │  ├─ Analyzes visuals
│  │  └─ Gathers complete requirements
│  │
│  └─ NO: Requirements clear?
│     └─ YES: Use SPEC-WRITER AGENT
│        └─ Creates technical specification
│
SPECIFICATION VERIFICATION
│
└─ Spec complete?: Use SPEC-VERIFIER AGENT
   ├─ QA gate
   ├─ Checks completeness
   └─ Validates accuracy
```

---

## 🎯 When to Use Each Agent

### EXPLORE Agent
**Use When**:
- ✅ Need to search >10 files
- ✅ Don't know exact file locations
- ✅ Finding patterns across codebase
- ✅ Understanding architecture

**Don't Use When**:
- ❌ Know exact file paths (use Read instead)
- ❌ Searching 1-3 specific files (use Read + Grep)
- ❌ Simple class/function lookup (use Glob)

**Time**: 5-10 min
**Token Cost**: Medium (~2000)
**ROI**: Saves 20-30 min vs. manual search

---

### PLAN Agent
**Use When**:
- ✅ Feature scope > 4 hours
- ✅ Complex multi-step task
- ✅ Need to break down requirements
- ✅ Unclear dependencies

**Don't Use When**:
- ❌ Feature scope < 4 hours (too much overhead)
- ❌ Requirements perfectly clear
- ❌ Simple single-component change

**Time**: 5-10 min
**Token Cost**: Medium (~2000)
**ROI**: Prevents rework, saves 2-4 hours on large features

---

### DATABASE-ARCHITECT Agent
**Use When**:
- ✅ Designing new schema
- ✅ Optimizing slow queries
- ✅ Planning migrations
- ✅ Database decisions needed

**Don't Use When**:
- ❌ Simple SELECT query (use Database-Query Skill)
- ❌ Adding one column (direct work)
- ❌ Quick data verification

**Time**: 10-20 min
**Token Cost**: Medium (~3000)
**ROI**: Prevents schema mistakes, saves hours of refactoring

---

### IMPLEMENTER Agent
**Use When**:
- ✅ Implementation scope > 4 hours
- ✅ Following established tasks.md
- ✅ Test-first approach needed
- ✅ Want parallel work (multiple terminals)

**Don't Use When**:
- ❌ Quick fixes (< 1 hour)
- ❌ Exploratory coding
- ❌ No tasks list yet (use Plan agent first)

**Time**: Varies (runs in background)
**Token Cost**: Medium-High (but preserves context)
**ROI**: Saves main terminal context, enables parallel work

---

### IMPLEMENTATION-VERIFIER Agent
**Use When**:
- ✅ Feature implementation complete
- ✅ Need comprehensive QA
- ✅ Ready to mark roadmap item done

**Don't Use When**:
- ❌ Still implementing (use direct work for quick tests)
- ❌ Not ready for full QA
- ❌ Just want to test one thing

**Time**: 10-30 min
**Token Cost**: Medium (~2000)
**ROI**: Ensures quality, catches issues early

---

### PRODUCT-PLANNER Agent
**Use When**:
- ✅ Starting new product
- ✅ Major pivot/redesign
- ✅ Need mission & roadmap

**Don't Use When**:
- ❌ Adding feature to existing product
- ❌ Small iteration

**Time**: 15-30 min
**Token Cost**: Medium (~2500)
**ROI**: Aligns team, prevents wasted work

---

### SPEC-SHAPER Agent
**Use When**:
- ✅ Requirements unclear or incomplete
- ✅ Need to ask targeted questions
- ✅ Complex feature with many edge cases

**Don't Use When**:
- ❌ Requirements perfectly clear
- ❌ Simple feature

**Time**: 10-20 min
**Token Cost**: Medium (~1500)
**ROI**: Prevents building wrong thing

---

### SPEC-WRITER Agent
**Use When**:
- ✅ Requirements gathered, need spec doc
- ✅ Want detailed technical specification

**Don't Use When**:
- ❌ Requirements still unclear (use Spec-Shaper first)
- ❌ Feature too simple to warrant spec

**Time**: 15-30 min
**Token Cost**: Medium (~2000)
**ROI**: Clear documentation, prevents misunderstandings

---

## 🚀 Special Cases & Workflows

### Multi-Terminal Orchestration

**Scenario**: Large feature with multiple parallel work streams

**Workflow**:
1. **Codex** (Main Terminal): Orchestrates and manages context
2. **Claude 2**: Runs PLAN agent → breaks down feature
3. **Claude 3**: Runs IMPLEMENTER agent → implements backend
4. **Claude Main**: Runs IMPLEMENTER agent → implements frontend

**Decision**: When Codex says "spawn new terminal" for parallel work

**Benefits**:
- Parallel execution (saves hours)
- Context preservation (each terminal focused)
- Orchestrated by Codex (prevents conflicts)

---

### Investigation Workflow

**Scenario**: Bug with unknown root cause

**Workflow**:
1. **Check past solutions**: Use claude-self-reflect (3 sec)
   - "Search for: similar bug fixes"
2. **If not found**: Use EXPLORE agent (5-10 min)
   - Find relevant files and patterns
3. **Analyze findings**: CLAUDE direct work
   - Read files, debug, test hypotheses
4. **Document solution**: Update session report
   - Not create multiple MD files

**Decision Tree**:
```
Bug Investigation
│
├─ Seen this before? → claude-self-reflect
│  ├─ Found → Apply solution
│  └─ Not found → Continue
│
├─ Where's the code? → EXPLORE agent
│  └─ Finds files
│
├─ Debug & fix → CLAUDE direct work
│
└─ Document → Session report (not new MD)
```

---

### Database Work Workflow

**Scenario**: Need to add field and update queries

**Workflow**:
1. **Simple add column**: CLAUDE direct work
   - Quick ALTER TABLE
2. **Schema redesign**: DATABASE-ARCHITECT agent
   - Comprehensive design
3. **Query optimization**: DATABASE-ARCHITECT agent
   - Analyze slow queries
4. **Data verification**: Database-Query Skill
   - Check results

**Decision Tree**:
```
Database Task
│
├─ Simple change? (1 column, 1 query)
│  └─ YES → CLAUDE direct work
│
├─ Schema design? (new table, relationships)
│  └─ YES → DATABASE-ARCHITECT agent
│
├─ Query optimization? (slow queries)
│  └─ YES → DATABASE-ARCHITECT agent
│
└─ Data check? (verify numbers)
   └─ YES → Database-Query Skill or CLAUDE direct work
```

---

## ❌ Anti-Patterns (Don't Do This)

### ❌ Using Explore Agent for Known Files
**Wrong**:
```
Use Explore agent to find src/components/Dashboard.tsx
```

**Right**:
```
Read src/components/Dashboard.tsx directly
```

**Why**: Explore agent takes 5-10 min. Direct Read takes 0-1 min.

---

### ❌ Using Plan Agent for Small Tasks
**Wrong**:
```
Task: Add console.log for debugging
Use Plan agent to break this down
```

**Right**:
```
Just add the console.log directly (< 30 sec)
```

**Why**: Plan agent overhead (5-10 min) > entire task time

---

### ❌ Creating Multiple MD Files Instead of Session Report
**Wrong**:
```
Create: BUG_INVESTIGATION.md
Create: BUG_FINDINGS.md
Create: BUG_SOLUTION.md
Create: BUG_COMPLETE.md
```

**Right**:
```
Update: reports/sessions/2025-11-10-session-1.md
(ONE file, updated throughout session)
```

**Why**: Prevents MD file chaos, easy to share context

---

### ❌ Using Skills for One-Off Exploratory Work
**Wrong**:
```
Build a skill for this one-time refactoring experiment
```

**Right**:
```
Just do the experiment directly
```

**Why**: Skills are for repetitive tasks (>2x/week)

---

### ❌ Not Using claude-self-reflect When Available
**Wrong**:
```
Use Explore agent to understand how we solved similar issue
(5-10 min search)
```

**Right**:
```
Use claude-self-reflect: "Search for: similar issue solution"
(3 sec search, ~100 tokens)
```

**Why**: Vector search is 100x faster and saves tokens

---

## 📊 ROI Comparison

| Approach | Setup Time | Execution Time | Token Cost | Use Cases | Total Time |
|----------|------------|----------------|------------|-----------|------------|
| **Direct Work** | 0 | Varies | High | Default | Fast |
| **Skill** | 30-60 min (one-time) | 0-1 min | Low (~50) | Repetitive (>2x/week) | Fast |
| **claude-self-reflect** | 0 | 0-3 sec | Very Low (~100) | Past solutions | Instant |
| **Explore Agent** | 0 | 5-10 min | Medium (~2000) | Codebase search | Slow |
| **Plan Agent** | 0 | 5-10 min | Medium (~2000) | >4h features | Slow |
| **Implementer Agent** | 0 | Varies | Medium-High | >4h implementation | Background |

**Key Insight**: Build skills for tasks done >2x/week. Use agents for large scope. Use direct work for everything else.

---

## 🎯 Summary Checklist

Before starting any task, ask:

- [ ] Is this repetitive? → **Use Skill** (if exists)
- [ ] Scope > 4 hours? → **Use Plan Agent**
- [ ] Need codebase search? (>10 files) → **Use Explore Agent**
- [ ] Database design/optimization? → **Use database-architect Agent**
- [ ] Have we solved this before? → **Use claude-self-reflect**
- [ ] Task < 30 seconds? → **Ask Codex**
- [ ] Otherwise? → **Claude Direct Work**

---

## 📚 Reference

- **Skills Documentation**: `.claude/skills.md`
- **Agent Documentation**: `.claude/agents/` (9 custom agents)
- **Report Organization**: `.claude/REPORT_ORGANIZATION_RULES.md`
- **Workflow Authority**: `RULES.md`

---

**Last Updated**: 2025-11-10
**Status**: Decision tree complete, integrated with RULES.md next
