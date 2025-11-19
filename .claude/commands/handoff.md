---
description: Generate comprehensive handoff report when closing terminal. Captures all context, findings, and work for next agent to continue seamlessly.
---

# Handoff Command

Generate a complete handoff report that enables a fresh Claude agent to pick up exactly where you left off with full context.

---

## Your Task

**Generate a comprehensive handoff report** and save it to the appropriate location.

### Step 1: Gather Information

Collect the following from your session:

**Current Work:**
- What task were you working on?
- What is the current status? (%, completed phases, blockers)
- What was the original goal/user request?
- Time spent so far
- Estimated time remaining

**Progress Made:**
- What did you complete? (be specific)
- What tests passed?
- What files were created/modified?
- What queries/commands were run successfully?
- What intermediate discoveries were made?

**Things That Worked:**
- Solutions that worked (code, queries, approaches)
- Patterns that were successful
- Skills that saved time
- Tools/MCPs that were helpful
- Shortcuts discovered

**Things That Didn't Work (Critical for Next Agent):**
- Approaches tried that failed (and why)
- Rabbit holes explored (and why they were dead ends)
- Common mistakes to avoid
- Misleading patterns
- False starts

**Key Findings & Evidence:**
- Important discoveries
- Root causes found
- Data anomalies discovered
- Critical numbers/metrics
- Breakthrough insights

**Current Blockers:**
- What is blocking progress right now?
- What needs user decision/input?
- What external dependencies are waiting?
- What's unclear or ambiguous?

**Files Modified:**
- Created: [list with purpose]
- Updated: [list with changes]
- Deleted: [list with reason]
- Read/Referenced: [key files consulted]

**Database State (if applicable):**
- Tables created/modified
- Queries run
- Data imported/exported
- Schema changes
- Migrations pending

**Skills & Tools Used:**
- Which skills were invoked?
- Which MCPs were used?
- Token/time savings achieved
- What should next agent use?

**Session State:**
- Check `.claude/session-state.json`
- What did other terminals discover?
- Coordination notes relevant to this work
- Shared findings

---

### Step 2: Generate Handoff Report

Create a report using this structure:

