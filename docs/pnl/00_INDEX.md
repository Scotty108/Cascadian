# PnL Engine Documentation Index

**Last Updated:** 2025-12-17
**Current Default Engine:** `maker_fifo_v1`
**Status:** Pre-rewrite freeze

---

## Quick Links

| Document | Purpose |
|----------|---------|
| [10_DATA_SOURCES.md](./10_DATA_SOURCES.md) | All ClickHouse tables, schemas, dedupe patterns |
| [20_ENGINE_MAKER_FIFO.md](./20_ENGINE_MAKER_FIFO.md) | Maker-only FIFO engine (current default) |
| [21_ENGINE_V19B.md](./21_ENGINE_V19B.md) | V19b unified ledger engine |
| [22_ENGINE_POLYMARKET_AVGCOST.md](./22_ENGINE_POLYMARKET_AVGCOST.md) | Polymarket-accurate weighted average engine |
| [30_VALIDATION_UI_TRUTH.md](./30_VALIDATION_UI_TRUTH.md) | UI truth extraction requirements |
| [40_BASELINES_AND_REVERT.md](./40_BASELINES_AND_REVERT.md) | Golden wallets, revert instructions |

---

## How to Switch Engines

Set the `PNL_ENGINE_VERSION` environment variable:

```bash
# Maker-only FIFO (current default)
PNL_ENGINE_VERSION=maker_fifo_v1

# V19b unified ledger
PNL_ENGINE_VERSION=v19b_v1

# V19b with deduplication
PNL_ENGINE_VERSION=v19b_dedup_v1

# Polymarket-accurate weighted average (NEW)
PNL_ENGINE_VERSION=polymarket_avgcost_v1
```

Or use the engine router directly:

```typescript
import { computePnL } from '@/lib/pnl/engineRouter';

const result = await computePnL(wallet, 'polymarket_avgcost_v1');
```

---

## How to Run Validation

```bash
# Get UI truth for a wallet (requires Playwright)
npx tsx scripts/pnl/ui-truth-playwright-probe.ts 0x1234...

# Compare all engines against UI truth
npx tsx scripts/pnl/compare-engines-vs-ui.ts

# Generate validation report
npx tsx scripts/pnl/validate-vs-ui-playwright.ts
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| Pre-rewrite | 2025-12-17 | Freeze before Polymarket-accurate rewrite |

---

## Critical Discovery (2025-12-17)

Polymarket's official pnl-subgraph uses:
- **Weighted average cost basis** (NOT FIFO)
- **All OrderFilled events** (maker + taker)
- **Splits at $0.50, Merges at $0.50, Redemptions at resolution price**
- **Sell clamping**: `adjustedAmount = min(sellAmount, position.amount)`

Our previous engines diverged from this specification.
