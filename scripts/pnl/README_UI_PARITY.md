# UI Parity Harness - Documentation Index

## What is This?

The UI Parity Harness is a validation system that compares V20b PnL calculations against Polymarket's UI data to ensure accuracy and identify edge cases.

## Start Here

👉 **New User?** Start with [QUICK_START.md](./QUICK_START.md) (5 minutes)

## Documentation

| Document | Purpose | When to Read |
|----------|---------|--------------|
| **[QUICK_START.md](./QUICK_START.md)** | 5-minute quick start guide | First time using the system |
| **[UI_PARITY_HARNESS_README.md](./UI_PARITY_HARNESS_README.md)** | Complete system documentation | Need detailed instructions |
| **[IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)** | Implementation notes and testing | Want to understand how it works |

## Scripts

| Script | Purpose | Command |
|--------|---------|---------|
| **scrape-ui-data-mcp.ts** | Generate scraping tasks and save UI data | `npx tsx scripts/pnl/scrape-ui-data-mcp.ts` |
| **ui-parity-harness.ts** | Validate V20b against UI data | `npx tsx scripts/pnl/ui-parity-harness.ts` |

## Quick Commands

```bash
# Generate scraping tasks (10 wallets)
npx tsx scripts/pnl/scrape-ui-data-mcp.ts --batch 10

# Save a wallet result
npx tsx scripts/pnl/scrape-ui-data-mcp.ts --save "0x123...,-312.78,1200.50,-1513.28,25000"

# Resume scraping
npx tsx scripts/pnl/scrape-ui-data-mcp.ts --resume

# Run validation
npx tsx scripts/pnl/ui-parity-harness.ts

# Run with limit
npx tsx scripts/pnl/ui-parity-harness.ts --limit 20
```

## Workflow Overview

```
1. SCRAPE → 2. SAVE → 3. VALIDATE → 4. ANALYZE
    ↓           ↓           ↓            ↓
  Tasks      Cache     Results      Insights
```

## Output Files

| File | Description |
|------|-------------|
| `tmp/ui-scrape-cache.json` | Cached UI data from Polymarket |
| `tmp/ui-scrape-checkpoint.json` | Progress tracking |
| `data/ui-parity-results.json` | Validation results |

## Support

- **Questions?** Read [UI_PARITY_HARNESS_README.md](./UI_PARITY_HARNESS_README.md)
- **Issues?** Check troubleshooting in [QUICK_START.md](./QUICK_START.md)
- **Technical Details?** See [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)

## Related Documentation

- [V20b Engine](../../lib/pnl/uiActivityEngineV20b.ts) - PnL calculation logic
- [PnL Vocabulary](../../docs/systems/pnl/PNL_VOCABULARY_V1.md) - Metric definitions
- [Validation Matrix](../../docs/systems/pnl/VALIDATION_MATRIX_V1.md) - Test coverage

---

**Status**: ✅ Production Ready
**Last Updated**: 2025-12-15
