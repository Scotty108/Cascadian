# /handoff Command Guide

**Purpose**: Generate comprehensive handoff report when closing a Claude terminal

---

## Quick Usage

```
/handoff
```

Claude will generate a complete handoff report capturing everything a fresh agent needs to continue seamlessly.

---

## What It Captures

### 1. **Current Work**
- What you were working on
- Current status (%)
- Original goal
- Time spent/remaining

### 2. **Progress Made**
- Completed work
- Tests passing
- Files created/modified
- Successful queries/commands

### 3. **What Worked** ✅
- Solutions that worked
- Successful patterns
- Skills that saved time
- Reusable code/queries

### 4. **What Didn't Work** ❌ (Critical!)
- Failed approaches (and why)
- Rabbit holes explored
- Time-wasting dead ends
- Common mistakes to avoid

### 5. **Key Findings & Evidence** 🔍
- Important discoveries
- Root causes found
- Data anomalies
- Critical metrics
- Breakthrough insights

### 6. **Current Blockers** 🚧
- What's blocking progress
- What needs user input
- External dependencies
- Unclear requirements

### 7. **References Needed** 📚
- Files to read
- Docs to reference
- Skills to use
- MCPs to invoke
- Queries to run
- Commands to execute

### 8. **Mental Model** 🧠
- How to think about the problem
- Why it's tricky
- The approach and why it works
- Key insights

### 9. **Next Steps** ⏭️
- Immediate actions
- After unblocking
- Testing & verification
- Completion criteria

---

## Report Structure

```markdown
# Handoff Report: {Task Name}

**Terminal**: C1/C2/C3
**Status**: XX% complete

## ✅ What I Completed
[Detailed list with files and results]

## 🔍 Key Findings & Evidence
[Discoveries with data/evidence]

## ✅ What Worked (Use These)
[Successful approaches with patterns]

## ❌ What Didn't Work (Avoid These)
[Failed approaches and rabbit holes]

## 🚧 Current Blockers
[What's blocking and what's needed]

## 🗺️ Where You Are (Context)
[What came before, current phase, constraints]

## 📚 References You Need
[Files, docs, skills, MCPs, queries]

## 🔄 From Other Terminals
[What C1/C2/C3 discovered]

## ⏭️ Next Steps
[Immediate actions and testing]

## 🧠 Mental Model
[How to think about the problem]

## 💬 For Next Agent (TL;DR)
[Quick summary and critical context]
```

---

## Where Reports Are Saved

**Mid-task handoff:**
```
reports/sessions/2025-11-10-session-1-handoff-C1.md
```

**Investigation complete:**
```
reports/investigations/pnl-investigation-handoff.md
```

**Major feature:**
```
reports/final/wallet-metrics-handoff.md
```

---

## What Happens

1. **Generate Report**
   - Claude pauses to gather all information
   - Uses comprehensive template
   - Captures everything from session

2. **Save to Location**
   - Determines appropriate location
   - Saves with descriptive filename
   - Updates session-state.json

3. **Update Coordination**
   - Marks terminal as "handed_off"
   - Links handoff report
   - Updates session report

4. **Summary for User**
   - Shows save location
   - Quick summary of status
   - Instructions for next agent

---

## For Next Agent

**To resume from handoff:**

