# UI Truth Extraction Requirements

**Last Updated:** 2025-12-17
**Status:** NOT YET IMPLEMENTED

---

## Critical Rule

**Fetch()-based HTML parsing is INVALID for client-rendered pages.**

Polymarket's profile page is React-rendered. The HTML returned by fetch() often contains:
- Placeholder values
- Wrong metrics
- Different time windows
- Incomplete data

---

## Required: Playwright-Based Extraction

### Method 1: Network Response Interception (Preferred)

```typescript
// In Playwright:
page.on('response', async (response) => {
  const url = response.url();
  if (url.includes('/portfolio') || url.includes('/profile') || url.includes('graphql')) {
    const json = await response.json();
    // Extract pnl field from response
  }
});
```

### Method 2: DOM Selector (Fallback)

```typescript
// Wait for full render
await page.waitForLoadState('networkidle');

// Find PnL element
const pnlElement = await page.locator('[data-testid="pnl"]');
const pnlText = await pnlElement.textContent();
```

---

## Output Artifacts Required

For each validation run:

### 1. Per-Wallet Debug Files

```
tmp/ui_probe_<wallet>.png           # Screenshot
tmp/ui_probe_responses/<wallet>_*.json  # Network responses
```

### 2. Truth Specification

`tmp/ui_truth_spec.md` containing:
- The exact label on the page (e.g., "Profit" vs "P&L" vs "All-time PnL")
- The selector used OR the network endpoint used
- The JSON path used to extract the value (if network)

### 3. Validation Results

```
tmp/spotcheck_results.csv           # Raw results
tmp/spotcheck_report.md             # Analysis
```

---

## Validation CSV Schema

| Column | Description |
|--------|-------------|
| wallet | Wallet address |
| ui_pnl | Extracted UI PnL |
| ui_label | Label found on page |
| ui_timestamp | When captured |
| our_realized | Engine realized PnL |
| our_unrealized | Engine unrealized PnL |
| our_total | Engine total PnL |
| taker_ratio | From pm_wallet_trade_stats |
| external_sells_ratio | From engine |
| trade_count | Total trades |
| delta_total_pct | (our_total - ui_pnl) / ui_pnl |
| delta_realized_pct | (our_realized - ui_pnl) / ui_pnl |

---

## Validation Pass Criteria

### Bucket 1: Low Taker, Low Unrealized
- `taker_ratio <= 0.05`
- `unrealized_share <= 0.2`
- N = 50 wallets
- **Required:** ≥80% within ±10%

### Bucket 2: Low Taker, High Unrealized
- `taker_ratio <= 0.05`
- `unrealized_share > 0.5`
- N = 25 wallets
- **Required:** ≥60% within ±25%

### Bucket 3: Higher Taker
- `taker_ratio 0.15–0.30`
- N = 25 wallets
- **Required:** ≥50% within ±25%

---

## What NOT To Do

❌ Use WebFetch or fetch() to get Polymarket profile pages
❌ Parse HTML without waiting for client-side render
❌ Assume any "matching" result is valid without Playwright verification
❌ Skip network response capture for debugging

---

## Implementation Steps

1. Create `scripts/pnl/ui-truth-playwright-probe.ts`:
   - Navigate to profile page
   - Wait for networkidle
   - Capture screenshot
   - Log all API responses
   - Extract PnL value

2. Create `scripts/pnl/validate-vs-ui-playwright.ts`:
   - Load wallet sample
   - For each: probe UI, compute engine, compare
   - Output CSV and report

3. Document findings in `tmp/ui_truth_spec.md`

---

## Known Issues with WebFetch

From 2025-12-17 validation attempt:

| Wallet | WebFetch "UI PnL" | Actual UI PnL | Issue |
|--------|-------------------|---------------|-------|
| cozyfnf | $1,409,525 | TBD | May be correct |
| antman | $30,539 | TBD | Suspiciously low |
| 0x8fe7... | -$3,538 | TBD | May be correct |

**Conclusion:** Cannot trust WebFetch results until Playwright verification.
