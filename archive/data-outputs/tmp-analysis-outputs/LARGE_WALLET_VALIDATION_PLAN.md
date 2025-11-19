# Large-Scale Wallet Validation Plan

**Date**: 2025-11-11
**Goal**: Validate 30 random wallets using Polymarket UI as ground truth
**Approach**: Parallel agents with Playwright MCP

---

## Plan Overview

### Sample Size: 30 Wallets (6x larger than initial test)

**Why 30?**
- Large enough for statistical significance (30 is standard sample size)
- Small enough to complete in reasonable time (~2 hours)
- Provides 95% confidence interval if issues exist

### Execution Strategy: 3 Parallel Agents

**Agent 1 (Database Specialist)**:
- Query ClickHouse for all 30 wallets
- Get trade counts, PnL, gross gains/losses
- Time: ~20 minutes

**Agent 2 (Playwright Scraper - wallets 1-15)**:
- Use Playwright MCP to scrape Polymarket UI for wallets 1-15
- Capture PnL, prediction counts, screenshots
- Time: ~45 minutes (3 min per wallet)

**Agent 3 (Playwright Scraper - wallets 16-30)**:
- Use Playwright MCP to scrape Polymarket UI for wallets 16-30
- Capture PnL, prediction counts, screenshots
- Time: ~45 minutes (3 min per wallet)

**Coordination Agent (me)**:
- Merge results from all 3 agents
- Calculate deltas and statistics
- Generate comprehensive report
- Time: ~15 minutes

**Total Time**: ~60-75 minutes (vs 5+ hours sequential)

---

## Detailed Agent Instructions

### Agent 1: Database Query Agent

**Task**: Query ClickHouse for 30 wallets

**Input**: List of 30 wallet addresses

**Queries to run** (for each wallet):
```sql
-- Trade counts from vw_trades_canonical
SELECT count() as cnt
FROM default.vw_trades_canonical
WHERE lower(wallet_address_norm) = lower('{wallet}')

-- Trade counts from fact_trades_clean
SELECT count() as cnt
FROM cascadian_clean.fact_trades_clean
WHERE lower(wallet_address) = lower('{wallet}')

-- P&L from wallet_metrics
SELECT
  realized_pnl,
  gross_gains_usd,
  gross_losses_usd
FROM default.wallet_metrics
WHERE lower(wallet_address) = lower('{wallet}')
  AND time_window = 'lifetime'
LIMIT 1
```

**Output Format**: JSON array
```json
[
  {
    "wallet": "0x...",
    "vw_trades_canonical": 1234,
    "fact_trades_clean": 567,
    "realized_pnl": 12345.67,
    "gross_gains": 23456.78,
    "gross_losses": 11111.11
  }
]
```

**Save to**: `tmp/wallet-validation-db-results.json`

### Agent 2 & 3: Playwright Scraper Agents

**Task**: Scrape Polymarket UI for wallets (split 15 each)

**For each wallet**:

1. **Navigate to wallet page**:
   - URL: `https://polymarket.com/wallet/{address}`
   - Wait for page load (5 seconds)

2. **Extract data** (selectors may vary - adapt as needed):
   - Net P&L: Look for large dollar amount near top
   - Prediction count: Look for "X predictions" or similar text
   - Username: Look for @username if available

3. **Take screenshot**:
   - Full page screenshot
   - Save to: `docs/artifacts/polymarket-wallets/{wallet}/page.png`

