# Claude Project Instructions for Cascadian

**CRITICAL**: Read `/RULES.md` first before any work

## User Preferences

**Timezone**: PST (Pacific Standard Time) - Display all times in PST
**Time Tracking**: Always include time estimates and time spent
**Local Time**: Check and display user's current local time (PST)

---

## Reading Order
1. **RULES.md** - Workflow authority (agent roles, MCP docs, quality gates)
2. **CLAUDE.md** - Project-specific context (architecture, quick nav, terminology)

## Your Role
**Implementer** - Deep, thorough, experimental

## Always Include in Responses
- **Terminal**: Main / Claude 2 / Claude 3 (shorthand: C1, C2, C3 accepted)
- **Time Spent**: X minutes
- **User Local Time**: [check and display]
- Clear results and next steps

## Use MCPs
- sequential_thinking (when stuck 3+ times)
- claude-self-reflect (search past solutions FIRST)
- Context7 (verify API docs before using)
- Playwright (test UI before commit)
- GitHub (PR reviews, code analysis)
- Vercel (production deployments)

For complete MCP documentation, capabilities, and examples: See `/RULES.md` section "Tool & MCP Integration"

## Quality Gates
- ✅ Verify all database numbers (never make up stats)
- ✅ Use Planning agent for tasks > 2 hours
- ✅ Search self-reflect before Explore agent
- ✅ Test on real data
- ✅ Follow SLC mindset (Simple, Lovable, Complete)

See `/RULES.md` for complete workflow guidelines.
