# Baselines and Revert Instructions

**Last Updated:** 2025-12-17
**Pre-Rewrite Tag:** `pnl-pre-subgraph-rewrite-2025-12-17`

---

## Golden Wallets (20)

These wallets are used for validation across all engine versions.

### Set 1: High Volume, Low Taker

| # | Wallet | Username | Taker% | Notes |
|---|--------|----------|--------|-------|
| 1 | 0x1ff26f9f8a048d4f6fb2e4283f32f6ca64d2dbbd | @cozyfnf | 11.5% | Primary test wallet |
| 2 | 0xee67f4f549180f564dd5910b1024b8c6729cef38 | @keasiyo | 4.3% | Low taker |
| 3 | 0x1521b47bf0c41f6b7fd3ad41cdec566812c8f23e | @alliswell | 3.2% | Low taker |
| 4 | 0xba6eebf703248aa84eaa664e0f35d370dfa46958 | --- | 1.7% | Zero unrealized |
| 5 | 0x04cb1b51625e66beb655cfa9c25ac1eb90c426f | --- | ~0% | Pure maker |

### Set 2: High Taker (Challenging)

| # | Wallet | Username | Taker% | Notes |
|---|--------|----------|--------|-------|
| 6 | 0x8fe70c889ce14f67acea5d597e3d0351d73b4f20 | @amused85 | 31.8% | FALSE POSITIVE case |
| 7 | 0x42592084120b0d5287059919d2a96b3b7acb936f | @antman-batman | ~30% | 124x overestimate |
| 8 | 0x26437896ed9dfeb2f69765edcafe8fdceaab39ae | @Latina | ~25% | High volume |

### Set 3: Various Patterns

| # | Wallet | Notes |
|---|--------|-------|
| 9-20 | TBD | To be selected after Playwright validation |

---

## Engine Outputs at Each Stage

### Wallet: 0x1ff26f9f8a048d4f6fb2e4283f32f6ca64d2dbbd (@cozyfnf)

| Engine | Realized | Unrealized | Total | vs UI |
|--------|----------|------------|-------|-------|
| maker_fifo_v1 | $1,410,873 | $1,273 | $1,412,146 | +0.1% |
| v19b_v1 (no dedup) | $4,035,798 | $0 | $4,035,798 | +186% |
| v19b_dedup_v1 | $2,435,637 | $0 | $2,435,637 | +72.8% |
| polymarket_avgcost_v1 | TBD | TBD | TBD | TBD |
| UI (WebFetch) | --- | --- | $1,409,525 | baseline |
| UI (Playwright) | --- | --- | TBD | TBD |

### Wallet: 0x8fe70c889ce14f67acea5d597e3d0351d73b4f20 (FALSE POSITIVE)

| Engine | Realized | Unrealized | Total | vs UI |
|--------|----------|------------|-------|-------|
| maker_fifo_v1 | $342,418 | -$333,066 | $9,352 | +9,778% |
| v19b_v1 | TBD | TBD | TBD | TBD |
| polymarket_avgcost_v1 | TBD | TBD | TBD | TBD |
| UI (WebFetch) | --- | --- | -$3,538 | baseline |
| UI (Playwright) | --- | --- | TBD | TBD |

---

## Revert Instructions

### Switch Engine Version

```bash
# Option 1: Environment variable
export PNL_ENGINE_VERSION=maker_fifo_v1

# Option 2: Direct in code
import { computePnL } from '@/lib/pnl/engineRouter';
const result = await computePnL(wallet, 'maker_fifo_v1');
```

### Rollback to Pre-Rewrite State

```bash
# Find the tag
git tag | grep pnl-pre-subgraph

# Checkout
git checkout pnl-pre-subgraph-rewrite-2025-12-17

# Or create a branch from it
git checkout -b rollback-pnl pnl-pre-subgraph-rewrite-2025-12-17
```

### Regenerate Caches

```bash
# Clear existing cache
# WARNING: This is destructive, backup first
npx tsx -e "
import { getClickHouseClient } from './lib/clickhouse/client';
const client = getClickHouseClient();
await client.command({ query: 'TRUNCATE TABLE pm_wallet_engine_pnl_cache' });
"

# Regenerate with specific engine
PNL_ENGINE_VERSION=maker_fifo_v1 npx tsx scripts/pnl/fast-compute-priority-wallets.ts
```

---

## File Preservation List

### Engine Files (DO NOT DELETE)

```
lib/pnl/costBasisEngine.ts
lib/pnl/costBasisEngineV1.ts
lib/pnl/uiActivityEngineV17.ts
lib/pnl/uiActivityEngineV19b.ts
lib/pnl/uiActivityEngineV19s.ts
lib/pnl/polymarketAccurateEngine.ts  # NEW
lib/pnl/engineRouter.ts              # NEW
```

### Batch Scripts

```
scripts/pnl/fast-compute-priority-wallets.ts
scripts/pnl/batch-compute-engine-pnl.ts
scripts/pnl/replay-cost-basis-v1.ts
scripts/pnl/check-export-counts.ts
```

### Documentation

```
docs/pnl/00_INDEX.md
docs/pnl/10_DATA_SOURCES.md
docs/pnl/20_ENGINE_MAKER_FIFO.md
docs/pnl/21_ENGINE_V19B.md
docs/pnl/22_ENGINE_POLYMARKET_AVGCOST.md
docs/pnl/30_VALIDATION_UI_TRUTH.md
docs/pnl/40_BASELINES_AND_REVERT.md
docs/pnl/PNL_ENGINE_ARCHAEOLOGY_2025_12_17.md
```

### Validation Artifacts

```
tmp/validation_sample_25.json
tmp/spotcheck_low_taker_results.md
tmp/spotcheck_low_taker_sample.json
tmp/VALIDATION_REPORT_2025_12_17.md
```

---

## Commit Checkpoints

| Tag | Date | Description |
|-----|------|-------------|
| pnl-pre-subgraph-rewrite-2025-12-17 | 2025-12-17 | Before Polymarket-accurate rewrite |

---

## Emergency Rollback Procedure

If the new engine causes production issues:

1. **Stop all exports immediately**
2. **Switch to previous engine:**
   ```bash
   export PNL_ENGINE_VERSION=maker_fifo_v1
   ```
3. **Notify stakeholders** that exports are using the legacy engine
4. **Investigate** the issue using golden wallet comparisons
5. **Fix or rollback** based on findings
