# UI Parity Harness - V20b Validation System

## Overview

The UI Parity Harness is a two-script validation system that compares V20b PnL calculations against Polymarket's UI data using Playwright MCP tools for automated scraping.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     UI PARITY HARNESS WORKFLOW                   │
└─────────────────────────────────────────────────────────────────┘

1. SCRAPE UI DATA (scrape-ui-data-mcp.ts)
   ├─ Load wallet list from data files
   ├─ Generate Playwright MCP instructions
   ├─ User scrapes each wallet manually
   └─ Results saved to tmp/ui-scrape-cache.json

2. VALIDATE PNL (ui-parity-harness.ts)
   ├─ Load wallets + UI cache
   ├─ Compute V20b PnL for each wallet
   ├─ Calculate deltas and assign pass/fail
   └─ Output results to data/ui-parity-results.json
```

## Files

| File | Purpose |
|------|---------|
| `scrape-ui-data-mcp.ts` | Generates scraping instructions and saves UI data |
| `ui-parity-harness.ts` | Validates V20b against UI data and generates report |
| `tmp/ui-scrape-cache.json` | Cached UI data from Polymarket |
| `tmp/ui-scrape-checkpoint.json` | Progress tracking for scraping |
| `data/ui-parity-results.json` | Final validation results |

## Quick Start

### Step 1: Generate Scraping Tasks

```bash
# Generate tasks for first 10 wallets
npx tsx scripts/pnl/scrape-ui-data-mcp.ts --batch 10
```

This outputs:
- List of wallets to scrape
- Playwright MCP instructions for each wallet
- Save commands to store results

### Step 2: Scrape Using Playwright MCP

For each wallet, execute these MCP tool calls:

#### 2a. Navigate to Profile

```
Tool: mcp__playwright__browser_navigate
URL: https://polymarket.com/profile/{wallet_address}
```

#### 2b. Hover Over Info Icon

```
Tool: mcp__playwright__browser_hover
Selector: .text-text-secondary\/60
```

The info icon is typically next to the main PnL number in the profile header.

#### 2c. Take Snapshot

```
Tool: mcp__playwright__browser_snapshot
```

Extract from the tooltip:
- **Net total**: Main PnL value (e.g., `+$1,234.56` or `-$456.78`)
- **Gain**: Total gains (e.g., `$5,000.00`)
- **Loss**: Total losses (e.g., `-$3,765.44`)
- **Volume**: Total trading volume (e.g., `$50,000.00`)

#### 2d. Save Result

```bash
npx tsx scripts/pnl/scrape-ui-data-mcp.ts --save "0x123...,1234.56,5000,-3765.44,50000"
```

Format: `wallet,net,gain,loss,volume`

**Note:** Loss values should be negative (with minus sign).

### Step 3: Repeat for Remaining Wallets

```bash
# Resume from checkpoint
npx tsx scripts/pnl/scrape-ui-data-mcp.ts --resume
```

This shows the next batch of wallets that haven't been scraped yet.

### Step 4: Run Validation

Once you have scraped 30-50 wallets:

```bash
# Run validation harness
npx tsx scripts/pnl/ui-parity-harness.ts
```

This will:
1. Load UI data from cache
2. Compute V20b PnL for each wallet
3. Calculate deltas and assign pass/fail status
4. Generate comprehensive validation report
5. Save results to `data/ui-parity-results.json`

## Advanced Usage

### Custom Wallet List

```bash
# Use specific wallets
npx tsx scripts/pnl/ui-parity-harness.ts --wallets "0x123...,0x456...,0x789..."
```

### Limit Number of Wallets

```bash
# Validate only first 20 wallets
npx tsx scripts/pnl/ui-parity-harness.ts --limit 20
```

### Skip Scraping (Use Cached Data Only)

```bash
# Generate partial results without UI data
npx tsx scripts/pnl/ui-parity-harness.ts --skip-scrape
```

## Pass/Fail Criteria

### Pass Conditions

A wallet PASSES if either:
- **Absolute delta** ≤ $250, OR
- **Percentage delta** ≤ 2% (for wallets < $100k)
- **Percentage delta** ≤ 1% (for wallets > $100k)

### Fail Reason Codes

| Code | Meaning |
|------|---------|
| `UI_SCRAPE_FAILED` | Could not get UI data (ERROR status) |
| `HIGH_CLAMP_PCT` | >10% of CLOB rows missing token_id mapping |
| `LOW_MAPPING_COVERAGE` | Token mapping gaps causing PnL discrepancy |
| `UI_MISMATCH_OTHER` | Large delta (>20%) with unknown cause |
| `CALCULATION_FAILED` | V20b calculation threw error |

## Output Format

### Cache File (tmp/ui-scrape-cache.json)

```json
{
  "scraped_at": "2025-12-15T12:00:00.000Z",
  "last_updated": "2025-12-15T14:30:00.000Z",
  "wallets": [
    {
      "wallet": "0x123...",
      "net": 1234.56,
      "gain": 5000.00,
      "loss": -3765.44,
      "volume": 50000.00,
      "scraped_at": "2025-12-15T12:05:00.000Z"
    }
  ]
}
```

### Results File (data/ui-parity-results.json)

```json
{
  "generated_at": "2025-12-15T15:00:00.000Z",
  "config": {
    "limit": 50,
    "skipScrape": false
  },
  "summary": {
    "total": 50,
    "passed": 42,
    "failed": 6,
    "errors": 2
  },
  "results": [
    {
      "wallet_address": "0x123...",
      "username": "trader123",
      "ui_net": 1234.56,
      "ui_gain": 5000.00,
      "ui_loss": -3765.44,
      "ui_volume": 50000.00,
      "v20b_net": 1230.00,
      "v20b_realized": 800.00,
      "v20b_unrealized": 430.00,
      "v20b_positions": 15,
      "v20b_resolved": 10,
      "v20b_redemption_only": 0,
      "clob_trade_count": 45,
      "clamp_pct": 2.5,
      "abs_delta": 4.56,
      "pct_delta": 0.37,
      "status": "PASS",
      "reason_code": null,
      "calculated_at": "2025-12-15T15:00:00.000Z"
    }
  ]
}
```

## Validation Report Example

```
================================================================================
VALIDATION REPORT
================================================================================

