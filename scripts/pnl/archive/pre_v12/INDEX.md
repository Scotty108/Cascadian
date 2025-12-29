# Pre-V12 PnL Scripts Archive

> **Archived:** 2025-12-09 | **Reason:** Superseded by V12 canonical engine

## What's Here

These 31 benchmark and validator scripts reference deprecated engines (V2-V29) and are no longer needed for V12-era validation work.

| Category | Count | Description |
|----------|-------|-------------|
| Benchmark scripts | 14 | V2, V18-V28 engine benchmarks |
| Validator scripts | 17 | V3-V29 validation harnesses |

## Why Archived

1. **V12 is canonical** - All engines V25-V29 archived to `lib/pnl/archive/engines_pre_v12/`
2. **New validation stack** - V12 validators use `validate-v12-*.ts` and `benchmark-v12-*.ts`
3. **Clean audit** - Removes violations from canonical table audit

## Current V12 Scripts (NOT archived)

Active scripts remain in `scripts/pnl/`:
- `benchmark-v12-realized.ts`
- `benchmark-v12-realized-dual.ts`
- `benchmark-v12-realized-large.ts`
- `benchmark-v12-vs-dome-50.ts`
- `benchmark-v12-2000-wallets.ts`
- `validate-v12-vs-dome.ts`
- `validate-v12-vs-tooltip-truth.ts`
- `validate-v12-against-tooltip-truth.ts`

## Recovery

```bash
git checkout HEAD~1 -- scripts/pnl/archive/pre_v12/FILENAME.ts
```