4. **Extract raw HTML** (fallback if selectors don't work):
   - Get page text content
   - Parse for dollar amounts and numbers

**Output Format**: JSON array
```json
[
  {
    "wallet": "0x...",
    "polymarket_url": "https://polymarket.com/wallet/0x...",
    "polymarket_pnl": 12345.67,
    "polymarket_predictions": 1234,
    "username": "@example",
    "screenshot_path": "docs/artifacts/polymarket-wallets/{wallet}/page.png",
    "scraped_at": "2025-11-11T10:30:00Z",
    "notes": ""
  }
]
```

**Save to**:
- Agent 2: `tmp/wallet-validation-ui-results-1-15.json`
- Agent 3: `tmp/wallet-validation-ui-results-16-30.json`

**Error Handling**:
- If page doesn't load: Note "PAGE_LOAD_FAILED"
- If wallet doesn't exist: Note "WALLET_NOT_FOUND"
- If can't extract P&L: Note "PNL_NOT_FOUND"
- Continue with next wallet (don't abort)

---

## Wallet Selection

**Method**: Random sample from mg_wallet_baselines.md (30 wallets)

**Command**:
```bash
grep -oE "0x[a-fA-F0-9]{40}" docs/mg_wallet_baselines.md | sort -R | head -30 > tmp/sample-30-wallets.txt
```

**Ensure diversity**:
- Include baseline wallet (0xcce2b7...58b) for validation
- Include test wallet (0x8e9e...e4) to see if still anomalous
- 28 other random wallets

---

## Playwright MCP Tools Available

Based on available tools, here's how to use them:

**Browser Navigation**:
```typescript
// Tool name might be one of:
mcp__playwright__browser_navigate
playwright_navigate
browser_navigate
```

**Screenshot Capture**:
```typescript
mcp__playwright__browser_take_screenshot
playwright_screenshot
```

**Page Content**:
```typescript
mcp__playwright__browser_snapshot
playwright_snapshot
```

**Wait for Element**:
```typescript
mcp__playwright__browser_wait_for
playwright_wait
```

---

## Final Report Generation

**Merge results**:
1. Load `tmp/wallet-validation-db-results.json`
2. Load `tmp/wallet-validation-ui-results-1-15.json`
3. Load `tmp/wallet-validation-ui-results-16-30.json`
4. Join on wallet address

**Calculate metrics**:
- Delta (our PnL - Polymarket PnL)
- Delta % ((delta / Polymarket PnL) * 100)
- Coverage % ((our trades / Polymarket predictions) * 100)

**Statistical analysis**:
- Mean delta %
- Median delta %
- Standard deviation
- Wallets within ±5% (good)
- Wallets within ±20% (acceptable)
- Wallets >50% off (investigate)

**Output files**:
1. `tmp/wallet-validation-30-final.json` - Complete dataset
2. `docs/reports/wallet-validation-30-2025-11-11.md` - Executive summary
3. `docs/reports/wallet-validation-30-detailed.md` - Detailed analysis
4. `tmp/wallet-validation-30-statistics.json` - Statistical summary

---

## Success Criteria

**Excellent** (>80% confidence):
- ≥24/30 wallets within ±20% variance
- Median variance <10%
- Baseline wallet still validates

**Good** (70-80% confidence):
- ≥21/30 wallets within ±20% variance
- Median variance <20%

**Concerning** (<70% confidence):
- <21/30 wallets within ±20% variance
- Median variance >20%
- Would require investigation before publication

---

## Timeline

**Total**: ~75 minutes with parallel execution

| Phase | Duration | Agent(s) |
|-------|----------|----------|
| Select 30 wallets | 2 min | Me |
| Query ClickHouse | 20 min | Agent 1 (database-query) |
| Scrape UI (1-15) | 45 min | Agent 2 (Playwright) |
| Scrape UI (16-30) | 45 min | Agent 3 (Playwright) |
| Merge & analyze | 15 min | Me |

**Parallelization**:
- Agents 1, 2, 3 run concurrently
- Wall time: ~45 minutes (longest agent)
- Total compute time: ~80 minutes

---

## Fallback Plan (If Playwright MCP Fails)

**Option A**: Manual delegation to Claude 3
1. Generate detailed prompt with 30 wallet URLs
2. Claude 3 uses Playwright MCP to scrape
3. Returns JSON results
4. I merge with database results

**Option B**: Use Polymarket Data API
1. Query `/positions?user={wallet}` for each wallet
2. Count positions (proxy for predictions)
3. Less accurate but faster

**Option C**: Sequential manual testing
1. Test 5 wallets manually in browser
2. Document what selectors work
3. Build scraper script with known selectors

---

## Risk Mitigation

**Risk 1**: Playwright MCP tools not working
- **Mitigation**: Fallback to Claude 3 delegation

**Risk 2**: Polymarket rate limiting
- **Mitigation**: Add 3-5 second delays between requests

**Risk 3**: Page selectors change
- **Mitigation**: Extract raw HTML and parse text

**Risk 4**: Some wallets don't exist on Polymarket
- **Mitigation**: Mark as "NOT_FOUND", continue with others

**Risk 5**: Parallel agents fail
- **Mitigation**: Can run sequentially if needed (takes longer)

---

## Expected Outcomes

**Best case** (likely):
- 27-30/30 wallets validate within ±20%
- Confirms data is complete and accurate
- High confidence to publish

**Good case**:
- 21-26/30 wallets validate
- Identifies specific wallets with issues
- Can publish with notes about outliers

**Concerning case** (unlikely based on 5-wallet sample):
- <21/30 wallets validate
- Suggests systemic issues
- Would need deeper investigation

---

## Ready to Execute?

**Command to start**:
```bash
# Generate 30 random wallets
grep -oE "0x[a-fA-F0-9]{40}" docs/mg_wallet_baselines.md | sort -R | head -30 > tmp/sample-30-wallets.txt

# Launch 3 parallel agents
# (I'll use Task tool with 3 concurrent invocations)
```

**Estimated completion**: 45-75 minutes from start

**Reports generated**: 4 files (JSON data, exec summary, detailed analysis, statistics)

**Confidence**: Will definitively answer coverage question with statistical rigor

---

**Status**: READY TO EXECUTE
**Awaiting**: User approval to proceed with 30-wallet validation
