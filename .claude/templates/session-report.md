# Session Report: {DATE}

**Session ID:** {YYYY-MM-DD-session-N}
**Started:** {TIME}
**Status:** 🟢 In Progress / ✅ Complete / ⏸️ Paused
**Primary Terminal:** Terminal {N}

---

## Session Overview

**Goal:** {Brief description of what this session is trying to accomplish}

**Context:** {Any relevant background - previous session findings, user requests, blockers}

**Approach:** {High-level strategy - which agents, skills, MCPs being used}

---

## Terminals Active

| Terminal | Task | Status | Skills Used | Time Spent |
|----------|------|--------|-------------|------------|
| Terminal 1 | {Task description} | 🟢 Active | database-query | 45 min |
| Terminal 2 | {Task description} | ✅ Complete | test-first | 30 min |
| Terminal 3 | {Task description} | ⏸️ Blocked | - | 15 min |

**Coordination Notes:**
- Terminal 2 found issue X, Terminal 1 should investigate
- Terminal 3 blocked waiting for user decision on Y

---

## Work Completed

### Phase 1: {Phase Name}
- [x] Task 1 (Terminal 1) - 15 min
- [x] Task 2 (Terminal 2) - 20 min
- [ ] Task 3 (Terminal 1) - In progress

### Phase 2: {Phase Name}
- [ ] Task 4
- [ ] Task 5

**Estimated Completion:** {TIME or "Unknown - awaiting user input"}

---

## Key Findings

### 1. {Finding Title} (Terminal {N})
**Impact:** 🔴 High / 🟡 Medium / 🟢 Low
**Description:** {What was discovered}
**Action Required:** {What needs to happen}
**References:** {Links to files, line numbers, related docs}

### 2. {Finding Title} (Terminal {N})
**Impact:** 🟡 Medium
**Description:** {What was discovered}
**Action Required:** {What needs to happen}
**References:** {Links to files}

---

## Files Modified

**Created:**
- `file1.ts` (Terminal 1) - {Brief description}
- `file2.md` (Terminal 2) - {Brief description}

**Updated:**
- `file3.ts` (Terminal 1) - {What changed}
- `RULES.md` (Terminal 1) - {What changed}

**Deleted:**
- `old-file.ts` (Terminal 2) - {Why removed}

---

## Skills & Tools Performance

| Skill/Tool | Times Invoked | Time Saved | Token Savings | Terminal |
|------------|---------------|------------|---------------|----------|
| database-query | 3 | 24 min | 1,350 tokens | Terminal 1 |
| test-first | 1 | 10 min | 540 tokens | Terminal 2 |
| claude_self_reflect | 2 | 15 min | 800 tokens | Terminal 1 |

**Total Savings This Session:**
- ⏱️ Time: 49 minutes
- 🎯 Tokens: 2,690 tokens (~90% reduction)

---

## Blockers & Issues

### Active Blockers
1. **{Blocker Title}**
   - Terminal: {N}
   - Issue: {Description}
   - Needs: {User decision / External dependency / Fix}
   - Since: {TIME}

### Resolved Issues
1. **{Issue Title}** ✅
   - Was blocking: Terminal {N}
   - Resolution: {How it was fixed}
   - Time to resolve: 20 min

---

## User Interactions

**Questions Asked:**
1. Q: {Question text}
   A: {User's answer}
   Result: {What action was taken}

**Approvals Requested:**
1. Request: {What needed approval}
   Status: ✅ Approved / ⏳ Pending / ❌ Rejected
   Impact: {What happens based on decision}

---

## Next Steps

### Immediate (This Session)
1. [ ] Complete Task X (Terminal 1) - Est. 15 min
2. [ ] Verify Y works (Terminal 2) - Est. 10 min

### Next Session
1. [ ] Implement feature Z
2. [ ] Refactor component A
3. [ ] Add tests for B

### Waiting On
- [ ] User decision on X
- [ ] External API fix for Y

---

## Session Metrics

**Overall Progress:** {XX}% complete on {GOAL}

**Time Breakdown:**
- Planning: 15 min
- Implementation: 60 min
- Testing: 20 min
- Documentation: 10 min
- **Total:** 105 min

**Quality Gates:**
- [ ] All tests passing
- [ ] Code reviewed
- [ ] Documentation updated
- [ ] User validated

---

## References

**Related Sessions:**
- Previous: [2025-11-09-session-2](./2025-11-09-session-2.md)
- Next: [2025-11-11-session-1](./2025-11-11-session-1.md)

**Related Docs:**
- [RULES.md](../../RULES.md)
- [ARCHITECTURE_OVERVIEW.md](../../ARCHITECTURE_OVERVIEW.md)

**External Links:**
- [Polymarket API Docs](https://docs.polymarket.com/)
- [ClickHouse Docs](https://clickhouse.com/docs/)

---

## Notes

{Any additional context, learnings, or observations from this session}

**What Worked Well:**
- Skill invocation saved significant time
- Multi-terminal coordination via session-state.json

**What Could Be Improved:**
- Terminal 2 could have checked session-state.json before starting duplicate work

**Learnings:**
- Pattern X is better than pattern Y for this use case
- Database query Z needs normalization (IDN pattern)

---

**Last Updated:** {TIMESTAMP}
**Updated By:** Terminal {N}
