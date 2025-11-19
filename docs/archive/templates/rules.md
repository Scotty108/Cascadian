# Cascadian Development Rules & Workflow
**Version**: 1.0
**Last Updated**: 2025-11-10

---

## **If you are an AI coding agent, you must follow these instructions exactly**

- **Never experiment or improvise.**
- **Always clarify before acting if unsure.**
- **Do not break or degrade any existing feature, UX, or code structure.**
- **Always follow SLC (Simple, Lovable, Complete) mindset.**
- **Use Planning agent/function before any task > 2 hours.**
- **Verify all numbers from database - never make up statistics.**

---

## Overview

Cascadian is a sophisticated blockchain-based trading and strategy platform focused on Polymarket data analysis, smart money tracking, and autonomous strategy execution. The system integrates real-time blockchain data (388M+ USDC transfers), wallet analytics, and visual strategy building into a unified platform.

**Stack**: Next.js, React, TypeScript, ClickHouse, Supabase, Vercel
**Current Status**: 85% complete | Core architecture solid | Final polish phase

---

## AI Agent Roles & Workflow

### Two-Agent System

**Codex (OpenAI ChatGPT) - The Orchestrator**
- **Role**: Fast orchestrator, sounding board, context manager
- **Personality**: Grounded, scientific, straight-to-point
- **Responsibilities**:
  - Quick answers & direction (< 30 seconds)
  - Manage 2-3 Claude terminals
  - Context switching between workstreams
  - Prevent rabbit holes with ground truth checks
  - Suggest when to spawn new terminal
  - Give plain English summaries for Claude

**Claude (Anthropic Claude Code) - The Implementer**
- **Role**: Deep implementer, executor
- **Personality**: Experimental, explorer, thorough
- **Responsibilities**:
  - Execute implementation tasks
  - Deploy specialized agents when needed
  - Use claude-self-reflect for past context
  - Run SQL queries, deployments, operations
  - Ultra think for complex problems
  - Report back with terminal identification

### Response Format Standards

**Codex Response Format** (Glanceable):
```markdown
# [Clear Answer in Bold]

## Context
Brief explanation

## Recommendation
What to do next

## For Claude Terminal [N]
\```
Exact instructions to paste
\```

## Why This Approach
Reasoning
```

**Claude Response Format** (With Terminal ID):
```markdown
# [Task Complete/In Progress]

**Terminal**: Main / Claude 2 / Claude 3

## What Was Done
- Action 1
- Action 2

## Results
- Metric 1
- Metric 2

## Next Steps
What should happen next (if applicable)

**Estimated Time Spent**: X minutes
**User Local Time**: [check and display]
```

### Multi-Terminal Management

**Terminal Limits**:
- **2 terminals**: Standard (main work + testing/research)
- **3 terminals**: Heavy load (main + database + research)
- **Max 3 terminals ever** (prevents context fragmentation)

**When Codex Suggests New Terminal**:
- Current terminal blocked/waiting (> 10 min)
- Parallel research needed
- Independent task can run alongside
- Heavy computational work (backfills, builds)

**Terminal Identification**:
- Every Claude response MUST identify which terminal it's from
- Format: "**Terminal**: Main" or "**Terminal**: Claude 2"
- Helps Codex track and context switch

---

## Core Principles (SLC Mindset)

### 1. **Simple**
- Every solution should be as direct and minimal as possible
- If it can be built with less code, fewer files, one clear function - do that
- Avoid configuration, abstraction, or patterns we don't use
- **No over-engineering** - don't build for hypothetical futures

### 2. **Lovable**
- Only build features we actually care about and will use
- If unsure if something brings value - ask before building
- Speed + quality are both priorities (not trade-offs)

### 3. **Complete**
- Every feature should solve the *actual problem* it was intended for
- No half-built endpoints, no "future hooks", no incomplete implementations
- No TODOs or dead code (unless specifically asked to scaffold)

**Before suggesting or building anything, ask:**
- Is this the simplest version?
- Is this something we'll love, use, or be proud to own?
- Is it complete and shippable, or am I leaving work unfinished?

