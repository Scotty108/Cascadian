# PnL Gap Analysis Report

**Date:** 2025-12-04
**Terminal:** Claude 1 (Auditor Track)
**Benchmark Set:** fresh_2025_12_04_alltime

---

## Executive Summary

This report analyzes the gap between Polymarket UI displayed PnL and our scraped/calculated PnL for the top 5 benchmark wallets. Key findings:

| Metric | Value |
|--------|-------|
| UI Total PnL | $159,065,358 |
| Scraped PnL (Closed) | $54,753,699 |
| Scraped PnL (Active) | -$3,640,758 |
| **Net Scraped PnL** | **$51,112,942** |
| **Gap (Unmapped)** | **$107,952,416 (67.9%)** |

---

## Phase 1: Trump Market Resolution Verification

**Status:** PASSED

The Trump election markets have **CORRECT** resolution prices:

| Market | condition_id | resolved_price |
|--------|-------------|----------------|
| Trump wins 2024 Presidential | dd22472e... | **1.0** (Yes won) |
| Trump wins Popular Vote | cd1b6b71... | **1.0** (Yes won) |
| Which party wins 2024 | 26ee82be... | **1.0** (Republican won) |

Source: `vw_pm_resolution_prices` view - confirmed outcome_index 0 = 1.0 for winning outcome.

**Conclusion:** Resolution prices are NOT the cause of the PnL gap.

---

## Phase 2: Per-Market Scraping Results

### Closed Positions (Realized PnL)

| Wallet | Markets | Total PnL | Top Market |
|--------|---------|-----------|------------|
| Theo4 | 9 | +$15.3M | presidential-election-popular-vote (+$8.3M) |
| Fredi9999 | 17 | +$14.6M | presidential-election-winner (+$9.7M) |
| Len9311238 | 4 | +$6.4M | presidential-election-popular-vote (+$4.3M) |
| zxgngl | 5 | +$11.4M | presidential-election-winner (+$11.4M) |
| RepTrump | 5 | +$5.7M | presidential-election-popular-vote (+$4.0M) |

**Total Closed:** 40 market entries, $54.7M PnL

### Active Positions (Unrealized PnL)

| Wallet | Markets | Current Value | Top Position |
|--------|---------|--------------|--------------|
| Theo4 | 8 | $0.12M | Henry Cavill/James Bond |
| Fredi9999 | 14 | $0.08M | Which party wins 2024 |
| Len9311238 | 4 | $3.1M | Kamala Harris wins popular vote |
| zxgngl | 1 | $0 | Mike Tyson vs Jake Paul |
| RepTrump | 5 | $0.03M | Which party wins 2024 |

**Total Active:** 32 market entries, $14.7M current value, -$3.6M unrealized PnL

---

## Gap Analysis

### Gap Breakdown Hypothesis

The 67.9% gap ($108M) between UI Total PnL and scraped PnL is likely caused by:

1. **Pagination Limits (Primary):** UI infinite scroll only loaded 9-17 markets per wallet before stopping. Major whales likely have 50-100+ resolved markets.

2. **Non-Standard Market Types:** Markets with unusual outcome structures (multi-outcome, ranges) may not be captured by our slug-based parsing.

3. **Activity Tab Redemptions:** The Activity tab shows "Redeem" entries (see screenshot: Theo4 redeemed $120,469.39 from "Which party wins 2024"). These redemptions represent realized gains but aren't in the Positions/Closed view.

4. **Merge Transactions:** "Merge" events in Activity tab represent position consolidation that affects PnL accounting.

### Per-Wallet Gap Analysis

| Wallet | UI PnL | Scraped PnL | Gap | Gap % |
|--------|--------|-------------|-----|-------|
| Theo4 | $22,053,934 | $15,336,002 | $6,717,932 | 30.5% |
| Fredi9999 | $47,212,876 | $14,504,254 | $32,708,622 | 69.3% |
| Len9311238 | $11,423,891 | $6,427,654 | $4,996,237 | 43.7% |
| zxgngl | $16,445,119 | $11,447,968 | $4,997,151 | 30.4% |
| RepTrump | $5,748,621 | $3,397,063 | $2,351,558 | 40.9% |

---

## Critical Finding: Data Ingestion Issue

The `audit-ledger-vs-raw.ts` audit revealed:

| Source | Status |
|--------|--------|
| pm_trader_events_v2 | 126,521 trades, $626M volume |
| pm_unified_ledger_v7 | **0 entries** |
| pm_ctf_events | Available (CTF events tracked) |

**The unified ledger is EMPTY.** The V20 engine queries pm_unified_ledger_v7 for payout_norm and trade data, but this table has no data for benchmark wallets.

**This is a critical data pipeline issue that explains why V20 PnL calculations may be failing.**

---

## Recommendations

### Immediate Actions (Builder Agent)

1. **Investigate pm_unified_ledger_v7 population:**
   - Check backfill scripts for this table
   - Verify data is being ingested from raw sources
   - Consider rebuilding from pm_trader_events_v2

2. **Increase scraping depth:**
   - Current: 30 pages per filter
   - Recommended: 100+ pages or until no new data
   - Add Activity tab scraping for redemptions

3. **Alternative PnL calculation path:**
   - If unified ledger rebuild is slow, consider calculating directly from pm_trader_events_v2 + pm_condition_resolutions

### Data Tables Status

| Table | Status | Notes |
|-------|--------|-------|
| pm_trader_events_v2 | Active | 126K+ trades |
| pm_ctf_events | Active | CTF events tracked |
| pm_unified_ledger_v7 | EMPTY | Critical issue |
| pm_condition_resolutions | Active | Resolution prices correct |
| vw_pm_resolution_prices | Active | Derived view working |

---

## Artifacts Created

| File | Purpose |
|------|---------|
| scripts/pnl/sync-ui-pnl-comprehensive.ts | V2 scraper with Closed+Active |
| scripts/pnl/audit-ledger-vs-raw.ts | Data integrity audit |
| scripts/pnl/decompose-error-by-market.ts | Per-market error analysis |
| pm_ui_pnl_by_market_v2 | ClickHouse table with scraped data |

---

## Appendix: Top Markets by PnL Contribution

Based on scraped data, these markets account for ~90%+ of realized PnL:

1. **presidential-election-winner-2024** - $28.5M across wallets
2. **presidential-election-popular-vote-winner-2024** - $20.4M across wallets
3. **which-party-wins-presidency-popular-vote** - $3.0M across wallets

The Trump/Republican election markets dominate the PnL for these top wallets.

---

*Report generated by Claude 1 (Auditor Track)*
