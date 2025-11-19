# Prompt for Claude 3 (Terminal C3) - Playwright Wallet Validation

**Your Mission**: Use Playwright MCP to scrape Polymarket UI data for 14 wallets, then return results to Claude 1 (C1).

---

## Context

Claude 1 (Terminal C1) is investigating data coverage. We need you to:
1. Use Playwright MCP to visit Polymarket wallet pages
2. Extract Net P&L and prediction counts from UI
3. Take screenshots
4. Return JSON results

**Why**: To validate that our database has complete coverage by comparing against Polymarket UI (ground truth).

---

## Wallets to Scrape (All 14)

```
0x1489046ca0f9980fc2d9a950d103d3bec02c1307
0xd748c701ad93cfec32a3420e10f3b08e68612125
0xa4b366ad22fc0d06f1e934ff468e8922431a87b8
0x8e9eedf20dfa70956d49f608a205e402d9df38e4
0x7f3c8979d0afa00007bae4747d5347122af05613
0xc02147dee42356b7a4edbb1c35ac4ffa95f61fa8
0x2a019dc0089ea8c6edbbafc8a7cc9ba77b4b6397
0xd06f0f7719df1b3b75b607923536b3250825d4a6
0x3b6fd06a595d71c70afb3f44414be1c11304340b
0x6770bf688b8121331b1c5cfd7723ebd4152545fb
0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0
0xcce2b7c71f21e358b8e5e797e586cbc03160d58b
0x662244931c392df70bd064fa91f838eea0bfd7a9
0x2e0b70d482e6b389e81dea528be57d825dd48070
```

---

## Your Tasks

### For Each Wallet:

1. **Navigate to Polymarket wallet page**
   ```
   URL: https://polymarket.com/wallet/{ADDRESS}
   Wait: 5-8 seconds for page load
   ```

2. **Extract Data**

   Look for these elements (selectors may vary - adapt as needed):

   **Net P&L** (large dollar amount near top):
   - Try selectors: `[data-testid="pnl"]`, `.pnl-value`, text containing "$" and "PnL"
   - Format: Could be "$123,456" or "$123,456.78" or "-$12,345"
   - Parse as float (strip "$", ",", handle negative)

   **Prediction Count** (number of predictions):
   - Try selectors: `[data-testid="predictions"]`, text containing "predictions"
   - Format: Could be "1,234 predictions" or just "1234"
   - Parse as integer

   **Username** (optional):
   - Try selectors: text starting with "@", `.username`
   - Format: "@username" or just "username"

3. **Take Screenshot**
   ```
   Path: /Users/scotty/Projects/Cascadian-app/docs/artifacts/polymarket-wallets/{ADDRESS}/page.png
   Type: Full page screenshot
   ```

4. **Handle Errors Gracefully**
   - If page doesn't load: Note "PAGE_LOAD_FAILED", continue
   - If wallet doesn't exist (404): Note "WALLET_NOT_FOUND", continue
   - If can't extract P&L: Try to get raw page text, note "PNL_NOT_FOUND"
   - **DO NOT ABORT** - process all 14 wallets even if some fail

---

## Output Format

**Save to**: `/Users/scotty/Projects/Cascadian-app/tmp/wallet-validation-ui-results-c3.json`

**JSON Structure**:
```json
[
  {
    "wallet": "0x1489046ca0f9980fc2d9a950d103d3bec02c1307",
    "polymarket_url": "https://polymarket.com/wallet/0x1489046ca0f9980fc2d9a950d103d3bec02c1307",
    "polymarket_pnl": 137663.00,
    "polymarket_predictions": 1234,
    "username": "@example",
    "screenshot_path": "docs/artifacts/polymarket-wallets/0x1489046ca0f9980fc2d9a950d103d3bec02c1307/page.png",
    "scraped_at": "2025-11-11T10:30:00Z",
    "status": "SUCCESS",
    "notes": ""
  },
  {
    "wallet": "0x8e9eedf20dfa70956d49f608a205e402d9df38e4",
    "polymarket_url": "https://polymarket.com/wallet/0x8e9eedf20dfa70956d49f608a205e402d9df38e4",
    "polymarket_pnl": null,
    "polymarket_predictions": null,
    "username": null,
    "screenshot_path": null,
    "scraped_at": "2025-11-11T10:32:00Z",
    "status": "PAGE_LOAD_FAILED",
    "notes": "Timeout after 10 seconds"
  }
]
```

