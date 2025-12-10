# PnL Engines Archive (Pre-V12)

> **Archived:** 2025-12-09 | **Reason:** Superseded by V12 canonical engine

## What's Here

These engines are deprecated and no longer in active use. V12 is now the canonical PnL engine.

| File | Engine | Why Archived |
|------|--------|--------------|
| hybridEngineV25.ts | V25 Hybrid | Superseded by V12 |
| goldenEngineV26.ts | V26 Golden | Superseded by V12 |
| inventoryEngineV27.ts | V27 Inventory | Superseded by V12 |
| inventoryEngineV27b.ts | V27b Inventory | Superseded by V12 |
| inventoryEngineV28.ts | V28 Condition-level | Superseded by V12 |
| inventoryEngineV29.ts | V29 Inventory | Superseded by V12 |
| v29BatchLoaders.ts | V29 Batch helpers | Superseded by V12 |

## Current Engine

For active PnL engine code, use:
- `../v12CashRealized.ts` - V12 Cash Realized PnL
- `../v12CashV2Realized.ts` - V12 CashV2 with improved query
- `../dataSourceConstants.ts` - Table constants

## Recovery

```bash
git checkout HEAD~1 -- lib/pnl/archive/engines_pre_v12/FILENAME.ts
```
