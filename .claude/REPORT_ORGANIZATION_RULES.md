# Report Organization Rules

**Purpose**: Stop MD file chaos - use ONE report per session, organized structure

---

## 🚨 Core Rules (MUST FOLLOW)

### Rule 1: ONE Report Per Session
- **DO NOT** create multiple MD files in one session
- **DO** update the single session report as you work
- **Location**: `reports/sessions/YYYY-MM-DD-session-N.md`

### Rule 2: Session Report Pattern
```markdown
# Session Report: [Topic] - [Date]

**Started**: [time]
**Last Updated**: [time]
**Status**: In Progress / Complete
**Terminal**: Main / Claude 2 / Claude 3

## Objective
[What we're trying to accomplish]

## Progress
- [x] Task 1 completed
- [ ] Task 2 in progress
- [ ] Task 3 pending

## Key Findings
[Important discoveries as we go]

## Files Modified
- file1.ts
- file2.md

## Next Steps
[What's left to do]
```

### Rule 3: Report Locations

| Report Type | Location | Naming |
|-------------|----------|--------|
| **Session reports** | `reports/sessions/` | `YYYY-MM-DD-session-N.md` |
| **Investigation reports** | `reports/investigations/[topic]/` | `YYYY-MM-DD-[topic]-findings.md` |
| **Final reports** | `reports/final/` | `[topic]-final-report.md` |
| **Status updates** | Update session report | Don't create new file |
| **Quick findings** | Add to session report | Don't create new file |

### Rule 4: When to Create New File vs. Update

**Create NEW file when**:
- Starting a new session (new day or new major task)
- Completing an investigation (final report)
- Creating permanent documentation (goes to docs/)

**UPDATE existing file when**:
- Adding findings during same session
- Updating status
- Adding progress notes
- Documenting next steps

---

## 📁 Directory Structure

```
reports/
├── sessions/              # One file per work session
│   ├── 2025-11-10-session-1.md
│   ├── 2025-11-10-session-2.md
│   └── 2025-11-11-session-1.md
│
├── investigations/        # Deep dives organized by topic
│   ├── pnl-calculation/
│   │   ├── 2025-11-01-initial-findings.md
│   │   └── 2025-11-10-final-report.md
│   ├── database-schema/
│   └── backfill-issues/
│
├── final/                 # Completed, permanent reports
│   ├── pnl-system-complete.md
│   └── database-audit-final.md
│
└── archive/              # Old sessions (auto-archived after 30 days)
    └── 2025-10/
```

---

## 🔧 How to Use (For AI Agents)

### Starting a Session

1. **Check if session report exists for today**:
   ```bash
   ls reports/sessions/$(date +%Y-%m-%d)-session-*.md
   ```

2. **Create new session report** (only if none exists):
   ```bash
   # Get next session number for today
   NEXT_NUM=$(ls reports/sessions/$(date +%Y-%m-%d)-session-*.md 2>/dev/null | wc -l | xargs -I {} echo $(({}+1)))
   SESSION_FILE="reports/sessions/$(date +%Y-%m-%d)-session-${NEXT_NUM}.md"
   ```

3. **Use session report** throughout the session:
   - Add findings as you discover them
   - Update progress section
   - Document files modified
   - Track time spent

### During the Session

**Instead of creating**:
- `PNL_INVESTIGATION_FINDINGS.md`
- `PNL_INVESTIGATION_SUMMARY.md`
- `PNL_INVESTIGATION_COMPLETE.md`
- `PNL_INVESTIGATION_FINAL.md`

**Do this**:
```markdown
# Update existing session report

## Key Findings (Updated 3:45 PM)
### PnL Investigation
- Discovery 1: Found normalization issue
- Discovery 2: Fixed join bug
- Discovery 3: Verified with test data

**Status**: Complete ✅
```

### Ending a Session

1. **Mark session complete**:
   ```markdown
   **Status**: Complete ✅
   **Completed**: [time]
   **Total Time**: [duration]
   ```

2. **If important, create final report**:
   - Move key findings to `reports/final/[topic]-final-report.md`
   - Or move to `docs/` if permanent documentation

3. **Clean up**:
   - Delete any temporary MD files created in root
   - Ensure all findings captured in session report

---

## 🎯 Examples

### ❌ BAD (Creates Chaos)

Session creates:
- `PNL_INVESTIGATION.md`
- `PNL_FINDINGS.md`
- `PNL_STATUS.md`
- `PNL_COMPLETE.md`
- `PNL_SUMMARY.md`

