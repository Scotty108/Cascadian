# Cascadian Workflow System Design Plan
**Generated**: 2025-11-10
**Mode**: Repository Orchestrator - Planning Phase
**Status**: ⚠️ NO IMPLEMENTATION YET - Design & Requirements Only

---

## Executive Summary

**Goal**: Design a comprehensive, reusable workflow system for managing multiple AI agents (Codex, Claude, specialized agents) across multiple projects with clear roles, efficient collaboration, and guardrails to prevent chaos.

**Current Pain Points**:
- 866 markdown files scattered across 5 organizational systems
- No clear workflow for when to use Codex vs Claude vs agents
- Report/documentation spam from agents
- Context loss when switching between terminals
- Going down rabbit holes without ground truth checks
- Unclear when to deploy parallel work vs sequential
- Missing clear rules for file organization

**Desired Outcome**:
- Single RULES.md that both Codex & Claude read on startup
- Clear roles: Codex (orchestrator, fast), Claude (implementer, deep work)
- Optimized agent deployment strategy
- Speed-first mentality with quality guardrails
- Clean documentation organization
- Cross-project reusability

---

## Part 1: Requirements Summary (Your Brain Dump)

### Workflow Structure

**Two-Agent System**:
1. **Codex** (OpenAI ChatGPT)
   - Fast orchestrator and sounding board
   - Glanceable, structured responses (bold headers, clear answers)
   - More grounded/"scientist" personality
   - Manages multiple Claude terminals (max 3)
   - Gives plain English summaries for Claude instructions
   - Context switches between multiple workstreams

2. **Claude** (Anthropic Claude Code)
   - Deep implementer
   - More experimental/"explorer" personality
   - Accesses specialized agents (Explore, database-architect, etc.)
   - Has claude-self-reflect for vector search
   - Multiple terminals (2-3 concurrent) for parallel work

**Communication Flow**:
```
User ←→ Codex (orchestrator)
         ↓ (copy/paste context)
         ↓→ Claude Terminal 1 (main work)
         ↓→ Claude Terminal 2 (parallel task)
         ↓→ Claude Terminal 3 (research/exploration)
```

### Agent & Tool Usage

