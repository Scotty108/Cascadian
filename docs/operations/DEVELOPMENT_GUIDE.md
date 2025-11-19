# Development Guide

> **Development patterns, time estimates, and workflows for CASCADIAN**

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

## Working Style & Patterns

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
9. **Database investigation rule** - DESCRIBE + SAMPLE before dismissing any table
10. **Check database docs first** - Read `/docs/systems/database/TABLE_RELATIONSHIPS.md` before any database search

---

## Common Issues & Solutions

| Issue | Check | Solution |
|-------|-------|----------|
| Data not importing | `scripts/` logs | Verify blockchain RPC endpoint, check for CLOB pagination limits |
| Dashboard slow | ClickHouse query | Add indexes, check data volume in affected table |
| Strategy won't execute | `src/app/api/` route | Verify token formats, check approval workflow |
| Memory search not working | MCP connection | Run `claude mcp list`, check embedding model status |

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
