# Documentation Organization Guidelines

## Purpose
This document provides instructions for both Claude instances working on this project to keep documentation organized and maintainable.

## Folder Structure

### For AI Copilot Work (Strategy Builder & Workflow AI)
```
.agent-os/ai-copilot/
├── active/          # Currently relevant documentation
└── finished/        # Completed/archived documentation
```

### For Database & Polymarket Integration Work
```
.agent-os/polymarket-integration/
├── active/          # Currently relevant documentation
└── finished/        # Completed/archived documentation
```

## Organization Rules

### Active Folder
**Include documents that are:**
- Current roadmaps or implementation plans
- Active testing guides
- Current status documents
- Work-in-progress specifications
- Reference documents still being used

**Examples:**
- `STATUS.md` - Current project status
- `ROADMAP.md` - Current implementation roadmap
- `TESTING_GUIDE.md` - Active testing procedures
- `API_INTEGRATION_PLAN.md` - Ongoing integration work

### Finished Folder
**Include documents that are:**
- Completed migration reports
- Archived session summaries
- Superseded guides or plans
- Historical implementation notes
- "COMPLETE" documents marking finished work

**Examples:**
- `MIGRATION_COMPLETE.md` - Finished migration
- `SESSION_SUMMARY_OCT_22.md` - Historical session notes
- `OLD_ROADMAP.md` - Superseded by newer roadmap
- `IMPLEMENTATION_COMPLETE.md` - Finished implementation

## When to Move Documents

### Move to Finished When:
1. A feature or task is fully completed and deployed
2. A document is superseded by a newer version
3. A session summary or daily progress report is from a previous day
4. Migration or setup work is complete
5. The document is no longer referenced in active development

### Keep in Active When:
1. The document describes ongoing work
2. You're actively referencing it for current tasks
3. It contains the latest roadmap or status
4. Testing procedures are still being used
5. Implementation is in progress

## Cleanup Frequency

**Daily:**
- Move session summaries and progress reports from previous days to finished/
- Archive completed feature documentation

**Weekly:**
- Review all active documents
- Move superseded documentation to finished/
- Consider deleting truly obsolete finished documents (optional)

## Root Directory

Keep the root directory clean:
- Only keep critical README files
- Move all feature-specific docs to appropriate folders
- Use meaningful folder names

## Instructions for Other Claude Instance

**For Database & Polymarket Integration Work:**

1. **Create your folder structure:**
   ```bash
   mkdir -p .agent-os/polymarket-integration/active
   mkdir -p .agent-os/polymarket-integration/finished
   ```

2. **Move your documentation:**
   - Identify all your MD files (e.g., `POLYMARKET_*.md`, `DATABASE_*.md`, `DATA_API_*.md`)
   - Move currently relevant docs to `active/`
   - Move completed/archived docs to `finished/`

3. **Active folder should include:**
   - Current Polymarket integration status
   - Active API implementation plans
   - Database migration guides still in use
   - Testing procedures being followed

4. **Finished folder should include:**
   - Completed migration reports
   - Old session summaries
   - Superseded integration plans
   - "COMPLETE" documentation

5. **Maintain going forward:**
   - Create new docs in `active/` folder
   - Move to `finished/` when work is complete
   - Keep root directory clean

## Benefits

✅ **Clarity** - Know what's current vs. historical
✅ **Cleanliness** - Root directory stays organized
✅ **Context** - Easy to find relevant documentation
✅ **Collaboration** - Both Claude instances stay organized
✅ **Maintenance** - Easy to archive or delete old docs

## Example Organization

**Before:**
```
/
├── AI_COPILOT_STATUS.md
├── AI_COPILOT_COMPLETE.md
├── POLYMARKET_INTEGRATION_PLAN.md
├── DATABASE_MIGRATION_COMPLETE.md
├── SESSION_SUMMARY_OCT_22.md
└── (50+ other MD files...)
```

**After:**
```
/
├── DOCUMENTATION_ORGANIZATION.md (this file)
├── README.md
└── .agent-os/
    ├── ai-copilot/
    │   ├── active/
    │   │   ├── STATUS.md
    │   │   └── TESTING_GUIDE.md
    │   └── finished/
    │       └── COMPLETE.md
    └── polymarket-integration/
        ├── active/
        │   └── API_INTEGRATION_PLAN.md
        └── finished/
            ├── DATABASE_MIGRATION_COMPLETE.md
            └── SESSION_SUMMARY_OCT_22.md
```

## Notes

- This is a living document - update as needed
- Feel free to create additional subfolders for specific features
- Document names should be clear and descriptive
- Include dates in session summaries (YYYY-MM-DD format)