```markdown
# Handoff Report: {Task Name}

**Terminal**: {C1/C2/C3}
**Date**: {YYYY-MM-DD HH:MM}
**Session**: {session-id from session-state.json}
**Handoff To**: Next Claude agent

---

## 🎯 Current Task

**Original Request:**
{What user asked for - exact quote or paraphrase}

**Current Status:** {XX}% complete
- [x] Phase 1: {Name}
- [ ] Phase 2: {Name} ← **YOU ARE HERE**
- [ ] Phase 3: {Name}

**Time Spent**: {X hours/minutes}
**Time Remaining**: {Estimated}

---

## ✅ What I Completed

### Completed Work
1. {Specific accomplishment 1}
   - Files: {list}
   - Result: {what works now}

2. {Specific accomplishment 2}
   - Files: {list}
   - Result: {what works now}

### Tests Passing
- {Test 1} ✅
- {Test 2} ✅

### Files Created
- `{file1}` - {Purpose}
- `{file2}` - {Purpose}

### Files Modified
- `{file3}` - {What changed}
- `{file4}` - {What changed}

---

## 🔍 Key Findings & Evidence

### Discovery 1: {Title}
**What:** {Description}
**Why It Matters:** {Implication}
**Evidence:** {Data, query results, file references}
**Action Required:** {What needs to happen}

### Discovery 2: {Title}
**What:** {Description}
**Why It Matters:** {Implication}
**Evidence:** {Data, query results, file references}

---

## ✅ What Worked (Use These Approaches)

### Approach 1: {Name}
**What:** {Description}
**Why it worked:** {Reasoning}
**Pattern:** {Reusable pattern/code}
**When to use:** {Situations where this applies}

### Approach 2: {Name}
**What:** {Description}
**Files:** {Where to find implementation}
**Saved:** {Time/tokens saved}

---

## ❌ What Didn't Work (Avoid These)

### Failed Approach 1: {Name}
**What I tried:** {Description}
**Why it failed:** {Root cause}
**Time wasted:** {X minutes}
**Don't do this:** {Specific anti-pattern}

### Rabbit Hole 1: {Name}
**What:** {Where I went wrong}
**Why misleading:** {What made it seem promising}
**How I realized:** {What revealed it was wrong}
**Lesson:** {What to remember}

### Common Mistake: {Name}
**The mistake:** {Description}
**Why it's tempting:** {Why you might try this}
**Instead do:** {Correct approach}

---

## 🚧 Current Blockers

### Blocker 1: {Title}
**Status:** ⏳ Waiting / 🔴 Critical / 🟡 Medium
**Description:** {What's blocking progress}
**Needs:** {User decision / External dependency / Fix}
**Workaround:** {Temporary solution, if any}
**Since:** {When this blocker started}

### Blocker 2: {Title}
**Status:** {emoji}
**Description:** {What's blocking progress}
**Needs:** {What's required to unblock}

---

## 🗺️ Where You Are (Context)

### What Came Before
1. {Prior work/decision 1}
2. {Prior work/decision 2}
3. {Prior work/decision 3}

### Current Phase: {Phase Name}
**Goal:** {What this phase should achieve}
**Approach:** {Strategy being used}
**Progress:** {How far into this phase}

### Key Constraints
- {Constraint 1} (e.g., Must use IDN pattern)
- {Constraint 2} (e.g., Quality gate: <2% error)
- {Constraint 3} (e.g., Atomic rebuild only)

### Critical Patterns to Follow
- **{Pattern name}**: {Brief description}
- **{Pattern name}**: {Brief description}

---

## 📚 References You Need

### Files to Read
- `{file1}` - {Why important}
- `{file2}` - {What to look for}

### Docs to Reference
- {Doc name} - {Section/page}
- {Doc name} - {What it explains}

### Skills to Use
- **{skill-name}**: {When to invoke}
- **{skill-name}**: {What it provides}

### MCPs to Use
- **{mcp-name}**: {When to use}
- **{mcp-name}**: {What it helps with}

### Queries to Reference
```sql
-- {Description}
{SQL query that was useful}
```

### Commands to Run
```bash
# {Description}
{Bash command that worked}
```

---

## 🔄 From Other Terminals

{Check .claude/session-state.json}

**C1 Status:** {What C1 is working on}
**C1 Findings:** {What C1 discovered that's relevant}

**C2 Status:** {What C2 is working on}
**C2 Findings:** {What C2 discovered that's relevant}

**Coordination Notes:**
- {Note 1}
- {Note 2}

---

## ⏭️ Next Steps (For Next Agent)

### Immediate (Continue This Task)
1. **{Action 1}** - {Description}
   - Files: {list}
   - Est. time: {X min}
   - Note: {Important context}

2. **{Action 2}** - {Description}
   - Depends on: {Blocker or prerequisite}
   - Est. time: {X min}

### After Unblocking
1. {What to do once blocker is resolved}
2. {Next phase to start}

### Testing & Verification
- [ ] {Test 1}
- [ ] {Test 2}
- [ ] {Verify against quality gates}

### Before Considering Complete
- [ ] All tests passing
- [ ] Documentation updated
- [ ] Session report updated
- [ ] User validated

---

## 🧠 Mental Model (How to Think About This)

{Explain the problem space in 2-3 paragraphs so next agent understands the "why" behind decisions}

**The Core Problem:**
{What we're fundamentally solving}

**Why It's Tricky:**
{What makes this challenging}

**The Approach:**
{High-level strategy and why it works}

**Key Insight:**
{The breakthrough understanding that unlocked progress}

---

## 📊 Metrics

**Time Spent:** {X hours/minutes}
**Skills Used:** {list with token/time savings}
**Files Modified:** {count}
**Tests Written:** {count}
**Token Savings:** {estimated}
**Estimated Completion:** {XX}%

---

## 🔗 Related Work

**Previous Sessions:**
- {Link to related session report}

**Related Investigations:**
- {Link to related investigation}

**Similar Past Work:**
{Search claude-self-reflect: "Similar to {this task}"}

---

## 💬 For Next Agent (TL;DR)

**In one sentence:** {Where we are}

**Critical context:** {Most important things to know}

**Don't forget:** {Easy-to-miss details}

**You're ready when:** {How next agent knows they understood}

---

**Generated:** {timestamp}
**By:** Terminal {C1/C2/C3}
**Next Agent:** Read this, check session-state.json, search claude-self-reflect, then continue
```