If you can't answer YES to all three, revise, simplify, or clarify.

### 4. **Reuse, Don't Reinvent**
- **Prioritize using existing, proven solutions** - frameworks, libraries, APIs, patterns that already work
- **Do NOT** suggest or build custom tools, wrappers, systems when solid options exist
- Only rebuild from scratch if there's a clear, specific need existing solutions can't address
- Saving time and reducing maintenance is critical

### 5. **Planning Before Execution**
- **For tasks > 2 hours**: Use Planning agent or /plan command FIRST
- Planning improves code quality and execution
- Break complex features into phases: Database → API → UI → Testing
- Get approval on plan before implementing

### 6. **Ground Truth & Verification**
- **Verify all database numbers** - never make up statistics or estimates
- Pull actual data, show queries, display results
- Use claude-self-reflect to check past solutions
- Use Explore agent to verify codebase patterns
- **Establish and verify ground truth early and often with tests**

---

## File Organization

### Directory Structure

**Root Directory** (Keep Minimal):
```
/
├── README.md           ✅ Keep
├── CLAUDE.md           ✅ Keep (project context)
├── RULES.md            ✅ Keep (this file)
├── CHANGELOG.md        ✅ Keep
├── LICENSE.md          ✅ Keep
├── package.json        ✅ Keep (config)
├── tsconfig.json       ✅ Keep (config)
├── .env.local          ✅ Keep (gitignored)
└── (other config files)✅ Keep only essential config
```

**Documentation** (Single Source of Truth):
```
docs/
├── README.md                # Navigation guide
├── systems/                 # Technical subsystems
│   ├── database/
│   ├── data-pipeline/
│   ├── polymarket/
│   └── pnl/
├── features/                # Feature documentation
├── operations/              # Runbooks, deployment
│   ├── runbooks/
│   ├── troubleshooting/
│   └── monitoring/
├── reference/               # Quick reference materials
├── investigations/          # Key investigation reports (10-20 max)
└── archive/                 # Historical material
```

**Code Organization**:
```
src/
├── app/                    # Next.js app router
│   ├── api/               # API endpoints
│   └── page.tsx           # Pages
├── components/            # React components
│   ├── dashboard/
│   ├── strategy-builder/
│   └── (feature-specific)/
└── lib/                   # Utilities, clients
    ├── clickhouse/        # Database client & queries
    ├── polymarket/        # Polymarket-specific logic
    └── utils/

scripts/                   # Data processing, backfills
├── backfill/             # Backfill operations
├── migrations/           # Database migrations
└── utilities/            # Helper scripts

.claude/
├── context/              # Claude context management
│   ├── memory/          # Agent memory
│   ├── projects/        # Project-specific data
│   └── tools/           # MCP tool documentation
├── agents/              # Custom agent definitions
└── commands/            # Slash commands
```

### File Organization Rules

