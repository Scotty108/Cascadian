# UI Parity Harness - Quick Start Guide

## 30-Second Overview

This system validates V20b PnL calculations against Polymarket's UI using a two-step process:
1. **Scrape**: Use Playwright MCP to get UI data from Polymarket profiles
2. **Validate**: Compare V20b calculations against scraped UI data

## Quick Start (5 Minutes)

### Step 1: Generate Scraping Tasks (30 seconds)

```bash
npx tsx scripts/pnl/scrape-ui-data-mcp.ts --batch 10
```

This outputs a list of 10 wallets with scraping instructions.

### Step 2: Scrape One Wallet (2 minutes)

For wallet `0x62fadaf110588be0d8fcf2c711bae31051bb50a9`:

1. **Navigate** (using Playwright MCP):
   ```
   URL: https://polymarket.com/profile/0x62fadaf110588be0d8fcf2c711bae31051bb50a9
   ```

2. **Hover** over the info icon (next to PnL number):
   ```
   Selector: .text-text-secondary\/60
   ```

3. **Extract** tooltip data:
   - Net total: `-$257.14`
   - Gain: `$0.00`
   - Loss: `-$257.14`
   - Volume: `$399.99`

4. **Save** result:
   ```bash
   npx tsx scripts/pnl/scrape-ui-data-mcp.ts --save "0x62fadaf110588be0d8fcf2c711bae31051bb50a9,-257.14,0,-257.14,399.99"
   ```

### Step 3: Continue Scraping (repeat Step 2 for remaining wallets)

```bash
# Get next batch
npx tsx scripts/pnl/scrape-ui-data-mcp.ts --resume
```

### Step 4: Run Validation (30 seconds)

Once you have 30-50 wallets scraped:

```bash
npx tsx scripts/pnl/ui-parity-harness.ts
```

This generates a comprehensive validation report and saves results to `data/ui-parity-results.json`.

## Expected Output

### After Scraping
```
✅ Added new entry for 0x62fadaf110588be0d8fcf2c711bae31051bb50a9

Total wallets scraped: 1
Checkpoint: 1 wallets completed
```

### After Validation
```
================================================================================
VALIDATION REPORT
================================================================================

Total Wallets: 50
PASS:  42/50 (84.0%)
FAIL:  6/50 (12.0%)
ERROR: 2/50 (4.0%)

DELTA STATISTICS:
  Avg Abs Delta: $156.32
  Median Abs Delta: $45.78
  Avg Pct Delta: 1.24%
  Median Pct Delta: 0.58%
```

## Common Commands

```bash
# Generate scraping tasks
npx tsx scripts/pnl/scrape-ui-data-mcp.ts --batch 10

# Save a wallet result
npx tsx scripts/pnl/scrape-ui-data-mcp.ts --save "0x123...,-312.78,1200.50,-1513.28,25000"

# Resume from checkpoint
npx tsx scripts/pnl/scrape-ui-data-mcp.ts --resume

# Run validation
npx tsx scripts/pnl/ui-parity-harness.ts

# Run validation with limit
npx tsx scripts/pnl/ui-parity-harness.ts --limit 20

# Run validation with custom wallets
npx tsx scripts/pnl/ui-parity-harness.ts --wallets "0x123...,0x456..."
```

## Files Generated

| File | Purpose |
|------|---------|
| `tmp/ui-scrape-cache.json` | Scraped UI data (persistent) |
| `tmp/ui-scrape-checkpoint.json` | Progress tracking |
| `data/ui-parity-results.json` | Final validation results |

## Troubleshooting

### "No UI data available"
Run the scraper first: `npx tsx scripts/pnl/scrape-ui-data-mcp.ts --batch 10`

### "Hover selector not working"
Try alternative selector: `[class*="text-text-secondary"]` or `button[class*="info"]`

### "Cache corrupted"
Delete and restart: `rm tmp/ui-scrape-cache.json tmp/ui-scrape-checkpoint.json`

## Next Steps

- Read [UI_PARITY_HARNESS_README.md](./UI_PARITY_HARNESS_README.md) for detailed documentation
- Check [V20b engine](../../lib/pnl/uiActivityEngineV20b.ts) for PnL calculation logic
- Review [PnL Vocabulary](../../docs/systems/pnl/PNL_VOCABULARY_V1.md) for metric definitions

---

**Pro Tip**: Save after EACH wallet to preserve progress. The checkpoint system tracks completed wallets automatically.
