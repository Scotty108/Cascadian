# Large-Scale PnL UI Validation Plan

**Created:** 2025-12-13
**Purpose:** Validate cohort realized PnL values against Polymarket UI for 50-200 wallets
**Method:** Playwright MCP automation with systematic sampling

---

## Executive Summary

This plan outlines a comprehensive validation of our `pm_cohort_pnl_active_v1` realized PnL values against the authoritative Polymarket UI. Prior validation has shown:
- **API Validation (500 wallets):** Median ratio 0.995x
- **Playwright Validation (8 wallets):** 100% match rate for wallets with mostly resolved positions
- **4 exact matches (1.00x)** confirmed via manual UI scraping

---

## 1. Wallet Selection Strategy

### 1.1 Stratified Sampling (200 wallets total)

| Stratum | PnL Range | Sample Size | Rationale |
|---------|-----------|-------------|-----------|
| **Large Winners** | > $10,000 | 30 | High-value validation |
| **Medium Winners** | $1,000 - $10,000 | 50 | Core profitable traders |
| **Small Winners** | $200 - $1,000 | 40 | Common retail traders |
| **Small Losers** | -$1,000 - -$200 | 40 | Verify negative PnL accuracy |
| **Medium Losers** | -$10,000 - -$1,000 | 30 | Significant loss validation |
| **Large Losers** | < -$10,000 | 10 | Edge case validation |

### 1.2 Selection Criteria

```sql
SELECT wallet, realized_pnl_usd, total_trades, omega
FROM pm_cohort_pnl_active_v1
WHERE
  total_trades >= 15         -- Enough activity
  AND total_trades <= 300    -- Not too many (PM API limits)
  AND abs(realized_pnl_usd) > 200  -- Meaningful PnL
  AND omega > 0.3 AND omega < 500  -- Reasonable risk profile
ORDER BY RAND()
```

---

## 2. Playwright MCP Workflow

### 2.1 Per-Wallet Validation Steps

```
1. NAVIGATE: browser_navigate to https://polymarket.com/profile/{wallet}
2. WAIT: browser_wait_for text="P/L" (page load)
3. SNAPSHOT: browser_snapshot (capture initial state)
4. CLICK "ALL": browser_click on "ALL" timeframe button
5. HOVER TOOLTIP: browser_hover over info icon (i) next to P/L value
6. SNAPSHOT: browser_snapshot (capture tooltip with Gain/Loss/Net/Volume)
7. EXTRACT: Parse P/L value from snapshot
8. COMPARE: Calculate ratio (cohort_pnl / ui_pnl)
9. CLASSIFY: Match (0.85-1.15x), Close (0.7-1.3x), Mismatch (<0.7x or >1.3x)
```

### 2.2 Active vs Closed Position Handling

When cohort and UI values differ significantly (ratio < 0.85 or > 1.15):

```
1. CLICK "Active": browser_click on "Active" tab
2. SNAPSHOT: Count active positions and note unrealized exposure
3. CLICK "Closed": browser_click on "Closed" tab
4. SNAPSHOT: Note closed position count
5. ANNOTATE: Mark wallet as "has_unrealized" if significant open positions
```

### 2.3 Rate Limiting

- **Delay between wallets:** 3-5 seconds
- **Batch size:** 20 wallets per session
- **Session breaks:** 2-minute pause between batches
- **Estimated runtime:** 50 wallets = ~5-7 minutes, 200 wallets = ~25-30 minutes

---

## 3. Data Collection Format

### 3.1 Output JSON Schema

```json
{
  "metadata": {
    "validation_id": "ui_validation_2025_12_13",
    "started_at": "2025-12-13T10:00:00Z",
    "completed_at": "2025-12-13T10:30:00Z",
    "total_wallets": 200,
    "tolerance": 0.15
  },
  "summary": {
    "exact_matches": 45,
    "close_matches": 120,
    "mismatches": 35,
    "match_rate_strict": 0.225,
    "match_rate_tolerant": 0.825,
    "median_ratio": 0.995,
    "p10_ratio": 0.82,
    "p90_ratio": 1.15
  },
  "wallets": [
    {
      "wallet": "0x...",
      "cohort_pnl": 1234.56,
      "ui_pnl": 1230.00,
      "ratio": 1.004,
      "match_status": "exact",
      "pnl_stratum": "medium_winner",
      "has_active_positions": false,
      "ui_metrics": {
        "volume_traded": 5000.00,
        "gain": 2000.00,
        "loss": 770.00,
        "net_total": 1230.00
      },
      "validated_at": "2025-12-13T10:05:23Z"
    }
  ]
}
```