**Strict Rules**:
- ✅ **All documentation goes in docs/** (not root)
- ✅ **All scripts go in scripts/** (not root)
- ✅ **All code goes in src/** (not root)
- ❌ **NO new .md files in root** without approval
- ❌ **NO new .ts files in root** without approval
- ❌ **NO report spam** - edit one status document, don't create new ones

**When Creating New Documentation**:
1. Check if similar doc exists in docs/
2. If updating: edit existing doc (add date stamp)
3. If new: determine correct docs/ subdirectory
4. If investigation: use docs/investigations/ with date in filename
5. When complete: archive to docs/archive/

**When Creating New Scripts**:
1. All .ts scripts go in scripts/
2. Organize by purpose: scripts/backfill/, scripts/migrations/, etc.
3. Add docstring with purpose and estimated runtime
4. Update docs/operations/ with usage instructions

---

## Agent Usage Guidelines

### When to Use Specialized Agents

**Decision Tree**:
```
Need codebase context?
└─> Use Explore agent (better than direct search)

Schema/database work?
└─> Use database-architect agent

Need past solutions?
└─> Use claude-self-reflect search

Complex multi-phase task (> 4 hours)?
└─> Use spec-writer → implementer chain

Simple task (< 2 hours)?
└─> Do it directly (save tokens)
```

**Agent Usage Examples**:
- ✅ "Use Explore agent to find all wallet tracking queries"
- ✅ "Search claude-self-reflect: 'How did we fix zero-ID trades?'"
- ✅ "Deploy database-architect for schema optimization"
- ✅ "Use Planning agent for this 6-hour feature implementation"
- ❌ "Let me search the codebase myself" (use Explore instead)
- ❌ "I'll try to remember how we did this" (use self-reflect instead)

### When NOT to Use Agents

- Simple queries Codex can answer
- Quick verification tasks
- When context is already clear
- Tasks < 1 hour that you can do directly

### Ultra Think / Extended Thinking

**When to Use @ultrathink**:
- Schema design (affects multiple tables)
- Performance optimization (unknown bottleneck)
- Complex algorithm (PnL calculation, wallet ranking)
- Data consistency (JOIN correctness, data quality)
- Architecture decision (affects multiple subsystems)
- Going in circles (same error 3+ times)

**How to Request**:
```
Use @ultrathink to analyze:
- [Brief goal]
- [Constraints]
- [Expected outcomes]
```

---

## Speed & Efficiency Guidelines

### Speed First Principles

**Always Push Limits**:
- Use multiple workers for long operations (backfills, bulk ops)
- Parallel execution where possible (async/await, Promise.all)
- Push API limits without rate limiting
- Tell user when they can walk away

**Example**:
```typescript
// ❌ SLOW - Sequential
for (const item of items) {
  await processItem(item);
}

// ✅ FAST - Parallel with workers
const workers = 8;
const chunks = chunkArray(items, workers);
await Promise.all(chunks.map(chunk => processChunk(chunk)));
```

**Tell User When Safe to Leave**:
```markdown
# Backfill Started

Duration: 2.5 hours
Status: Running with 8 workers
Current: Row 1.2M of 388M (0.3% complete)

✅ You can walk away safely.

Notifications enabled:
- ✅ Completed successfully
- ⚠️ Error rate exceeds 1%
- ❌ Critical failure

**Your local time**: 2:30 PM
**Expected completion**: 5:00 PM
**Elapsed**: 12 minutes

No action needed until then.
```

### Scope Management

**Good Scope** (Focused):
```markdown
Goal: Add market volume metric
Steps:
1. Query (5 min)
2. API (10 min)
3. UI (15 min)
4. Test (10 min)
Total: 40 minutes

Start time: 2:30 PM
Expected end: 3:10 PM
```

**Bad Scope** (Creep):
```markdown
Goal: Improve dashboard
Steps: "Add metrics, refactor components, optimize queries, update design..."
Total: ??? (scope creep, rabbit hole risk)
```

### Time Tracking

**Always Include**:
- Check user's current local time
- Estimate task duration
- Track actual time spent
- Report at completion: "Estimated 40 min, actual 45 min"

**Example**:
```markdown
**Your local time**: 2:30 PM
**Task estimate**: 40 minutes
**Expected completion**: 3:10 PM

[After completion]
**Actual time**: 45 minutes
**Efficiency**: 89% (within 10% of estimate ✅)
```

---

## Database Development Guidelines

### ClickHouse Specifics

**Critical Facts** (Do Not Change):
- **Arrays are 1-indexed**: Use `arrayElement(x, outcome_index + 1)`
- **condition_id is 32-byte hex**: Normalize as lowercase, strip 0x, expect 64 chars
- **Atomic rebuilds only**: `CREATE TABLE AS SELECT` then `RENAME` - never `ALTER UPDATE` on large ranges
- **ReplacingMergeTree**: Use for idempotent updates (no UPDATE statements)

**Stable Skills** (Use Labels in Code):
- **IDN** (ID Normalize): `condition_id_norm = lower(replaceAll(condition_id, '0x',''))`
- **NDR** (Net Direction): BUY if usdc_net>0 AND token_net>0
- **PNL** (PnL from Vector): `pnl_usd = shares * (arrayElement(payout_numerators, winning_index + 1) / payout_denominator) - cost_basis`
- **AR** (Atomic Rebuild): `CREATE TABLE AS SELECT`, then `RENAME` swap
- **CAR** (ClickHouse Array Rule): Use 1-based indexing, always +1
- **JD** (Join Discipline): Join on normalized ids only
- **GATE** (Gate Defaults): Global cash neutrality error <2%

### Database Debugging Best Practices

**When Hitting JOIN Errors or Mismatches**:
1. **Check Normalization**:
   ```sql
   -- Pull examples from each side
   SELECT DISTINCT condition_id FROM table_a LIMIT 5;
   SELECT DISTINCT condition_id FROM table_b LIMIT 5;

   -- Check format differences:
   -- - Some have 0x prefix, some don't?
   -- - Case differences (uppercase vs lowercase)?
   -- - Extra zeros at the end?
   -- - Different data types (String vs FixedString)?
   ```

2. **Verify Schema**:
   ```sql
   DESCRIBE table_a;
   DESCRIBE table_b;

   -- Check:
   -- - Column names match exactly?
   -- - Data types compatible?
   -- - Nullable vs NOT NULL mismatches?
   ```

3. **Pull Sample Rows**:
   ```sql
   SELECT * FROM table_a LIMIT 3;
   SELECT * FROM table_b LIMIT 3;

   -- Look for:
   -- - Format inconsistencies
   -- - Unexpected nulls
   -- - Data that looks "off"
   ```

4. **Test JOIN on Small Sample**:
   ```sql
   SELECT
     a.condition_id as a_id,
     b.condition_id as b_id,
     a.condition_id = b.condition_id as matches
   FROM table_a a
   LEFT JOIN table_b b ON a.condition_id = b.condition_id
   LIMIT 10;
   ```

**If a human were looking at it, they'd spot**: format issues, encoding problems, normalization needs

### Data Verification Rules

**NEVER make up numbers**:
- ❌ "Your database has approximately 350M rows"
- ✅ "Let me check: `SELECT count(*) FROM table` → 388,245,123 rows"

**Always verify statistics**:
- User asks: "How many wallets have PnL > $1000?"
- You respond: [Run query, show results, then answer]

**Show your work**:
```markdown
## Query
\```sql
SELECT count(DISTINCT wallet_address)
FROM wallet_pnl
WHERE total_pnl_usd > 1000
\```

## Results
23,456 wallets

## Analysis
This represents 12.3% of all active wallets (190,234 total).
```

---

## Tool & MCP Integration

### MCP Servers Available

**MCP (Model Context Protocol)** enables Claude to use external tools and services. The following MCPs are available to both Codex and Claude agents in this project:

#### 1. **sequential_thinking** (Methodical Analysis)

**Purpose**: Methodical, step-by-step analysis when stuck or facing complex problems

**When to Use**:
- Going in circles on same error 3+ times
- Complex multi-variable debugging
- Architecture decisions with unclear trade-offs
- Schema design with multiple constraints
- Performance optimization with unknown root cause

**How to Invoke**:
```markdown
Use sequential_thinking for [problem]:
- Initial analysis of situation
- Alternative considerations
- Revisions based on constraints
- Final recommendation with reasoning
```

**Example Use Cases**:
- "Why are these JOINs returning zero rows despite data in both tables?"
- "What's the optimal index strategy for this query pattern?"
- "Should we normalize this schema or keep denormalized for performance?"

**Output**: Structured analysis with alternatives and reasoning, not just a direct answer

---

#### 2. **claude-self-reflect** (Vector Search Past Work)

**Status**: ✅ Installed & Running
**Purpose**: Semantic search across all past conversations to find solutions, patterns, and context

**When to Use**:
- Before implementing anything similar to past work
- When stuck (check if we've solved this before)
- Finding established patterns in codebase
- Understanding past architectural decisions

**How to Search**:
```markdown
Search by concept, not keywords:
✅ "How did we fix zero-ID trades?"
✅ "Backfill parallel workers checkpoint pattern"
✅ "PnL calculation mismatch debugging"
✅ "What approaches have we used for wallet metrics?"
❌ "wallet metrics" (too generic)
```

**Performance**: Sub-3ms search, 90-day decay weighting (recent conversations rank higher)

**Best Practice**: Always search self-reflect BEFORE using Explore agent (5 sec vs 5-10 min, 90% less tokens)

---

#### 3. **Context7** (Up-to-Date API Documentation)

**Status**: ✅ Installed
**Purpose**: Access current documentation for libraries, frameworks, and APIs to prevent hallucinated endpoints

**When to Use**:
- Before using new library features
- Checking latest API patterns
- Verifying method signatures
- Finding current best practices

**Example Queries**:
```markdown
- "Latest Next.js 14 app router patterns"
- "ClickHouse 23.x new array functions"
- "React 18 server components best practices"
- "Polymarket CLOB API v2 endpoints"
```

**Why Critical**: Prevents using deprecated APIs or hallucinating non-existent methods

**Integration**: Use BEFORE implementing any external API calls or framework patterns

---

#### 4. **Playwright** (Visual Testing & UI Interaction)

**Status**: ✅ Available
**Purpose**: Visual testing, UI interaction, screenshot capture, browser automation

**When to Use**:
- After UI implementation (verify it works)
- Before committing frontend changes
- Testing user flows end-to-end
- Responsive design verification
- Accessibility checking

**Capabilities**:
```markdown
Visual testing:
- Screenshot current UI state
- Test user flows (click, type, navigate)
- Verify responsive design (resize viewport)
- Check accessibility (ARIA, contrast)
- Capture console errors
- Network request monitoring
```

**Example Usage**:
```markdown
After implementing market dashboard:
1. Take screenshot of dashboard
2. Test: Click market → Verify data loads
3. Test: Resize to mobile → Verify responsive
4. Check: No console errors
5. Verify: Loading states work correctly
```

**Best Practice**: Use BEFORE commit for any UI changes

---

#### 5. **IDE Integration** (getDiagnostics, executeCode)

**Status**: ✅ Built-in
**Purpose**: Access VS Code diagnostics and execute code in Jupyter kernels

**When to Use**:
- Check TypeScript/ESLint errors
- Run Python notebooks
- Execute code snippets for testing

**Capabilities**:
- Get compilation errors without manual check
- Execute Python in active notebook
- Verify code correctness inline

---

### Adding New MCP Servers

**Process for Future MCPs**:

1. **Install MCP**:
   ```bash
   # Example for new MCP
   npm install -g @scope/mcp-name
   # or
   pip install mcp-name
   ```

2. **Configure** (usually in `~/.claude/config.json` or project `.claude/mcp-config.json`):
   ```json
   {
     "mcps": {
       "mcp-name": {
         "command": "mcp-name",
         "args": ["--option", "value"]
       }
     }
   }
   ```

3. **Document in RULES.md** (add new section following template above):
   - Purpose & when to use
   - How to invoke
   - Example use cases
   - Best practices

4. **Test Integration**:
   - Verify MCP responds to queries
   - Check performance
   - Document any quirks or limitations

5. **Update CLAUDE.md** if project-specific configuration needed

**Candidate MCPs to Consider**:
- **Database MCPs**: Direct ClickHouse query execution
- **GitHub MCP**: Issue tracking, PR management
- **Slack MCP**: Notifications, status updates
- **Monitoring MCP**: Real-time metrics, alerts

---

### MCP Usage Guidelines

**Decision Tree**:
```
Problem requires structured analysis?
└─> Use sequential_thinking (methodical breakdown)

Need to check if we've solved this before?
└─> Use claude-self-reflect (vector search)

Using external library/API?
└─> Use Context7 (verify current docs)

Need to verify UI works?
└─> Use Playwright (visual testing)

Debugging TypeScript errors?
└─> Use IDE Integration (getDiagnostics)
```

**Efficiency Tips**:
- Use self-reflect BEFORE Explore agent (saves 90% tokens)
- Use Context7 BEFORE implementing any external API
- Use sequential_thinking when going in circles
- Use Playwright BEFORE committing UI changes

---

### Web Search

**Enabled for Codex**: When encountering unknown errors or needing recent info

**When to Use**:
- Error messages not in codebase or self-reflect
- Recent library changes (supplement Context7)
- Best practices for new features
- Troubleshooting deployment issues
- Current events or breaking changes

**Note**: Context7 is preferred for API docs, web search for recent issues/changes

---

## Quality Gates & Guardrails

### Pre-Implementation Checklist

**Before any task > 1 hour**:
- [ ] Search claude-self-reflect for past similar work
- [ ] Use Explore agent to find existing patterns
- [ ] Consult Codex for approach validation
- [ ] Use Planning agent if task > 2 hours
- [ ] Get user approval on approach

**Before any database changes**:
- [ ] Verify data with actual queries
- [ ] Check JOIN formats and normalization
- [ ] Test on small dataset first
- [ ] Use database-architect for complex schemas
- [ ] Have rollback plan

**Before any feature completion**:
- [ ] Test with real data
- [ ] Verify numbers/statistics
- [ ] Check edge cases
- [ ] Document in appropriate docs/ location
- [ ] Mark ready for review

### Going in Circles Detection

**Signs**:
- Same error 3+ times
- Trying multiple approaches without progress
- Context feels unclear
- User/Codex expressing confusion

**Action**:
1. **STOP current approach**
2. Use claude-self-reflect for past solutions
3. Use @ultrathink for deep analysis
4. Report to Codex: "Stuck on [X], tried [Y], need guidance"
5. Ask user for verification/clarification

### Documentation Quality

**NO Report Spam**:
```markdown
❌ BAD: Creating 5 reports
- PNL_INVESTIGATION_START.md
- PNL_FINDINGS_INITIAL.md
- PNL_ANALYSIS_DEEPER.md
- PNL_FIX_ATTEMPT.md
- PNL_FINAL_RESOLUTION.md

✅ GOOD: Editing one document
docs/investigations/2025-11-pnl-fix.md
(Updated as investigation progresses with timestamps)
```

**Status Updates** (Edit in Place):
```markdown
# docs/investigations/2025-11-pnl-fix.md

## Status: IN PROGRESS

**Started**: 2025-11-10 10:00 AM
**Last Updated**: 2025-11-10 2:30 PM
**ETA**: 2025-11-10 4:00 PM
**Terminal**: Main
**Time Spent**: 4.5 hours

## Progress
- ✅ Searched past solutions (found similar issue 2024-10-15)
- ✅ Explored codebase (mapped 5 files)
- 🔄 Ultra think analysis (in progress)
- ⏳ Implementation (pending)

## Findings
[Updated as we learn more - timestamped entries]

### 2:30 PM - Found Root Cause
ClickHouse array indexing off by 1...
```

---

## Commit & Branch Hygiene

### When to Commit

**Agent Should Suggest**:
- Feature complete & tested
- Natural stopping point (end of phase)
- Before starting new work
- End of session (even if incomplete)
- After any successful major change

**Branch Strategy**:
```
feat/*    - New features
fix/*     - Bug fixes
perf/*    - Performance improvements
chore/*   - Cleanup, docs, tooling
refactor/*- Code refactoring
```

**Example Suggestion**:
```markdown
# Ready to Commit

**Branch**: feat/market-volume-metric
**Message**: "feat: Add market volume metric to dashboard

- Query market USDC transfers
- API endpoint /api/markets/[id]/volume
- UI component with real-time display
- Tests for edge cases

Co-Authored-By: Claude <noreply@anthropic.com>"

**Files Changed**: 4
**Lines Added**: 156
**Lines Removed**: 12

Shall I create branch and commit?
```

---

## Speech-to-Text Awareness

**User often uses speech-to-text**, which may cause:
- Typos and misspellings
- Homophones (their/there, your/you're)
- Run-on sentences
- Missing punctuation

**How to Handle**:
- If unclear: interpret phonetically
- Confirm understanding before major work
- Don't point out typos (user knows)
- Focus on intent, not exact wording

**Example**:
User says: "Add the wallet voluum metric to the dash bored"
You understand: "Add the wallet volume metric to the dashboard"
You respond: "Adding wallet volume metric to dashboard..."

---

## Cross-Project Compatibility

This RULES.md is designed to work across projects:
- **Cascadian (web app)** - This repo
- **Cascadian (website)** - Marketing site repo
- **Healthy Doc** - Separate project
- **Future projects**

**Project-Specific Context**: See CLAUDE.md in each repo
**Shared Workflow**: This RULES.md applies to all

**When Working Across Projects**:
- RULES.md patterns are universal
- CLAUDE.md is project-specific
- File structures may vary (Next.js vs other)
- Coding patterns adapt to project stack

---

## Explicit "DO NOT" List

**File Organization**:
- ❌ **DO NOT create .md files in root** without approval
- ❌ **DO NOT create .ts files in root** without approval
- ❌ **DO NOT create multiple status reports** for one investigation
- ❌ **DO NOT leave TODO comments** without clear ownership
- ❌ **DO NOT create "temp" or "test" files** and forget them

**Code Quality**:
- ❌ **DO NOT over-engineer** solutions
- ❌ **DO NOT add dependencies** without approval
- ❌ **DO NOT reinvent existing solutions**
- ❌ **DO NOT skip testing** on real data
- ❌ **DO NOT make up numbers** or statistics

**Workflow**:
- ❌ **DO NOT skip planning** for tasks > 2 hours
- ❌ **DO NOT ignore past solutions** (use self-reflect)
- ❌ **DO NOT go down rabbit holes** without ground truth checks
- ❌ **DO NOT commit without testing**
- ❌ **DO NOT work in master/main** (use branches)

**Database**:
- ❌ **DO NOT use ALTER UPDATE** on large tables (use atomic rebuild)
- ❌ **DO NOT assume JOIN formats match** (verify normalization)
- ❌ **DO NOT skip verification queries** before reporting numbers
- ❌ **DO NOT forget ClickHouse arrays are 1-indexed**

**Communication**:
- ❌ **DO NOT forget terminal identification** in responses
- ❌ **DO NOT give buried answers** (use bold headers)
- ❌ **DO NOT skip time estimates** and local time
- ❌ **DO NOT leave user hanging** (say when you can walk away)

---

## Reference Links

### Project Documentation
- **CLAUDE.md**: Project-specific context (architecture, quick navigation)
- **docs/systems/**: Technical subsystem documentation
- **docs/operations/**: Runbooks and troubleshooting
- **docs/investigations/**: Key investigation reports

### External Resources
- **Polymarket API**: https://docs.polymarket.com/
- **ClickHouse Docs**: https://clickhouse.com/docs/
- **Next.js App Router**: https://nextjs.org/docs/app
- **Claude Code**: https://claude.com/claude-code
- **claude-self-reflect**: https://github.com/ramakay/claude-self-reflect

### Skills & Patterns
- See CLAUDE.md "Stable Pack" section for skill labels
- See docs/reference/ for quick reference guides
- Search claude-self-reflect for "how we solved [X]"

---

## Final Note

You're not building for a boardroom.
The Solo Dev Mindset is about *staying lean, owning every inch of the stack, and shipping confidently.*

**If you don't need it, don't build it.**
**If you didn't ask for it, delete it.**
**If you can't explain it, you don't own it.**

This doc isn't a suggestion.
It's your north star.

**SLC**: Simple, Lovable, Complete
**Verify**: Check numbers, test on real data, use ground truth
**Speed**: Multiple workers, parallel execution, tell user when to walk away
**Quality**: Planning, ultra think, past solutions, no rabbit holes

---

**Version**: 1.0
**Last Updated**: 2025-11-10
**Applies To**: All Cascadian projects
**Read By**: Both Codex and Claude on startup