**Status codes**:
- `SUCCESS`: All data extracted
- `PARTIAL`: Some data extracted (e.g., P&L but not predictions)
- `PAGE_LOAD_FAILED`: Page didn't load
- `WALLET_NOT_FOUND`: 404 or wallet doesn't exist
- `PNL_NOT_FOUND`: Couldn't extract P&L from page

---

## Implementation Strategy

### Approach 1: Use Playwright MCP Tools (Recommended)

```typescript
// For each wallet:

// 1. Navigate
await playwright_browser_navigate({
  url: `https://polymarket.com/wallet/${wallet}`
});

// 2. Wait for page load
await playwright_browser_wait_for({
  selector: 'body', // or specific element
  timeout: 8000
});

// 3. Get page snapshot
const snapshot = await playwright_browser_snapshot();

// 4. Extract data from snapshot HTML
// Parse snapshot.content for dollar amounts and numbers

// 5. Take screenshot
await playwright_browser_take_screenshot({
  path: `docs/artifacts/polymarket-wallets/${wallet}/page.png`,
  fullPage: true
});
```

### Approach 2: If MCP Tools Don't Work

Use bash + curl to fetch HTML, then parse:

```bash
#!/bin/bash
for wallet in $(cat tmp/sample-30-wallets.txt); do
  curl -s "https://polymarket.com/wallet/$wallet" > tmp/wallet-$wallet.html
  # Parse HTML for P&L and predictions
  # Use grep, sed, awk, or write quick Node script
done
```

### Approach 3: Hybrid (Most Robust)

1. Try Playwright MCP first
2. If fails, fallback to curl + HTML parsing
3. Document which method worked for each wallet

---

## Tips for Success

### Extracting P&L from HTML

Look for patterns like:
```html
<div class="pnl">$123,456</div>
<span data-testid="net-pnl">-$12,345.67</span>
```

Use regex:
```javascript
// Match dollar amounts
const pnlMatch = html.match(/[\$-]?[\d,]+\.?\d*(?=\s*(P&L|profit|PNL))/i);

// Match prediction counts
const predMatch = html.match(/(\d{1,3}(?:,\d{3})*)\s+predictions?/i);
```

### Handling Polymarket Rate Limits

Add delays between requests:
```javascript
await new Promise(resolve => setTimeout(resolve, 3000)); // 3 second delay
```

### Creating Screenshot Directories

```bash
mkdir -p docs/artifacts/polymarket-wallets/{wallet}/
```

---

## Expected Runtime

**Per wallet**: 5-10 seconds (navigate + extract + screenshot)
**Total**: 70-140 seconds (~1-2 minutes)

**With delays**: Add 3 seconds per wallet = ~42 seconds
**Total with delays**: ~2-3 minutes

---

## Validation

Before returning results, verify:
- [x] All 14 wallets processed (even if some failed)
- [x] JSON file saved to correct path
- [x] At least 10/14 wallets have P&L data (>70% success rate)
- [x] Screenshots saved (at least for successful wallets)

---

## What to Return to C1

**File**: `tmp/wallet-validation-ui-results-c3.json`

**Summary Message**:
```
✅ Scraped 14 wallets from Polymarket UI
📊 Success: X/14 (Y%)
📄 Results: tmp/wallet-validation-ui-results-c3.json
📸 Screenshots: docs/artifacts/polymarket-wallets/

Summary:
- Wallets with full data: X
- Wallets with partial data: Y
- Wallets that failed: Z
- Most common failure: [reason]

Next: C1 will merge with database results and calculate deltas.
```

---

## Fallback Plan (If Playwright MCP Completely Fails)

**Manual extraction instructions**:

1. Open browser manually
2. Visit each wallet page
3. Copy/paste P&L and prediction count into JSON
4. Take manual screenshots
5. Return partial data (better than nothing)

**Or**: Use Polymarket Data API as proxy:
```bash
curl "https://data-api.polymarket.com/positions?user={wallet}"
# Count positions as proxy for predictions
```

---

## Ready to Execute?

**Command to start**:
```bash
# Read wallet list
cat /Users/scotty/Projects/Cascadian-app/tmp/sample-30-wallets.txt

# Begin scraping
# (Use Playwright MCP tools as described above)
```

**Estimated time**: 2-5 minutes

**Output**: JSON file with 14 wallet results

---

## Questions Before Starting?

If anything is unclear:
1. Check Playwright MCP tool names: `claude mcp list | grep playwright`
2. Test on 1 wallet first before doing all 14
3. Adapt selectors based on what you see on first page

**Ready when you are!**

---

**From**: Claude 1 (Terminal C1)
**To**: Claude 3 (Terminal C3)
**Priority**: HIGH
**Blocking**: Yes - C1 is waiting for your results to complete analysis