---

### Step 3: Save the Report

**Determine save location:**

- **If mid-task handoff**: `reports/sessions/{session-id}-handoff-{terminal}.md`
- **If investigation complete**: `reports/investigations/{topic-name}-handoff.md`
- **If major finding**: `reports/final/{feature-name}-handoff.md`

**File naming:**
- `2025-11-10-session-1-handoff-C1.md` (session handoff)
- `pnl-investigation-handoff.md` (investigation)
- `wallet-metrics-implementation-handoff.md` (feature)

---

### Step 4: Update Coordination Files

**Update `.claude/session-state.json`:**
```json
{
  "active_terminals": [
    {
      "terminal_id": 1,
      "status": "handed_off",
      "handoff_report": "reports/sessions/2025-11-10-session-1-handoff-C1.md"
    }
  ]
}
```

**Update session report:**
- Add link to handoff report
- Mark terminal as handed off
- Note timestamp

---

### Step 5: Generate Summary for User

After saving the handoff report, provide user with:

```markdown
## ✅ Handoff Report Generated

**Saved to:** `{path}`
**Terminal:** {C1/C2/C3}
**Status:** {XX}% complete

### Quick Summary
- **Completed:** {Key accomplishments}
- **Current:** {Where you left off}
- **Blocked by:** {Active blockers}
- **Next:** {What next agent should do first}

### For Next Agent
**Command:** Read the handoff report at `{path}`, check session-state.json, then continue from {current phase}.

**Quick start:**
```
1. Read {handoff-file}
2. Search claude-self-reflect: "How did we {context}"
3. Continue with: {next-action}
```

**Time to resume:** ~5 min context loading + task time
```

---

## Example Usage

**User types:** `/handoff`

**Claude generates:**
1. Comprehensive handoff report (using template above)
2. Saves to `reports/sessions/2025-11-10-session-1-handoff-C1.md`
3. Updates session-state.json
4. Provides summary to user

**Next agent:**
1. Reads handoff report
2. Understands context fully
3. Continues at same level of understanding
4. Avoids all documented pitfalls
5. Resumes work seamlessly

---

## Quality Checklist

Before finalizing handoff report, verify:

- [ ] Original user request quoted/summarized
- [ ] Current status % accurate
- [ ] All completed work documented
- [ ] All failures/rabbit holes documented
- [ ] Key findings have evidence
- [ ] Blockers clearly described
- [ ] Next steps are actionable
- [ ] Files are listed with purpose
- [ ] Mental model section helps understanding
- [ ] TL;DR captures essence
- [ ] References are complete
- [ ] Saved to correct location
- [ ] Session-state.json updated
- [ ] User summary provided

---

## Notes for Implementation

**This command should:**
- Pause and gather all necessary information
- Use comprehensive template above
- Think carefully about what next agent needs
- Be honest about what didn't work
- Provide ready-to-use patterns/code
- Make it easy to resume with zero friction

**The goal:** Next agent can pick up EXACTLY where you left off with FULL context, as if they had been there the whole time.

---

**Remember:** A good handoff report turns a 2-hour context rebuild into a 5-minute read. Be thorough, be honest, be helpful.