1. **Read handoff report** (`reports/sessions/...handoff-C1.md`)
2. **Check session-state.json** (other terminals' findings)
3. **Search claude-self-reflect** (similar past work)
4. **Continue from current phase** (report tells you exactly where)

**Time to resume:** ~5 min context loading + task time

---

## Why This Works

### Before /handoff (❌ Frustrating)
```
User: "C1, I need to close you. C2, continue the PnL work."

C2: "What PnL work? What's been done? What didn't work?"

User: [Spends 20 min explaining context]

C2: [Repeats mistakes C1 already made]
C2: [Wastes 30 min on approaches C1 proved don't work]

Total time lost: 50+ minutes
```

### After /handoff (✅ Seamless)
```
User: "/handoff"

C1: [Generates comprehensive handoff report]
C1: "Saved to reports/sessions/...-handoff-C1.md"

User: "C2, read the handoff report and continue."

C2: [Reads report - 5 min]
C2: "Got it. Avoiding the 3 failed approaches. Continuing from Phase 2."
C2: [Continues seamlessly, no repeated mistakes]

Total time lost: 5 minutes
```

**Savings**: 45+ minutes per handoff

---

## Best Practices

### ✅ DO:
- Use `/handoff` before closing any terminal with significant work
- Be thorough about what didn't work (saves time for next agent)
- Include evidence for key findings (not just claims)
- Provide ready-to-use code/queries
- Write mental model section (helps understanding)
- Be honest about blockers

### ❌ DON'T:
- Skip documenting failed approaches (next agent will repeat them)
- Forget to update session-state.json
- Leave out critical context
- Make assumptions about what next agent knows
- Hide mistakes or dead ends

---

## Real Example

```markdown
# Handoff Report: Fix PnL Calculation for Wallet 0x4ce7

**Terminal**: C1
**Status**: 60% complete - Diagnosis phase done, fix in progress

## ✅ What I Completed
1. ✅ Identified root cause: condition_id format mismatch
   - File: `lib/clickhouse/queries/pnl.ts:45`
   - Evidence: Query returns 0 rows due to case sensitivity
   - Fix: Apply IDN pattern (normalize before join)

2. ✅ Verified against 3 test wallets
   - 0x1234: PnL matches Polymarket ✅
   - 0x5678: PnL matches Polymarket ✅
   - 0x4ce7: Still -$500 (should be +$200) ❌

## ❌ What Didn't Work
1. ❌ **Tried:** Direct string join on condition_id
   - **Failed:** Case mismatch (0x vs 0X)
   - **Time wasted:** 15 min
   - **Lesson:** Always normalize IDs (IDN pattern)

2. ❌ **Rabbit hole:** Suspected payout vector indexing
   - **Why misleading:** Some wallets had correct PnL
   - **How realized:** All wallets use same indexing logic
   - **Lesson:** Check ID formats FIRST before algorithm

## 🚧 Current Blockers
- **Blocker:** 0x4ce7 still shows incorrect PnL after IDN fix
- **Need:** User to verify wallet address is correct
- **Since:** 30 min ago

## 📚 References
- IDN pattern: `.claude/skills/database-query/SKILL.md:34-46`
- Similar bug: Search claude-self-reflect "condition_id join failures"

## ⏭️ Next Steps
1. Verify wallet address with user (2 min)
2. If address correct, check payout vector data (10 min)
3. Test fix on all 50 smart money wallets (20 min)
```

---

## Integration with Workflow

**/handoff fits into your workflow:**

```
Session starts → Work begins → Progress made → Need to close terminal

↓

/handoff → Report generated → Terminal closes

↓

New session → Read handoff → Continue seamlessly
```

**Use cases:**
- End of work day (handoff to tomorrow)
- Terminal blocked >30 min (handoff to C2)
- Emergency context switch (handoff to later)
- Investigation complete (handoff for reference)

---

## Quality Standard

A good handoff report should enable next agent to:
- ✅ Understand the problem space completely
- ✅ Know exactly where work left off
- ✅ Avoid all documented pitfalls
- ✅ Continue with zero questions
- ✅ Resume in 5 minutes

**Test:** If next agent has to ask "What happened?" or "Why did you do X?", the handoff report needs improvement.

---

## Command Location

**File:** `.claude/commands/handoff.md`
**Invoke:** Type `/handoff` in Claude terminal
**Output:** Comprehensive handoff report saved to `reports/`

---

**Bottom Line:** `/handoff` turns terminal transitions from 30-60 minute context rebuilds into 5-minute seamless continuations. Use it liberally.
