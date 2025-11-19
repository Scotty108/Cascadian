# Workflow System Design - Executive Summary

**Full Plan**: `tmp/WORKFLOW_SYSTEM_DESIGN_PLAN.md` (27,000 words)

---

## What We Designed

**A complete workflow system** for managing Codex (orchestrator) + Claude (implementer) + specialized agents across multiple projects with clear rules, efficient collaboration, and chaos prevention.

---

## Key Components

### 1. Document System
- **RULES.md**: Workflow authority (both Codex & Claude read on startup)
- **CLAUDE.md**: Project-specific context (keep current excellent content)
- **Mindset.md**: Decision-making framework (adapt from your template)
- **Article.md**: Advanced patterns (adapt from your template)

### 2. Agent Roles

**Codex (Orchestrator)**:
- Fast, glanceable answers (bold headers, clear format)
- Manages 2-3 Claude terminals
- More grounded/"scientist" personality
- Context switching between workstreams
- Suggests when to spawn new terminal

**Claude (Implementer)**:
- Deep implementation work
- More experimental/"explorer" personality
- Deploys agents (Explore, database-architect, self-reflect)
- Executes SQL, deployments, operations
- Multiple terminals for parallel work

### 3. Collaboration Model
```
User ←→ Codex (orchestrates)
         ↓ (provides instructions)
         ↓→ Claude T1 (main work)
         ↓→ Claude T2 (parallel task)
         ↓→ Claude T3 (research)
```

---

## Guardrails

**Speed First**:
- Multiple workers, parallel execution
- Push API limits (no rate limiting)
- Tell user when they can walk away

**Quality Gates**:
- Ultra think for complex problems
- claude-self-reflect for ground truth
- No report spam (edit one doc)
- Catch rabbit holes early
- Establish and verify ground truth early and often with tests

**Organization**:
- All docs in docs/ (not root)
- No new MD files without reason (organized neatly)
- Archive completed work immediately
- Max 3 Claude terminals (2 ideal)

---

## Repository Cleanup

**Current**: 866 files, 5 organizational systems, chaos
**Target**: ~180 files, 1 system (docs/), organized

**Actions**:
1. Move 564 root files to docs/ subdirectories
2. Archive Agent OS folders
3. Consolidate duplicates (83 PNL files → 2-3 canonical)
4. Establish docs/ as single source of truth

---

## What We Need From You

### Templates:
- [ ] Mindset.md template (from iOS dev)
- [ ] Article.md template (from iOS dev)

### Configuration:
- [ ] Codex settings confirmation (Enter-to-send, notifications)
- [ ] Claude notification setup instructions
- [ ] MCP installation guides (Playwright, self-reflect)

### Details:
- [ ] Agent OS current implementation (how it works/breaks)
- [ ] Design system documentation location
- [ ] Other project repo structures (Cascadian website, Healthy Doc)

---

## Implementation Phases

### Phase 1: Foundation (Week 1)
- Create RULES.md
- Update CLAUDE.md
- Configure Codex & Claude
- Execute repository cleanup
- Test workflow

### Phase 2: Optimization (Week 2)
- Skills system
- Reinvent Agent OS
- Apply to other projects
- Polish & document

### Phase 3: Ongoing
- Weekly compliance checks
- Monthly MCP evaluation
- Quarterly workflow review

---

## Success Metrics

**Efficiency**:
- Time to find docs: < 30 seconds (vs. minutes)
- Context switching: Clear (Codex summaries)
- Duplicate docs: Near zero

**Quality**:
- Ultra think usage: 100% (complex decisions)
- Ground truth checks: 100% (before implementation)
- Files in proper location: 100%

**Speed**:
- Parallel execution: 80%+ (when possible)
- Walk-away clarity: Always indicated
- No rate limiting: 100%

---

## Example Scenarios

**Scenario A: Simple Feature** (2.5 hours, 1 terminal)
User → Codex → Claude → Implementation → Done

**Scenario B: Investigation** (1.5 hours, 1 terminal, agents)
User → Codex → Claude + database-architect → Fix → Done

**Scenario C: Complex Multi-Phase** (2.5 hours, 2 terminals)
User → Codex → Claude T1 (backfill) + Claude T2 (monitor) → Done

---

## Next Steps

1. **Review** full plan: `tmp/WORKFLOW_SYSTEM_DESIGN_PLAN.md`
2. **Provide** missing templates/configs
3. **Approve** approach
4. **Execute** Phase 1

---

**Status**: ⚠️ PLANNING COMPLETE
**Ready For**: Your review & approval
**Document**: See `tmp/WORKFLOW_SYSTEM_DESIGN_PLAN.md` for full details
