# CASCADIAN Project Reference Guide

## Project Overview

CASCADIAN is a sophisticated blockchain-based trading and strategy platform focused on Polymarket data analysis, smart money tracking, and autonomous strategy execution. The system integrates real-time blockchain data, wallet analytics, and visual strategy building into a unified platform.

**Current Status:** 85% complete | Core architecture solid | Final polish phase

---

## Quick Navigation

| Need | Location |
|------|----------|
| Database schema | `lib/clickhouse/` |
| Trading strategies | `src/components/strategy-builder/` |
| Market data pipeline | `scripts/` (backfill scripts) |
| Frontend components | `src/components/` |
| API routes | `src/app/api/` |
| Configuration | `.env.local` (git-ignored) |
| Deployment | `vercel.json`, `.vercelignore` |
| Quick start guides | `POLYMARKET_QUICK_START.md`, `PIPELINE_QUICK_START.md` |
| Final checklist | `CLAUDE_FINAL_CHECKLIST.md` |
| System architecture | `ARCHITECTURE_OVERVIEW.md` |
| Documentation | `*.md` files in root and `/docs/` |

---

## Key Terminology

| Term | Definition |
|------|-----------|
| **CLOB** | Central Limit Order Book (Polymarket's order structure) |
| **ERC1155** | Ethereum token standard (Polymarket conditional tokens use this) |
| **Smart Money** | Wallets showing consistent profitable behavior, tracked via metrics |
| **ReplacingMergeTree** | ClickHouse table engine using idempotent updates (no UPDATE statements) |
| **Backfill** | Historical data import (currently: 1,048 days of data, 2-5 hours runtime) |
| **Safe Watcher** | Automatic indexing service that monitors `~/.claude/projects/` |
| **MCP** | Model Context Protocol (integration layer for Claude tools) |
| **PnL** | Profit & Loss (connected to dashboard in real-time) |

---

## System Architecture

### Core Subsystems

**1. Data Pipeline** (100% complete)
- Input: Polymarket CLOB fills + blockchain ERC1155 transfers
- Processing: 8-worker parallel backfill system
- Output: ClickHouse tables (388M+ USDC transfers indexed)
- Key files: `scripts/`, `lib/clickhouse/`

**2. Wallet Analytics** (100% complete)
- Smart money detection via metrics-based ranking
- Validated against Polymarket profiles
- Real-time updates tied to new trades
- Key files: `lib/polymarket/`, wallet tracking queries

**3. Trading Strategies** (100% complete - 18/18 task groups)
- Visual builder for strategy composition
- Copy trading, consensus, smart money, predefined rules
- Autonomous execution with approval workflow
- Key files: `src/components/strategy-builder/`

**4. Frontend Dashboard** (Phase 1 complete)
- React-based with node editor (React Flow)
- Real-time PnL visualization
- Market screener and wallet tracking
- Key files: `src/components/`, `src/app/page.tsx`

**5. Memory System** (Active)
- claude-self-reflect: Semantic search across 350+ past conversations
- Automatic indexing every 2-60 seconds
- Enables "ask Claude about your work" functionality
- See: `~/.claude-self-reflect/` config

---

## Stable Pack: Frozen Facts & Token-Saving Skills

**One-Line Summary:** Normalize IDs, infer direction from net flows, compute PnL from payout vectors, rebuild atomically, and gate with neutrality thresholds. Arrays are 1-indexed.

### Stable Facts (Do Not Change)

- **ClickHouse arrays are 1-indexed.** Use `arrayElement(x, outcome_index + 1)` (add 1 to index)
- **condition_id is 32-byte hex.** Normalize as: lowercase, strip 0x, expect 64 chars. Store as String (avoid FixedString casts)
- **Atomic rebuilds only.** Pattern: `CREATE TABLE AS SELECT` then `RENAME`. Never `ALTER ... UPDATE` on large ranges
- **Direction from NET flows:**
  - BUY: usdc_net > 0 AND token_net > 0 (spent USDC, received tokens)
  - SELL: usdc_net < 0 AND token_net < 0 (received USDC, spent tokens)
  - Calculation: usdc_net = usdc_out - usdc_in, token_net = tokens_in - tokens_out
- **PnL source of truth:** payout vector + winner index
  - Formula: `pnl_usd = shares * (arrayElement(payout_numerators, winning_index + 1) / payout_denominator) - cost_basis`
- **ID hygiene:** Always join on normalized condition_id and consistent tx_hash casing

### Stable Skills (Use Short Labels in Chat)

| Skill | Label | When to Use | What to Do |
|-------|-------|------------|-----------|
| **ID Normalize** | **IDN** | Any time joining trades, transfers, or resolutions | `condition_id_norm = lower(replaceAll(condition_id, '0x','')); assert length=64; use String type` |
| **Net Direction** | **NDR** | Assigning BUY or SELL | BUY if usdc_net>0 and token_net>0; SELL if usdc_net<0 and token_net<0; else UNKNOWN; confidence HIGH if both legs present |
| **PnL from Vector** | **PNL** | Computing PnL from trade outcomes | `pnl_usd = shares * (arrayElement(payout_numerators, winning_index + 1) / payout_denominator) - cost_basis` |
| **Atomic Rebuild** | **AR** | Any mass correction or schema refactor | `CREATE TABLE AS SELECT`, then `RENAME` swap; never `ALTER UPDATE` large ranges |
| **ClickHouse Array Rule** | **CAR** | Indexing arrays in queries | Use 1-based indexing. Always +1 on outcome_index |
| **Join Discipline** | **JD** | Building canonical views | Join on normalized ids only; forbid slug-to-hex joins; assert rowcount changes |
| **Gate Defaults** | **GATE** | Quality checks and validation | Global cash neutrality error <2%; per-market <2% in 95% of markets, worst <5%; HIGH confidence coverage ≥95% of volume |
| **UltraThink** | **@ultrathink** | Schema design, complex SQL, performance risk | Use @ultrathink with brief goal, constraints, and rowcount expectations |

### File Anchors (Reference by Path, Don't Inline)

**Do not restate SQL blocks.** Reference these files instead:
- `PAYOUT_VECTOR_PNL_UPDATE.md` - Complete PnL update logic
- `scripts/step4-gate-then-swap.ts` - Atomic rebuild and gating
- `scripts/step5-rebuild-pnl.ts` - PnL recalculation
- `scripts/build-trades-canonical-v2.ts` - Canonical trade table
- `scripts/step3-compute-net-flows.ts` - Direction calculation
- `scripts/step2a-build-reliable-token-map.ts` - Token mapping

### Token-Saving Rules

1. **Use skill labels in replies** instead of re-explaining: Say "Apply **IDN** for condition IDs" not "Normalize condition IDs by..."
2. **Cache constants once:** Array indexing rule, alias packs, gate thresholds - mention once per conversation
3. **Reference files, not inline:** Link to `scripts/step3-compute-net-flows.ts` rather than paste SQL
4. **Prefer counts only:** When asked for data, provide rowcounts, not full dumps
5. **Short labels in code:** Use IDN, NDR, PNL, AR, JD, GATE, CAR, @ultrathink in comments and discussions

### Outcome Resolver Order (Stable)

1. Exact case-insensitive match within outcomes[]
2. Alias match filtered by event context (sport, election, yes/no)
3. Token set match after stopword removal
4. High threshold fuzzy match
5. If no winner found: refresh API and retry once
6. Else: route to manual queue (store resolver_method and full audit row)

### Minimal Alias Packs (Safe & Stable)

```
yes_no:     [["yes","y","long","buy"],  ["no","n","short","sell"]]
over_under: [["over",">","o"],          ["under","<","u"]]
up_down:    [["up","rise","increase"],  ["down","fall","decrease"]]
home_away:  [["home","h"],              ["away","a"]]
fav_dog:    [["favorite","fav","-"],    ["underdog","dog","+"]]
```

### Do Not Freeze Yet

- Team and city nickname dictionaries at scale
- Market category taxonomy details
- Any slug-to-hex mapping (only normalized hex is canonical)

---

## Time Estimates by Task Type

### Quick Tasks (< 15 min, use skill labels)
- Adding a metric to existing dashboard: 5-10 min
- Fixing a query bug with known cause: 10-15 min
- Documentation update: 5-10 min

### Standard Tasks (15 min - 2 hours)
- New endpoint implementation: 30-45 min (50% time on testing)
- Small schema change (add column): 45 min - 1 hour
- Refactor isolated function: 1-2 hours
- Bug investigation with unknown cause: Add 50% buffer

### Complex Features (2-8 hours, use @ultrathink + agents)
- New market data integration: 4-6 hours (2h design + 2h implementation + 2h testing)
- Large schema refactor: 6-8 hours (1h design + 3h implementation + 2h validation)
- Performance optimization: 4-8 hours (2h analysis + 2-4h optimization + 2h verification)

### Major Refactors (8+ hours, break into phases)
- Complete pipeline redesign: 8-16 hours (break into: design, infrastructure, implementation, testing, validation)

---

## Development Quick Reference

### Adding a New Market Analysis Feature
1. Check `lib/clickhouse/client.ts` for available queries
2. Create new component in `src/components/`
3. Add API route in `src/app/api/` if data fetching needed
4. Connect to dashboard navigation in `src/components/dashboard/sidebar.tsx`

### Debugging Data Issues
- ClickHouse queries: `lib/clickhouse/queries/`
- Check imports: `scripts/` (ingest-clob-fills, build-positions, etc.)
- Verify data: `docker compose exec clickhouse clickhouse-client`

### Working with Blockchain Data
- USDC transfers: Filtered via ERC20 `Transfer` events
- Conditional tokens: ERC1155 `TransferBatch` events
- Market mapping: `lib/polymarket/` handles token↔market resolution

### Understanding the Strategy System
- Strategy JSON structure: Visual nodes → execution plan
- Approval workflow: Manual approval before autonomous execution
- Supported rule types: Copy, consensus, smart money metrics, predefined conditions

---

## Critical Files & Directories

```
/src
  /app
    /api              # API endpoints for data fetching
    page.tsx          # Main dashboard entry
  /components
    /dashboard        # Layout and navigation
    /strategy-builder # Visual strategy composer
    /market-*         # Market analysis components

/lib
  /clickhouse       # Database client & operations
  /polymarket       # Polymarket-specific logic

/scripts
  *-backfill*.ts    # Data import scripts (8-worker parallel system)
  *-*.ts            # Utility scripts for data processing

/.claude
  /agents           # Custom Claude Code agents
  /commands         # Custom slash commands

/docs (Documentation - Keep Organized)
  - Architecture decisions
  - Setup guides
  - API documentation
  - Data pipeline docs
```

---

## Repository Organization Guidelines

### Keep Clean by Following This Pattern

**When adding documentation:**
1. Check if similar MD file exists in `/docs` or root
2. If it's project-wide, put in root or `/docs`
3. If it's subsystem-specific, keep near code (e.g., `/lib/clickhouse/README.md`)
4. Archive completed/reference docs to `/docs/archive/`
5. Consolidate related docs (don't duplicate info)

**When adding scripts:**
1. Keep all data processing scripts in `/scripts/`
2. Naming: `{action}-{target}-{phase}.ts` (e.g., `build-positions-from-erc1155.ts`)
3. Add brief docstring with purpose and estimated runtime
4. Link from CLAUDE.md if it's commonly used

**Cleanup cadence:**
- Weekly: Review root directory for orphaned files
- After major features: Archive old design docs
- Before commits: Verify all `.md` files are current

---

## Common Issues & Solutions

| Issue | Check | Solution |
|-------|-------|----------|
| Data not importing | `scripts/` logs | Verify blockchain RPC endpoint, check for CLOB pagination limits |
| Dashboard slow | ClickHouse query | Add indexes, check data volume in affected table |
| Strategy won't execute | `src/app/api/` route | Verify token formats, check approval workflow |
| Memory search not working | MCP connection | Run `claude mcp list`, check embedding model status |

---

## Memory & Knowledge Systems

### Three-Tier Memory Architecture

Your project uses a coordinated three-tier memory system for different use cases:

**Tier 1: Instant Reference (CLAUDE.md - This File)**
- Quick lookup: terminology, architecture, file locations, working patterns
- Update: When patterns change or new best practices emerge
- Best for: "Where do I find X?" and "How do we usually do Y?"

**Tier 2: Semantic Search (claude-self-reflect Vector Database)**
- Full conversation history indexed with AI-powered narratives
- Search by concept: "How did we solve X?", "What approach did we use for Y?"
- Enabled: Real-time with safe-watcher (automatic indexing every 2-60 seconds)
- Best for: "Have we encountered this before?" and "What was our reasoning?"
- Performance: Sub-3ms semantic search response times
- Services: Qdrant (vector DB at localhost:6333), FastEmbed (384-dim embeddings), safe-watcher (monitoring)

**Tier 3: Specialized Documentation (Markdown Files)**
- Domain-specific deep dives: POLYMARKET_TECHNICAL_ANALYSIS.md, PROJECT_NARRATIVES_ANALYSIS.md, etc.
- Location: Root directory and `/docs/`
- Best for: Detailed understanding of specific subsystems

### When to Use Each Memory Tier

| Question | Use | Example |
|----------|-----|---------|
| "What does CLOB mean?" | CLAUDE.md | Instant terminology lookup |
| "How did we fix zero-ID trades?" | claude-self-reflect | Semantic search for past solutions |
| "Tell me about ERC1155 decoding" | POLYMARKET_TECHNICAL_ANALYSIS.md | Subsystem deep dive |
| "How do we add new features?" | CLAUDE.md | Development pattern reference |

### Vector Search Best Practices

Write searches by **problem/concept**, not keywords:
- ✅ "How did we handle wallet metrics calculation?"
- ✅ "What approaches have we used for market data loading?"
- ✅ "Find discussions about strategy execution validation"
- ❌ "wallet metrics" (too generic)

The system automatically extracts and indexes:
- Problem-solution narratives
- Tools used in conversations
- Concepts discussed
- Files modified
- Time metadata (recent conversations rank higher, 90-day decay)

### Memory Best Practices for This Project

1. **Hard tasks trigger "ultra think"** - Request extended thinking for architecture decisions and complex debugging
2. **Delegate to agents for context savings** - Use Explore, Plan, database-architect agents for large tasks (saves 20-30% context)
3. **Use vector search FIRST** - Before using Explore agent, search claude-self-reflect (5 sec vs 5-10 min, 90% less tokens)
4. **Document decisions in MD files** - Keep architectural decisions in project MD files for future reference
5. **Link memory systems** - Reference CLAUDE.md (quick lookup) + claude-self-reflect (deep dive) + specialized docs (domain knowledge)

### Integration with Agent Delegation

**Before (Exploratory Agent)**: "Use Explore agent to find similar wallet tracking approaches" → 5-10 minutes, ~2000 tokens

**After (Vector Search)**: "Search claude-self-reflect for wallet tracking approaches" → 3-5 seconds, ~100 tokens

This replaces expensive agent calls for context retrieval while preserving agents for complex analysis tasks.

---

## Key Metrics

- **Data coverage:** 388M+ USDC transfers, 1,048 days
- **Smart money wallets tracked:** 50+ validated profiles
- **Strategy options:** 5+ rule types, visual composition
- **Query performance:** Sub-3ms semantic search on past work
- **Pipeline runtime:** 2-5 hours for full backfill

---

## External References

- **Polymarket docs:** https://docs.polymarket.com/
- **ClickHouse docs:** https://clickhouse.com/docs/
- **Claude Code:** https://claude.com/claude-code
- **claude-self-reflect:** https://github.com/ramakay/claude-self-reflect

---

## Working Style & Patterns for This Project

### Time Estimates (Always Include These)
- **Quick tasks:** < 15 min
- **Standard tasks:** 15 min - 2 hours
- **Complex features:** 2-8 hours
- **Major refactors:** 8+ hours (break into phases)
- **Debug unknown issues:** Add 50% buffer to initial estimate

### When to Use Extended Thinking ("Ultra Think")
- Architecture decisions affecting multiple subsystems
- Debugging performance issues with unknown root cause
- Complex algorithm design (e.g., wallet ranking, strategy execution)
- Data consistency problems across multiple sources
- Request explicitly: "This needs ultra think - analyze the problem space"

### Test-Driven Development (Required Approach)

We follow **Test-First, Small-Chunk methodology**:

**Small Chunk Pattern:**
- Break features into 3-4 phases: Database → API → UI → Testing
- Each phase is verifiable independently
- Mark complete in tasks.md with [x]
- Only write focused tests (2-8 per phase, not exhaustive)

**Test Writing Rules:**
- Write tests FIRST, then implementation
- Keep total tests per feature: 16-34 tests maximum
- Per task group: 2-8 focused tests only
- Skip edge cases and comprehensive scenarios
- Run ONLY the newly written tests after implementation (not full suite)

**Why This Works:**
- Proves feature works before moving to next phase
- Prevents regret/rework (verify early)
- Keeps feedback loop tight
- Reduces over-engineering

### When to Delegate to Agents (Context Savings)

**Planning Agents (for big tasks > 4 hours):**
- **Plan agent:** Breaking down complex tasks into phases
- **orchestrate-tasks command:** Multi-agent parallel implementation with specialization
- **spec-shaper:** Requirements gathering via targeted questions
- **task-list-creator:** Breaking specs into test-first tasks

**Execution Agents:**
- **Explore agent:** Codebase navigation, finding files, understanding patterns
- **database-architect agent:** Schema design, query optimization, data structure decisions
- **implementer agent:** Executes implementation with test-first approach
- **Implementation-verifier agent:** Testing and validation of completed work

**Complete Agent OS Available:**
- spec-initializer, spec-shaper, spec-writer, spec-verifier
- task-list-creator, implementer, implementation-verifier
- product-planner, database-architect

**Pattern:** Use planning agents for features > 4 hours, save context for decision-making

### Best Practices for This Project
1. **Always start with tests** - Write failing tests first, then implement to make them pass
2. **Break into small chunks** - Use planning agents to create database → API → UI → testing phases
3. **Search past conversations first** - Before implementing, ask: "Have we solved similar problems?"
4. **Use vector search** - Query claude-self-reflect for architectural context
5. **Document as you go** - Keep `/docs/` updated with decisions
6. **Test on small dataset** - Before running 1,048-day backfill, verify on 7-day sample
7. **Parallel where possible** - Use 8-worker pattern for backfill tasks
8. **Verify frequently** - Don't wait for the end to test

---

## Skills & Optimization Strategy

### Available Skills (Use These to Delegate)

**Current Skills in CLAUDE Code:**
- **Explore Agent** - Codebase navigation, finding files, patterns (Use when: searching >10 files)
- **Plan Agent** - Breaking tasks into phases (Use when: feature scope > 4 hours)
- **database-architect Agent** - Schema design, query optimization (Use when: database decisions needed)
- **Implementation-verifier Agent** - Testing and validation (Use when: QA phase needed)

### Recommended Skills to Build (Priority Order)

**Priority 1 (High Impact - 1-2 weeks):**
1. **claude-self-reflect-query**
   - Unlocks: Direct vector search from Claude Code
   - Usage: "What approaches have we used for [X]?"
   - Saves: 10-20 min per search vs Explore agent
   - Build time: 1-2 hours

2. **Backfill-Runner**
   - Unlocks: One-command full pipeline execution with progress
   - Usage: "Run full Polymarket backfill with checkpointing"
   - Saves: 15-20 min per run (setup + monitoring)
   - Build time: 2-3 hours

**Priority 2 (Medium Impact - 2-4 weeks):**
3. **ClickHouse-Query-Builder**
   - Unlocks: Quick market/wallet data queries
   - Usage: "Query wallet positions for [wallet]"
   - Saves: 10-15 min per data fetch (syntax + execution)
   - Build time: 2-3 hours

4. **Strategy-Validator**
   - Unlocks: Pre-execution strategy validation
   - Usage: "Validate strategy definition"
   - Saves: 5 min per test (catch errors early)
   - Build time: 1-2 hours

**Priority 3 (Nice to Have - 4+ weeks):**
5. **Memory-Organizer**
   - Unlocks: Auto-organize MD files and cross-references
   - Usage: "Organize documentation"
   - Saves: 30 min per cleanup session
   - Build time: 3-4 hours

### When to Build vs Use Direct Work

**Use a skill when:**
- Task is repetitive (use >2x per week)
- Setup overhead significant (>5 min)
- Error detection important
- Context savings needed

**Do directly when:**
- One-time exploratory work
- Simple single-file changes
- Requires human judgment/review
- Skill doesn't exist yet

### Token & Context Optimizations

**Already in use:**
- ✅ Vector search replaces agent calls (100x faster, 95% less tokens)
- ✅ Agent delegation for large tasks (saves 20-30% context)
- ✅ Task batching (combine related work)
- ✅ Time estimates to prevent scope creep
- ✅ Narrative extraction (improves search quality 9.3x)

**Future improvements:**
- Code caching for large ClickHouse schema files
- Snippet library for common patterns (ERC1155, wallet queries)
- MCP tool for direct ClickHouse queries
- Skill composition (chain skills for complex workflows)

---

## Complete Agent System (30+ Available)

### Agent OS Agents (9 Custom Agents in `.claude/agents/`)

**Specification Phase:**
1. **spec-initializer** - Initializes spec folder structure and saves raw feature ideas
2. **spec-shaper** - Gathers detailed requirements through targeted questions and visual analysis
3. **spec-writer** - Creates detailed technical specification documents
4. **spec-verifier** - QA gate that verifies spec completeness and accuracy

**Implementation Phase:**
5. **task-list-creator** - Breaks specs into actionable tasks with test-first approach (2-8 tests per group)
6. **implementer** - Executes implementation following tasks.md with test-first methodology
7. **implementation-verifier** - Final verification, runs full test suite, marks roadmap complete

**Planning:**
8. **product-planner** - Creates mission/roadmap for new products or major pivots
9. **database-architect** - Designs schemas, optimizes queries, manages migrations (use proactively)

### Standard Claude Code Agents (21+ Built-in)

**Specialist Agents (Domain-Specific):**
- **backend-specialist** - Backend architecture, APIs, databases, server logic
- **frontend-specialist** - UI/UX, React components, styling, client-side logic
- **database-specialist** (or **database-architect**) - Database design, migrations, query optimization
- **architecture-designer** - System architecture, scalability, technology decisions
- **design-system-specialist** - Design tokens, component libraries, UI patterns
- **accessibility-specialist** - WCAG compliance, a11y testing, inclusive design
- **mobile-specialist** - Mobile-first design, responsive layouts, touch interactions
- **ml-specialist** - Machine learning, AI/ML model training, data science

**Process & Quality Agents:**
- **qa-testing-specialist** - Test planning, test case creation, QA strategy
- **code-reviewer** - Code quality, best practices, architecture review
- **security-specialist** - Security review, vulnerability detection, hardening
- **performance-specialist** - Performance optimization, profiling, load testing
- **devops-specialist** - DevOps, infrastructure, CI/CD, deployment
- **devex-specialist** - Developer experience, tooling, documentation
- **integration-specialist** - Third-party integrations, API consumption

**Analysis & Research Agents:**
- **research-specialist** - Research, proof of concepts, technical exploration
- **debugging-specialist** - Bug investigation, root cause analysis
- **refactoring-specialist** - Code refactoring, technical debt reduction
- **documentation-specialist** - Technical writing, docs generation, knowledge transfer
- **cost-optimization-specialist** - Cost analysis, optimization, resource efficiency

**Utility Agents:**
- **general-purpose** - Default agent for general tasks
- **Explore** - Codebase exploration, pattern discovery
- **Plan** - Task planning and breakdown

### How to Use Agents Effectively

**Quick Delegation Pattern:**
```
@backend-specialist implement the API endpoint for X
@code-reviewer please review this PR for quality issues
@architecture-designer design the system for X
@test-specialist create test plan for X
@security-specialist review this for vulnerabilities
```

**When to Delegate:**
- Task is isolated (doesn't need system context)
- Task is repetitive (review, testing, security check)
- Task requires specialized expertise
- You want to preserve your own context budget
- Task can be done in parallel

### 6 Custom Commands (Workflows)

**For New Products/Features:**
- `/plan-product` - Initiates product planning (mission, roadmap, tech stack)
- `/shape-spec` - Requirements gathering (initializer → shaper workflow)
- `/write-spec` - Creates technical specifications

**For Implementation:**
- `/create-tasks` - Breaks spec into test-first task groups
- `/implement-tasks` - Simple sequential implementation (for tasks < 8 hours)
- `/orchestrate-tasks` - Advanced parallel implementation (for features > 8 hours, multi-team)

### Workflow Examples

**Small Feature (< 4 hours):**
```
/shape-spec → /create-tasks → /implement-tasks → Done
```

**Medium Feature (4-8 hours):**
```
/shape-spec → /create-tasks → /implement-tasks → /implement-tasks → Done
```

**Large Feature (> 8 hours):**
```
/shape-spec → /create-tasks → /orchestrate-tasks → Parallel agents execute → Done
```

**New Product/Major Work:**
```
/plan-product → /shape-spec → /create-tasks → /orchestrate-tasks → Done
```

---

## Next Steps / In Progress

### Immediate (This Week)
- [ ] **Final P0 bugs** (2.5 hours) — Use "ultra think" for complex issues
  - Check `POLYMARKET_QUICK_START.md` for test procedures
  - Search claude-self-reflect for similar bugs we've solved

- [ ] **Memory System Optimization** (4-6 hours)
  - Create claude-self-reflect-query skill
  - Add more vector search examples to CLAUDE.md
  - Document query patterns for common problems

### Short Term (Next 2 Weeks)
- [ ] **Skills Implementation** (8-12 hours)
  - Build Backfill-Runner skill (15-20 min savings per run)
  - Build ClickHouse-Query-Builder (10-15 min savings per query)

- [ ] **P1 Polish** (8-10 hours) — Delegate to agents for large refactors
  - Reference existing Polymarket integration pattern
  - Check CLAUDE_FINAL_CHECKLIST.md for validation steps

### Medium Term (Next Month)
- [ ] Build Strategy-Validator skill
- [ ] Build Memory-Organizer skill
- [ ] Performance optimization
- [ ] Additional market integrations

### Documentation References
- For implementation details: See `ARCHITECTURE_OVERVIEW.md`
- For data pipeline: See `POLYMARKET_TECHNICAL_ANALYSIS.md`
- For operations: See `OPERATIONAL_GUIDE.md`
- For past solutions: Query claude-self-reflect vector search