### 3.2 Match Status Classification

| Status | Ratio Range | Interpretation |
|--------|-------------|----------------|
| `exact` | 0.99 - 1.01 | Perfect match |
| `close` | 0.85 - 1.15 (excl. exact) | Within tolerance |
| `near` | 0.70 - 1.30 (excl. close) | Likely unrealized PnL difference |
| `mismatch` | < 0.70 or > 1.30 | Requires investigation |

---

## 4. Error Handling

### 4.1 Common Issues

| Issue | Detection | Response |
|-------|-----------|----------|
| **Page not found** | HTTP 404 or "not found" text | Skip, mark as `wallet_not_found` |
| **Rate limited** | Slow response or captcha | Pause 30 seconds, retry once |
| **UI element not found** | Snapshot missing P/L | Skip, mark as `ui_element_missing` |
| **Value parsing error** | Non-numeric P/L | Log raw value, attempt regex parse |
| **Private profile** | "This profile is private" | Skip, mark as `private_profile` |

### 4.2 Retry Logic

```
MAX_RETRIES = 2
RETRY_DELAY = 5 seconds

for each wallet:
  for attempt in range(MAX_RETRIES):
    try:
      result = validate_wallet(wallet)
      break
    except RateLimitError:
      wait(30)
    except ElementNotFoundError:
      wait(RETRY_DELAY)
```

---

## 5. Execution Plan

### 5.1 Phase 1: Pilot (50 wallets)

**Goal:** Validate workflow, calibrate timeframes, identify edge cases

```
1. Select 50 wallets from tmp/playwright_50_wallets.json
2. Run validation workflow with 5-second delays
3. Review results, identify any systematic issues
4. Adjust tolerance thresholds if needed
5. Document edge cases and handling
```

**Success criteria:** > 70% match rate (0.85-1.15x)

### 5.2 Phase 2: Full Validation (200 wallets)

**Goal:** Comprehensive validation with statistical significance

```
1. Generate stratified sample of 200 wallets
2. Run validation in 4 batches of 50
3. Aggregate results
4. Generate final report
```

**Success criteria:**
- Median ratio within 0.95-1.05x
- > 65% match rate at 15% tolerance
- < 10% severe mismatches (< 0.7x or > 1.3x)

### 5.3 Phase 3: Analysis & Report

```
1. Calculate summary statistics (median, percentiles, match rates)
2. Segment analysis by PnL stratum
3. Investigate mismatches (check for unrealized PnL patterns)
4. Generate final markdown report
5. Archive JSON results
```

---

## 6. Expected Outcomes

### 6.1 Success Metrics

| Metric | Target | Acceptable |
|--------|--------|------------|
| **Median Ratio** | 0.98 - 1.02 | 0.95 - 1.05 |
| **Strict Match Rate** (±1%) | > 20% | > 15% |
| **Tolerant Match Rate** (±15%) | > 75% | > 65% |
| **Severe Mismatch Rate** | < 5% | < 10% |

### 6.2 Known Limitations

1. **Unrealized PnL:** Cohort tracks realized only; UI shows total. Wallets with large open positions will show discrepancies.
2. **Timing:** UI values update in real-time; cohort snapshots may lag.
3. **Multi-outcome markets:** Complex markets may have resolution timing differences.

---

## 7. Implementation Script Location

The validation script should be created at:
```
scripts/pnl/large-scale-ui-validation.ts
```

Output files:
```
tmp/ui_validation_2025_12_13_pilot.json    # Phase 1 results
tmp/ui_validation_2025_12_13_full.json     # Phase 2 results
docs/reports/UI_VALIDATION_REPORT_2025_12_13.md  # Final report
```

---

## 8. Next Steps

1. [ ] Review and approve this plan
2. [ ] Generate stratified wallet sample (200 wallets)
3. [ ] Run Phase 1 pilot validation (50 wallets)
4. [ ] Analyze pilot results, adjust if needed
5. [ ] Run Phase 2 full validation (200 wallets)
6. [ ] Generate final report

---

**Prepared by:** Claude Code (Opus 4.5)
**For:** Cascadian PnL Validation