**When to Use Specialized Agents**:
- **Explore Agent**: Codebase navigation (better than Codex's search)
- **database-architect**: Schema design, query optimization
- **claude-self-reflect**: Vector search past conversations for context/ground truth
- **Other agents**: spec-writer, implementer, verification, etc.

**When NOT to Use Agents**:
- Simple queries Codex can answer
- Quick verification tasks
- When context is already clear

**Tool Access**:
- Claude: SQL queries, deployments, database operations (don't ask user)
- Codex: Should know it can't directly execute but can guide
- Both: Web search (enable for Codex), MCP Playwright, notifications

### Quality & Speed Guidelines

**Speed First**:
- Push API limits without rate limiting
- Multiple workers for long operations (backfills, bulk ops)
- Parallel execution where possible
- Tell user when they can walk away

**Quality Guardrails**:
- Don't create report spam (edit one status doc)
- No scope creep - one thing at a time
- Ultra think for complex problems
- Know when going in circles → step back
- Verify truth with Explore/Self-Reflect before implementing

**When to Use "Ultra Think"**:
- Architecture decisions affecting multiple subsystems
- Debugging unknown performance issues
- Complex algorithm design
- Data consistency problems
- Schema design (use @ultrathink label)

### Documentation & Organization

**Current Chaos (from inventory)**:
- 564 files in root (should be ~10-15)
- 163 files in docs/ (well-organized ✅)
- 125 files in Agent OS folders (historical)
- 83 PNL files, 51 Database files, 45 Resolution files (duplicates)

**Target Structure**:
```
Project Root/
├── README.md
├── CLAUDE.md              # Project-specific context
├── RULES.md               # Workflow rules (read on startup)
├── CHANGELOG.md
├── LICENSE.md
│
├── .claude/
│   ├── context/
│   │   ├── memory/        # Agent memory system
│   │   ├── projects/      # Project-specific data
│   │   └── tools/         # MCP tool documentation
│   ├── agents/            # Custom agent definitions
│   └── commands/          # Slash commands
│
└── docs/                  # Single source of truth
    ├── systems/           # Technical subsystems
    ├── features/          # Feature docs
    ├── operations/        # Runbooks, deployment
    ├── reference/         # Quick references
    ├── investigations/    # Key reports only (10-20 max)
    └── archive/           # Historical material
```

**Documentation Rules**:
- No new MD files in root (except approved list)
- Edit one status document, don't create new reports
- Date stamp investigation reports
- Archive completed work immediately

### Multi-Project Support

**Projects**:
- Cascadian (web app repo)
- Cascadian (website repo)
- Healthy Doc
- Future projects

**Requirements**:
- RULES.md reusable across projects
- Project-specific context in CLAUDE.md
- Shared workflow patterns
- Per-project .claude/context/ folders

### Workflow Ergonomics

**Settings to Configure**:
- ✅ Enter-to-send in Codex (user wants this)
- ✅ Notifications when tasks finish (both Codex & Claude)
- ✅ Web search enabled for Codex
- ✅ MCP Playwright integration
- ✅ Design language/colors documentation

**User Patterns**:
- Speech-to-text (may have typos/phonetic errors)
- Copies context from Claude → Codex to ping-pong
- Bad at branching (agents should suggest commits/branches)
- Prioritizes speed & efficiency
- Wants to walk away when safe to do so

### Technical Integration

**MCPs to Research & Install**:
- ✅ Playwright (visual testing, UI interaction)
- ✅ claude-self-reflect (vector search)
- Research: Best MCPs for development workflow
- Future: Gemini 3.0 CLI compatibility

**Skills System**:
- Research optimization opportunities
- skill.md as manual for available skills
- When to create custom skills vs use direct work

**Agent OS**:
- Analyze how it works (context management, specs)
- Reinvent with new workflow system
- Keep good ideas (product/, features/, active/finished/)

---

## Part 2: Document System Design

### Core Documents & Their Roles

#### 1. RULES.md (Workflow Authority)
**Location**: Project root
**Read By**: Both Codex & Claude on startup
**Purpose**: Single source of truth for workflow, file organization, coding practices

**Contents**:
```markdown
# Repository Rules & Workflow

## File Organization
- Where .md files go (docs/ structure)
- Where .ts files go (scripts/, src/)
- What stays in root (README, CLAUDE.md, RULES.md only)

## Workflow Guidelines
- When to use Codex vs Claude
- When to spawn new Claude terminal
- When to deploy agents vs direct work
- How to communicate between terminals

## Coding Practices
- Speed first (multiple workers, parallel execution)
- Quality gates (ultra think, ground truth checks)
- No report spam (edit one status doc)
- Branch/commit hygiene

## Agent Usage Rules
- Explore agent for codebase navigation
- claude-self-reflect for past context
- database-architect for schema work
- When NOT to use agents

## Problem-Solving Framework
- When stuck: use self-reflect → ground truth
- When going in circles: step back, ultra think
- When context needed: search past conversations
- When to ask user for verification

## Multi-Terminal Management
- Codex tracks all Claude terminals
- Max 3 Claude terminals (2 ideal, 3 for heavy load)
- Plain English summaries for context switching
- When to suggest new terminal
```

#### 2. CLAUDE.md (Project-Specific Context)
**Location**: Project root
**Read By**: Claude (current content is EXCELLENT)
**Purpose**: Project-specific technical context, architecture, quick navigation

**Keep From Current**:
- ✅ Project overview & status
- ✅ Quick navigation table
- ✅ Key terminology
- ✅ System architecture
- ✅ Stable Pack (frozen facts, skill labels)
- ✅ Time estimates
- ✅ Development quick reference
- ✅ Memory system docs
- ✅ Agent delegation patterns

**Blend With**: RULES.md for workflow (avoid duplication)

#### 3. Mindset.md (From Template - To Be Adapted)
**Location**: .claude/context/ or docs/
**Read By**: Claude (optional, for complex decision-making)
**Purpose**: Decision-making framework, problem-solving approach

**Adapt From iOS Template**:
- Take structure/philosophy
- Remove iOS-specific content
- Add Cascadian-specific principles:
  - Speed & efficiency focus
  - Data pipeline patterns
  - Blockchain/Polymarket domain knowledge
  - When to optimize vs when to ship

#### 4. Article.md (From Template - To Be Adapted)
**Location**: .claude/context/ or docs/
**Read By**: Claude (optional, advanced patterns)
**Purpose**: Advanced patterns, best practices, examples

**Adapt From iOS Template**:
- Take example structure
- Replace with Cascadian examples:
  - ClickHouse query optimization
  - Parallel backfill patterns
  - Agent coordination examples
  - Workflow decision trees

### Document Hierarchy & Reading Order

**Codex Startup**:
1. Reads RULES.md (workflow authority)
2. Aware of CLAUDE.md (for Claude coordination)
3. Ready to orchestrate

**Claude Startup**:
1. Reads RULES.md (workflow authority)
2. Reads CLAUDE.md (project context)
3. Optionally: Mindset.md, Article.md (advanced patterns)
4. Ready to implement

**Key Principle**: Avoid duplication between RULES.md and CLAUDE.md
- RULES.md = **HOW** to work (workflow, organization)
- CLAUDE.md = **WHAT** to work on (project context, architecture)

---

## Part 3: Agent Collaboration Model

### Codex Role (Fast Orchestrator)

**Personality**: Grounded, scientific, straight-to-point

**Primary Responsibilities**:
1. Quick answers & direction (fast response mode)
2. Orchestrate multiple Claude terminals
3. Context switching between workstreams
4. Prevent rabbit holes (ground truth checks)
5. Suggest when to spawn new terminal
6. Give plain English summaries for Claude

**Response Format** (IMPORTANT):
```markdown
# [Clear Answer in Bold]

## Context
Brief explanation of the situation

## Recommendation
What to do next

## For Claude Terminal [N]
```
Exact text to paste into Claude terminal
```

## Why This Approach
Reasoning (helps user understand)
```

**When Codex Suggests New Terminal**:
- Current terminal blocked/waiting
- Parallel research needed
- Independent task can run alongside
- Max 3 terminals (suggest cautiously)

**What Codex Should NOT Do**:
- Long explanations (be concise)
- Buried answers in paragraphs (make glanceable)
- Execute code directly (guide Claude instead)
- Get lost in implementation details

### Claude Role (Deep Implementer)

**Personality**: Experimental, explorer, thorough

**Primary Responsibilities**:
1. Execute implementation tasks
2. Deploy specialized agents when needed
3. Use claude-self-reflect for past context
4. Run SQL queries, deployments, operations
5. Verify work before marking complete
6. Report back to user (for Codex orchestration)

**When to Use Agents**:
```
Decision Tree:
├─ Need codebase context?
│  └─ Use Explore agent (better than search)
├─ Schema/database work?
│  └─ Use database-architect agent
├─ Need past solutions?
│  └─ Use claude-self-reflect search
├─ Complex multi-phase task?
│  └─ Use spec-writer → implementer chain
└─ Can do directly?
   └─ Do it (save tokens)
```

**Agent Usage Examples**:
- ✅ "Use Explore agent to find all wallet tracking queries"
- ✅ "Search claude-self-reflect: 'How did we fix zero-ID trades?'"
- ✅ "Deploy database-architect for schema optimization"
- ❌ "Let me search the codebase myself" (use Explore instead)
- ❌ "I'll try to remember how we did this" (use self-reflect instead)

**What Claude Should NOT Do**:
- Create report spam (edit one doc)
- Go down rabbit holes without checking ground truth
- Make up solutions (verify with self-reflect first)
- Skip ultra think on complex problems

### Communication Protocol

**User → Codex**:
```
"Claude Terminal 1 came back with this result: [paste]
What should we do next?"
```

**Codex Response**:
```markdown
# ✅ Good Progress on Terminal 1

## Status
Terminal 1 completed backfill setup successfully

## Next Action
Have Terminal 1 start the backfill, spawn Terminal 2 for monitoring

## For Terminal 1
```
Start the backfill with 8 workers:
npx tsx scripts/backfill-parallel.ts --workers 8

This will take ~2 hours. You can walk away - I'll notify you when done.
```

## For Terminal 2 (New)
```
Monitor backfill progress:
npx tsx scripts/monitor-backfill.ts

Report every 15 minutes with: completed rows, errors, ETA
```
```

**Claude → User → Codex**:
```
[Claude completes task and reports]

User copies to Codex:
"Terminal 1 report: Backfill completed. 388M rows, 0 errors, 2.3 hours."

Codex: "Great! Next: verify data quality. [instructions]"
```

### Multi-Terminal Management

**2-Terminal Pattern** (Standard):
```
Terminal 1: Main implementation
Terminal 2: Testing/verification OR parallel research
```

**3-Terminal Pattern** (Heavy Load):
```
Terminal 1: Main implementation
Terminal 2: Database/schema work
Terminal 3: Research/exploration
```

**Codex Tracking**:
```markdown
# Active Terminals

## Terminal 1 (Main)
Status: Implementing PnL calculation fix
ETA: 45 minutes
Blocking: No

## Terminal 2 (Database)
Status: Running schema migration
ETA: 10 minutes
Blocking: Yes (Terminal 1 needs results)

## Terminal 3 (Research)
Status: Exploring backfill recovery options
ETA: 30 minutes
Blocking: No
```

**When to Stop & Consolidate**:
- Multiple terminals idle
- Context getting fragmented
- User overwhelmed
- Natural stopping point reached

---

## Part 4: Execution Workflows

### Workflow 1: Quick Answer (Codex Only)

**Scenario**: User needs fast direction

```
User → Codex: "Where's the wallet tracking query?"

Codex:
# Location: lib/clickhouse/queries/wallet-analytics.ts

## File
`lib/clickhouse/queries/wallet-analytics.ts`

## Function
`getWalletPositions(walletAddress: string)`

## Usage
Import and call with wallet address. Returns current positions.
```

**Duration**: < 30 seconds
**No Claude needed**: Codex answered directly

### Workflow 2: Implementation Task (Codex → Claude)

**Scenario**: User needs feature implemented

```
User → Codex: "Add market volume metric to dashboard"

Codex:
# Implementation Plan: Market Volume Metric

## Steps
1. Add query to ClickHouse client (5 min)
2. Create API endpoint (10 min)
3. Add UI component (15 min)
4. Test & verify (10 min)

## For Claude (Main Terminal)
```
Implement market volume metric:

1. Add to `lib/clickhouse/client.ts`:
   - Function: getMarketVolume(marketId: string)
   - Query: Sum USDC transfers for market

2. Create endpoint: `src/app/api/markets/[id]/volume/route.ts`

3. Add component: `src/components/dashboard/market-volume.tsx`

4. Test with market ID: [example]

Report back when complete.
```

Claude: [Implements, tests, reports]

User → Codex: "Claude completed it, tested successfully"

Codex: "Perfect! Ready for commit. Suggest message: 'feat: Add market volume metric to dashboard'"
```

**Duration**: 40 minutes
**Claude Terminal**: 1 (Main)

### Workflow 3: Complex Feature (Codex → Multiple Claude Terminals)

**Scenario**: User needs multi-phase feature

```
User → Codex: "Implement payout vector backfill with monitoring"

Codex:
# Complex Task: Payout Vector Backfill

## Approach
Run backfill + monitoring in parallel (2 terminals)

## For Terminal 1 (Backfill)
```
Use Explore agent to find existing backfill patterns.
Then implement payout vector backfill:

- Use 8 workers (parallel)
- Checkpoint every 10k rows
- Target: ~2 hours runtime

Search self-reflect: "backfill parallel workers checkpoint"
to see how we've done this before.

Start work, report when running.
```

## For Terminal 2 (Monitoring)
```
Build monitoring dashboard:

1. Read checkpoint files
2. Calculate: completion %, ETA, errors
3. Output every 5 minutes
4. Alert if errors > 1%

Start parallel to Terminal 1.
```

Claude T1: [Implements backfill, starts running]
Claude T2: [Implements monitor, starts running]

User → Codex: "Both running. T1 says 2.5hr ETA, T2 monitoring every 5min"

Codex: "Great! You can walk away. I'll track progress. Come back in 2.5 hours."
```

**Duration**: 2.5 hours (can walk away)
**Claude Terminals**: 2 (Parallel)

### Workflow 4: Investigation + Fix (Codex → Claude + Agents)

**Scenario**: Unknown problem needs research

```
User → Codex: "PnL calculations off by 10%, don't know why"

Codex:
# Investigation Plan: PnL Mismatch

## Approach
1. Use claude-self-reflect to check past PnL fixes
2. Use Explore agent to find calculation logic
3. Use database-architect to verify data
4. Implement fix

## For Claude (Main Terminal)
```
Investigate PnL mismatch (10% off):

Step 1: Search past context
Use claude-self-reflect search: "PnL calculation fix mismatch"
Report what we found before.

Step 2: Explore current implementation
Use Explore agent: "Find all PnL calculation code"
Map out where calculations happen.

Step 3: Use Ultra Think
This is complex - use @ultrathink to analyze:
- Formula correctness
- Data pipeline issues
- Potential rounding errors

Step 4: Verify with database-architect
Have database-architect check:
- Query correctness
- JOIN issues
- Data quality

Report findings before implementing fix.
```

Claude:
1. [Searches self-reflect: Found similar issue from 3 weeks ago]
2. [Explore agent: Maps 5 files with PnL logic]
3. [Ultra think analysis: Identifies arrayElement indexing bug]
4. [database-architect: Confirms JOIN is correct]

Claude reports: "Found it! Array indexing off by 1 (0-indexed vs 1-indexed)"

User → Codex: [pastes Claude's findings]

Codex: "Classic ClickHouse array bug! Fix arrayElement calls. Claude has context to implement."

User → Claude: "Implement the fix Codex approved"

Claude: [Implements fix, tests, verifies]
```

**Duration**: 1-2 hours
**Claude Terminals**: 1 (Main)
**Agents Used**: claude-self-reflect, Explore, database-architect
**Ultra Think**: Yes (complex diagnosis)

---

## Part 5: Guardrails & Quality Gates

### Speed Optimization Rules

**Always Push Limits**:
```typescript
// ❌ SLOW - One at a time
for (const item of items) {
  await processItem(item);
}

// ✅ FAST - Parallel with rate limiting
const workers = 8;
const chunks = chunkArray(items, workers);
await Promise.all(
  chunks.map(chunk => processChunk(chunk))
);
```

**Tell User When They Can Leave**:
```markdown
# Backfill Started

This will take 2.5 hours. You can walk away safely.

I'll notify you when:
- ✅ Completed successfully
- ⚠️ Error rate exceeds 1%
- ❌ Critical failure

No action needed from you until then.
```

**Scope Well, Stay Focused**:
```markdown
# ✅ GOOD Scope
Goal: Add market volume metric
Steps:
1. Query (5 min)
2. API (10 min)
3. UI (15 min)
4. Test (10 min)
Total: 40 minutes

# ❌ BAD Scope
Goal: Improve dashboard
Steps: "Add metrics, refactor components, optimize queries, update design..."
Total: ??? (scope creep, rabbit hole risk)
```

### Quality Gates

**Ultra Think Triggers** (Use @ultrathink):
- Schema design (affects multiple tables)
- Performance optimization (unknown bottleneck)
- Complex algorithm (PnL calculation, wallet ranking)
- Data consistency (JOIN correctness, data quality)
- Architecture decision (affects multiple subsystems)

**Ground Truth Checks** (Before implementing):
- Search claude-self-reflect: "How did we solve [X]?"
- Use Explore agent: "Find existing patterns for [Y]"
- Ask Codex: "Is this approach sound?"
- Verify with user: "Does this match your mental model?"

**Going in Circles Detector**:
```
Signs:
- Same error 3+ times
- Trying multiple approaches without progress
- Context feels unclear
- User/Codex expressing confusion

Action:
1. STOP current approach
2. Use claude-self-reflect for past solutions
3. Use Ultra Think for analysis
4. Report to Codex: "Stuck on [X], tried [Y], need guidance"
```

### Documentation Quality

**NO Report Spam**:
```markdown
# ❌ BAD: Creating 5 reports
- PNL_INVESTIGATION_START.md
- PNL_FINDINGS_INITIAL.md
- PNL_ANALYSIS_DEEPER.md
- PNL_FIX_ATTEMPT.md
- PNL_FINAL_RESOLUTION.md

# ✅ GOOD: Editing one document
- docs/investigations/2025-11-pnl-fix.md
  (Updated as investigation progresses)
```

**Status Updates** (Edit in place):
```markdown
# docs/investigations/2025-11-pnl-fix.md

## Status: IN PROGRESS

## Timeline
- Started: 2025-11-10 10:00
- Last updated: 2025-11-10 14:30
- ETA: 2025-11-10 16:00

## Progress
- ✅ Searched past solutions (found similar issue)
- ✅ Explored codebase (mapped 5 files)
- 🔄 Ultra think analysis (in progress)
- ⏳ Implementation (pending)

## Findings
[Updated as we learn more]
```

**Commit Hygiene**:
```markdown
# Agent Should Suggest
When to commit:
- Feature complete & tested
- Natural stopping point
- Before starting new work
- End of session

Branch strategy:
- feat/* for new features
- fix/* for bug fixes
- chore/* for cleanup/docs

Example:
"Ready to commit. Suggest creating branch: feat/market-volume-metric"
```

---

## Part 6: Configuration & Setup

### Settings to Configure

#### Codex (OpenAI ChatGPT)
- [ ] **Enter-to-send**: Enable (user wants this)
- [ ] **Notifications**: Enable completion alerts
- [ ] **Web search**: Enable via settings
- [ ] **Response format**: Configure for glanceable answers (bold headers)

**Config Location** (from user):
https://developers.openai.com/codex/local-config/

#### Claude (Anthropic Claude Code)
- [ ] **Notifications**: Enable completion alerts
- [ ] **MCP Playwright**: Install and configure
- [ ] **claude-self-reflect**: Verify working, document how to fix if broken
- [ ] **Ultra think**: Verify extended thinking works

#### MCPs to Install & Configure
```bash
# Priority MCPs
1. claude-self-reflect (vector search) - VERIFY WORKING
2. Playwright (visual testing, UI)
3. Research: Best dev workflow MCPs
4. Future: Gemini 3.0 CLI compatibility
```

#### .claude/ Structure
```
.claude/
├── context/
│   ├── memory/          # Agent memory (auto-managed)
│   ├── projects/        # Project-specific data
│   │   └── cascadian/   # This project's context
│   │       ├── database-schema.md
│   │       ├── api-endpoints.md
│   │       └── architecture.md
│   └── tools/           # MCP tool docs
│       ├── playwright.md
│       └── self-reflect.md
├── agents/              # Custom agent definitions
│   └── (existing agents)
└── commands/            # Slash commands
    └── (existing commands)
```

### Skills to Research

**From Video** (https://www.youtube.com/watch?v=421T2iWTQio):
- Use skill.md as manual for all skills
- Agent reads skill.md to know what's available
- When to create custom skill vs use built-in

**For Cascadian**:
- Backfill automation skill
- ClickHouse query builder skill
- Agent coordination skill
- Documentation cleanup skill

---

## Part 7: Missing Information (Need from User)

### Templates to Provide

1. **Mindset.md Template** (from iOS dev)
   - Location: Upload to tmp/ for adaptation
   - Usage: Adapt philosophy, remove iOS-specific

2. **Article.md Template** (from iOS dev)
   - Location: Upload to tmp/ for adaptation
   - Usage: Adapt examples, add Cascadian patterns

3. **Rules Template** (if you have one beyond what we're designing)
   - If you have a preferred structure, share it
   - Otherwise, we'll create from scratch

### Configuration Details

1. **Codex Settings**
   - Link to config docs (provided ✅)
   - Confirm how to enable Enter-to-send
   - Confirm notification setup

2. **Claude Settings**
   - How to enable notifications (need instructions)
   - MCP installation process (need docs link)
   - Self-reflect troubleshooting (document common issues)

3. **Agent OS Details**
   - Where to find Agent OS implementation docs
   - Which parts to keep vs redesign
   - How it currently breaks (so we can fix)

### Project-Specific Info

1. **Design System**
   - Colors, typography, component library
   - Where documented currently
   - Where it should live in new structure

2. **Other Projects**
   - Cascadian website repo structure
   - Healthy Doc repo structure
   - Common patterns across all three

3. **Current Breakages**
   - What's currently broken with self-reflect
   - What's currently broken with Agent OS
   - Any other workflow pain points

---

## Part 8: Implementation Roadmap

### Phase 1: Foundation (Week 1)

**Day 1-2: Document Creation**
- Create RULES.md (from this plan)
- Update CLAUDE.md (blend with RULES)
- Adapt Mindset.md (once template provided)
- Adapt Article.md (once template provided)

**Day 3-4: Configuration**
- Configure Codex settings (Enter-to-send, notifications, web search)
- Configure Claude settings (notifications, MCPs)
- Install & test claude-self-reflect
- Install & test Playwright MCP

**Day 5-6: Repository Cleanup**
- Execute doc organization plan (from tmp/doc-organization-plan.md)
- Move 564 root files to proper locations
- Archive Agent OS folders
- Consolidate duplicate topics

**Day 7: Testing & Refinement**
- Test Codex ↔ Claude workflow
- Test multi-terminal management
- Test agent deployment
- Refine based on friction points

### Phase 2: Optimization (Week 2)

**Day 8-9: Skills System**
- Research best MCPs for workflow
- Create custom skills (if needed)
- Document skill.md manual
- Test skill-based workflows

**Day 10-11: Agent OS Reinvention**
- Analyze current Agent OS implementation
- Design new system with workflow rules
- Implement new structure
- Migrate existing content

**Day 12-13: Cross-Project Setup**
- Apply RULES.md to Cascadian website repo
- Apply RULES.md to Healthy Doc repo
- Document project-specific overrides
- Test context switching between projects

**Day 14: Polish & Documentation**
- Create video walkthrough of workflow
- Document common patterns
- Create troubleshooting guide
- Final testing

### Phase 3: Continuous Improvement (Ongoing)

**Weekly**:
- Review git diffs for RULES.md compliance
- Update docs/ structure if needed
- Refine agent delegation patterns

**Monthly**:
- Evaluate new MCPs
- Optimize skill usage
- Review cross-project patterns

**Quarterly**:
- Major workflow review
- Update for new model capabilities (Gemini, etc.)
- Consolidate learnings

---

## Part 9: Success Metrics

### Workflow Efficiency

**Before**:
- 866 markdown files (chaos)
- Unclear when to use Codex vs Claude
- Context loss between terminals
- Report spam from agents
- Rabbit holes without ground truth
- 5 competing organizational systems

**After (Target)**:
- ~180 markdown files (organized in docs/)
- Clear Codex/Claude roles (< 10 sec decision)
- Context preserved (plain English summaries)
- One status doc per investigation
- Ground truth checks standard practice
- Single organizational system (docs/)

**Metrics**:
- Time to find documentation: 10x faster (< 30 sec)
- Agent spawns: Purposeful (vs. exploratory fishing)
- Rabbit holes: Caught early (via self-reflect checks)
- Duplicate docs created: Near zero
- Context switching clarity: High (Codex summaries)

### Quality Indicators

**Code Quality**:
- Ultra think used for complex decisions: 100%
- Ground truth checks before implementation: 100%
- Test coverage maintained: > 80%

**Documentation Quality**:
- Files in proper location: 100%
- Duplicate elimination: 95%+
- Archive used appropriately: 100%

**Speed & Efficiency**:
- Parallel execution used when possible: 80%+
- User can walk away safely: Clear indication always
- API limits pushed appropriately: No rate limit errors

---

## Part 10: Example Scenarios (End-to-End)

### Scenario A: "Add Smart Money Score to Wallet Cards"

**User → Codex**: "Add smart money score to wallet cards"

**Codex Analysis**:
```markdown
# Task: Smart Money Score on Wallet Cards

## Complexity: Medium (2-3 hours)
## Terminals Needed: 1 (Claude Main)

## Plan
1. Query exists in lib/clickhouse/
2. API endpoint needed
3. UI component update needed
4. Design integration required

## For Claude (Main Terminal)
```
Add smart money score to wallet cards:

1. Check existing implementation:
   - Use Explore agent: "Find smart money score calculation"
   - Read: lib/clickhouse/queries/wallet-analytics.ts

2. Create API endpoint:
   - File: src/app/api/wallets/[id]/smart-money-score/route.ts
   - Use existing query

3. Update UI component:
   - File: src/components/dashboard/wallet-card.tsx
   - Add score badge (check design system for colors)
   - Reference: docs/features/smart-money-signals/

4. Test with example wallets:
   - Wallet 1: [example address]
   - Wallet 2: [example address]

Report back when each step complete.
```
```

**Claude Execution**:
```
1. [Explore agent finds calculation]
   ✅ Found in lib/clickhouse/queries/wallet-analytics.ts:234

2. [Creates API endpoint]
   ✅ Created route.ts, tested with Postman

3. [Updates UI component]
   ✅ Added score badge with color coding

4. [Tests with examples]
   ✅ Wallet 1: Score 87 (displays correctly)
   ✅ Wallet 2: Score 45 (displays correctly)

DONE. Screenshots attached. Ready for commit.
```

**User → Codex**: [pastes Claude's completion report]

**Codex**:
```markdown
# ✅ Complete: Smart Money Score Feature

## Status
All steps completed successfully, tested, ready for commit.

## Commit Suggestion
Branch: feat/wallet-smart-money-score
Message: "feat: Add smart money score display to wallet cards"

## Next Steps
1. Review screenshots (if needed)
2. Create branch & commit
3. Test in staging (if applicable)
```

**Outcome**: 2.5 hours, 1 terminal, clean execution ✅

### Scenario B: "Database is slow, optimize it"

**User → Codex**: "Dashboard loading slow, I think it's database queries"

**Codex Analysis**:
```markdown
# Investigation: Dashboard Performance

## Approach
1. Diagnose (which queries slow?)
2. Use database-architect for optimization
3. Implement fixes
4. Verify improvement

## For Claude (Main Terminal)
```
Investigate dashboard performance issue:

Step 1: Search past optimizations
Use claude-self-reflect: "database performance optimization slow queries"
See if we've hit this before.

Step 2: Profile current queries
Add logging to time each query:
- Market data fetch
- Wallet positions
- Smart money rankings
Find the slowest one(s).

Step 3: Use database-architect
Once you find slow query, use database-architect agent:
"Optimize this query: [paste slow query]
Context: ClickHouse, 388M rows, needs to return in < 500ms"

Step 4: Implement optimization
Apply database-architect suggestions.

Step 5: Verify
Measure before/after timing.

Report findings at each step before proceeding.
```
```

**Claude Execution**:
```
Step 1: Self-reflect search
✅ Found 2 past optimizations (similar pattern)

Step 2: Profiling
Added timing logs:
- Market data: 120ms ✅
- Wallet positions: 3,400ms ❌ SLOW
- Smart money: 180ms ✅

Issue: Wallet positions query

Step 3: database-architect analysis
Agent found:
- Missing index on wallet_address
- JOIN causing full table scan
- Can optimize with materialized view

Step 4: Implementation
Options from architect:
a) Add index (quick, 60% improvement)
b) Materialized view (complex, 95% improvement)

Suggest: Try (a) first, see if enough.
```

**User → Codex**: [pastes Claude's findings]

**Codex**:
```markdown
# 🎯 Root Cause: Missing Index

## Findings
Wallet positions query: 3.4 seconds (needs < 500ms)
database-architect found missing index

## Decision
Try index first (quick win):
- Implementation: 10 minutes
- Expected: 60% improvement (3.4s → 1.3s)
- If not enough: Materialized view next

## For Claude
```
Implement the index solution:

1. Create migration:
   - File: migrations/XXX-add-wallet-address-index.sql
   - Index: wallet_address on trades table

2. Apply migration to dev database

3. Measure improvement:
   - Re-run profiling
   - Report new timing

If still > 500ms, we'll do materialized view next.
```
```

**Claude**: [Implements, tests]
```
✅ Index added
✅ Migration applied
📊 Results:
   - Before: 3,400ms
   - After: 520ms (85% improvement)

Still slightly over 500ms target.
Options:
1. Good enough? (520ms vs 3,400ms huge win)
2. Continue to materialized view? (more complex)
```

**User → Codex**: [pastes results]

**Codex**:
```markdown
# ✅ Success (Close Enough)

## Results
3,400ms → 520ms (85% improvement)

## Decision
**Ship it.** 520ms is acceptable:
- Massive improvement (85%)
- User-imperceptible difference (500ms vs 520ms)
- Materialized view = complexity cost > benefit

## Action
Commit this, monitor in production.
If 520ms becomes issue later, revisit materialized view.

## Commit Suggestion
Branch: perf/wallet-positions-index
Message: "perf: Add wallet_address index, reduces query time 85%"
```

**Outcome**: 1.5 hours, 1 terminal, database-architect agent, pragmatic decision ✅

---

## Part 11: Next Steps (In Order)

### Immediate (Before Implementation)

1. **Review this plan** with Codex & user
   - Any missing requirements?
   - Any objections to approach?
   - Any clarifications needed?

2. **Gather missing inputs**:
   - [ ] Mindset.md template
   - [ ] Article.md template
   - [ ] Codex config instructions
   - [ ] Claude notification setup
   - [ ] MCP installation guides

3. **Approve** migration strategy:
   - [ ] Doc organization plan (from tmp/)
   - [ ] Agent OS consolidation approach
   - [ ] RULES.md structure

### Phase 1 Execution (After Approval)

1. **Create RULES.md** (from this plan)
2. **Update CLAUDE.md** (blend with RULES, avoid duplication)
3. **Configure Codex** (settings from user's link)
4. **Configure Claude** (MCPs, notifications)
5. **Test workflow** (one complete scenario end-to-end)

### Phase 2 Execution (After Phase 1 Works)

1. **Execute repository cleanup** (move 564 files)
2. **Adapt templates** (Mindset.md, Article.md)
3. **Reinvent Agent OS** (with new workflow)
4. **Apply to other projects** (Cascadian website, Healthy Doc)

---

## Conclusion

This plan designs a comprehensive workflow system that:

✅ **Defines clear roles**: Codex (orchestrator) + Claude (implementer)
✅ **Optimizes collaboration**: Context switching, multi-terminal management
✅ **Prevents chaos**: No report spam, organized docs, ground truth checks
✅ **Prioritizes speed**: Parallel execution, walk-away tasks, API limits
✅ **Maintains quality**: Ultra think, agents, verification gates
✅ **Scales across projects**: Reusable RULES.md, project-specific CLAUDE.md

**Status**: ⚠️ PLANNING COMPLETE, AWAITING APPROVAL TO IMPLEMENT

**Next**: User reviews plan → provides missing inputs → approves → we execute Phase 1

---

**Generated**: 2025-11-10
**Document**: tmp/WORKFLOW_SYSTEM_DESIGN_PLAN.md
**Mode**: Repository Orchestrator - Planning Phase
**Ready For**: User review & approval