**Result**: 5 files, unclear which is current, duplicated info

---

### ✅ GOOD (Organized)

Session uses:
- `reports/sessions/2025-11-10-session-1.md` (ONE file)

Updates throughout session:
```markdown
# Session Report: PnL Investigation - 2025-11-10

**Started**: 2:00 PM
**Last Updated**: 4:30 PM
**Status**: Complete ✅
**Terminal**: Main

## Objective
Fix PnL calculation normalization issue

## Progress
- [x] Investigated normalization patterns
- [x] Found join bug in condition_id format
- [x] Fixed and tested
- [x] Verified with 3 test wallets

## Key Findings
1. condition_id needed lowercase normalization
2. Join was failing due to case mismatch
3. Fix increased coverage from 85% to 98%

## Files Modified
- lib/clickhouse/queries/pnl-calculation.ts
- scripts/verify-pnl-coverage.ts

## Verification
✅ Test wallet 1: $1,234 PnL matches Polymarket
✅ Test wallet 2: $567 PnL matches Polymarket
✅ Test wallet 3: $890 PnL matches Polymarket

## Next Steps
- Deploy to production
- Monitor for 24 hours
```

**Result**: 1 file, clear history, all info in one place

---

## 🤖 Automation

### Auto-Organize Script

Create `scripts/organize-reports.ts`:
```typescript
#!/usr/bin/env npx tsx
/**
 * Organize reports - Move root MD files to proper locations
 * Run: npm run organize:reports
 */

const fs = require('fs');
const path = require('path');

// Find all report-style MD files in root
const rootMdFiles = fs.readdirSync('.')
  .filter(f => f.endsWith('.md'))
  .filter(f => /report|summary|findings|audit|investigation/i.test(f));

// Move to appropriate location based on content/name
rootMdFiles.forEach(file => {
  // Logic to determine destination
  // Move to reports/sessions/ or reports/investigations/
});
```

Add to package.json:
```json
"scripts": {
  "organize:reports": "tsx scripts/organize-reports.ts"
}
```

---

## 📋 Quick Reference

**Question**: Should I create a new MD file?
**Answer**:
- Are you starting a new session? → Create `reports/sessions/YYYY-MM-DD-session-N.md`
- Are you continuing current work? → Update existing session report
- Are you finalizing an investigation? → Create `reports/final/[topic]-final-report.md`
- Are you creating permanent docs? → Create in `docs/[category]/`
- Otherwise? → **Don't create, update session report**

**Question**: Where do I put investigation findings?
**Answer**:
- During work: Session report
- When complete: `reports/investigations/[topic]/YYYY-MM-DD-[topic]-findings.md`
- Final permanent: `reports/final/[topic]-final-report.md` or `docs/`

**Question**: What if I need to share findings with other agents?
**Answer**:
- Session report is perfect for this
- Other agents can read `reports/sessions/[today's date]-session-N.md`
- No need to create separate summary files

---

## 🔍 How Other Agents Find Your Work

### For Codex (Orchestrator)
```bash
# Check today's sessions
ls reports/sessions/$(date +%Y-%m-%d)-*.md

# Read latest session
cat reports/sessions/$(date +%Y-%m-%d)-session-*.md | tail -1
```

### For Claude 2/3 (Other Terminals)
- Codex tells them: "Read reports/sessions/2025-11-10-session-1.md for context"
- They update same file with their terminal ID
- Everyone shares ONE source of truth

### For claude-self-reflect (Vector Search)
- Session reports get indexed automatically
- Future agents can search: "How did we fix PnL issue?"
- Finds session report with complete context

---

## 🎯 Success Metrics

**Before (Chaos)**:
- 10+ MD files created per session
- Duplicated information across files
- Unclear which file is current
- Root directory cluttered

**After (Organized)**:
- 1 session report per session
- All info in one place
- Clear progression of work
- Clean root directory
- Easy to find past work

---

## 🚨 Emergency: "I Already Created MD Files"

If you catch yourself mid-session with multiple MD files:

1. **Consolidate now**:
   ```bash
   # Merge all related files into session report
   cat PNL_*.md >> reports/sessions/$(date +%Y-%m-%d)-session-1.md

   # Delete the extras
   rm PNL_*.md
   ```

2. **Continue with session report** for rest of session

3. **Learn from it** - Next time, start with session report

---

**Remember**: ONE report per session. Update it as you go. Don't create MD chaos.
