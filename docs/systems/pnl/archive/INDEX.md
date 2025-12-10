# PnL System Archive Index

> **Archived:** 2025-12-09 | **Reason:** Pre-V12 engine documentation superseded

## What's Here

This folder contains deprecated PnL engine documentation from engines V3-V7, V17, and V29. These were superseded by V12 which is now canonical.

## Contents

| File | Original Engine | Why Archived |
|------|-----------------|--------------|
| V3_PNL_ENGINE_ACCURACY_REPORT.md | V3 | Superseded by V12 |
| V4_*.md | V4 | Superseded by V12 |
| V5_*.md | V5 | Superseded by V12 |
| V6_*.md | V6 | Superseded by V12 |
| V7_REALIZATION_MODE_GUIDE.md | V7 | Superseded by V12 |
| V17_*.md | V17 | Superseded by V12 |
| V29_*.md | V29 | Superseded by V12 |
| ENGINE_*.md | Various | Old status reports |
| PNL_ACCURACY_*.md | Various | Old investigation plans |
| ROOT_CAUSE_*.md | Various | Issues now resolved |
| UI_*.md | Various | UI parity work completed |

## Current Documentation

For active PnL documentation, see the parent folder:
- `../V12_ARCHITECTURE_SPEC.md` - Current canonical engine
- `../PNL_VOCABULARY_V1.md` - Metric definitions
- `../TIER_A_COMPARABLE_SPEC.md` - V1 Leaderboard wallet criteria
- `../PERSISTED_OBJECTS_MANIFEST.md` - Database object inventory

## Recovery

If you need to restore any of these files, use git:
```bash
git checkout HEAD~1 -- docs/systems/pnl/archive/FILENAME.md
```