Total Wallets: 50
PASS:  42/50 (84.0%)
FAIL:  6/50 (12.0%)
ERROR: 2/50 (4.0%)

FAILURE BREAKDOWN:
  HIGH_CLAMP_PCT: 3
  LOW_MAPPING_COVERAGE: 2
  UI_MISMATCH_OTHER: 1

DELTA STATISTICS:
  Avg Abs Delta: $156.32
  Median Abs Delta: $45.78
  Avg Pct Delta: 1.24%
  Median Pct Delta: 0.58%

TOP 5 FAILURES (by absolute delta):
  1. 0x789... - $2,345.67 (15.34%) - HIGH_CLAMP_PCT
  2. 0xabc... - $1,890.23 (8.92%) - LOW_MAPPING_COVERAGE
  3. 0xdef... - $1,234.56 (6.45%) - HIGH_CLAMP_PCT
  ...

================================================================================
```

## Troubleshooting

### Hover Selector Not Working

If `.text-text-secondary\/60` doesn't work, try:
- `[class*="text-text-secondary"]`
- `button[class*="info"]`
- Look for cursor pointer near the PnL number

### Tooltip Not Appearing

- Wait 3-5 seconds after page load
- Ensure JavaScript is enabled
- Try clicking the info icon instead of hovering

### Cache File Corrupted

```bash
# Delete and start fresh
rm tmp/ui-scrape-cache.json tmp/ui-scrape-checkpoint.json
```

### Missing Wallet Data

The scripts try multiple sources in order:
1. `data/wallet-classification-report.json`
2. `tmp/playwright_50_wallets.json`
3. Custom `--wallets` argument

## Data Sources

### Wallet Lists

- **Primary**: `data/wallet-classification-report.json` - Wallets classified by CLOB/CTF activity
- **Fallback**: `tmp/playwright_50_wallets.json` - 50 random wallets for testing

### V20b PnL

- **Engine**: `lib/pnl/uiActivityEngineV20b.ts`
- **Formula**: `cash_flow + (final_tokens * resolution_price)` for resolved, `cash_flow + (final_tokens * 0.5)` for unresolved
- **Key Feature**: Includes PayoutRedemption events ONLY for positions with CLOB trades

### UI PnL

- **Source**: Polymarket profile pages (tooltip on info icon)
- **Fields**: Net total, Gain, Loss, Volume
- **Note**: UI values are provided as reference, not ground truth

## Metrics Definitions

| Metric | Definition |
|--------|-----------|
| **abs_delta** | `Math.abs(v20b_net - ui_net)` |
| **pct_delta** | `(abs_delta / Math.abs(ui_net)) * 100` |
| **clamp_pct** | Percentage of CLOB rows missing token_id mapping |
| **redemption_only** | Positions acquired via ERC1155 transfer (not CLOB) |

## Best Practices

1. **Rate Limiting**: Wait 2-3 seconds between wallet scrapes
2. **Progress Tracking**: Save after EACH wallet to preserve progress
3. **Batch Size**: Start with 10 wallets, scale up to 30-50
4. **Verification**: Spot-check a few wallets manually before batch scraping
5. **Cache Backup**: Copy `tmp/ui-scrape-cache.json` periodically

## Integration with V20b Development

This harness is designed to:
- Validate V20b accuracy against real-world UI data
- Identify wallets where V20b needs improvement
- Track metrics like clamp_pct and mapping coverage
- Generate evidence for V20b formula changes

**Key Insight**: Goal is to validate V20b logic, not blindly match Polymarket UI. Discrepancies reveal edge cases and improvement opportunities.

## Related Documentation

- [PnL Engine V20b](../../lib/pnl/uiActivityEngineV20b.ts)
- [PnL Vocabulary](../../docs/systems/pnl/PNL_VOCABULARY_V1.md)
- [Validation Matrix](../../docs/systems/pnl/VALIDATION_MATRIX_V1.md)

---

**Last Updated**: 2025-12-15
**Maintainer**: Terminal 1 (Claude)
