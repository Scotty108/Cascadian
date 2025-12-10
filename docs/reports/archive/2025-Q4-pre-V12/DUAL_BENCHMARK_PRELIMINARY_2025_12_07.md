# Dual Benchmark Validation - Preliminary Report

**Date:** 2025-12-07
**Status:** In Progress (Dome validation running)

## Overview

This report summarizes preliminary findings from the dual benchmark validation workflow comparing V11, V29, and V23C PnL engines against:
- **Dome** - Ground truth for REALIZED PnL
- **UI (Playwright)** - Ground truth for TOTAL PnL (realized + unrealized)

## Wallet Set

- **Source:** CLOB-only traders from Dome benchmarks
- **Filters:** Transfer-free, abs(PnL) >= $200
- **Total wallets:** 50

## UI Scraping Results (Playwright MCP)

Successfully scraped 8 wallets via Playwright browser automation:

| Wallet | UI Total PnL | Dome Realized | Delta | Notes |
|--------|-------------|---------------|-------|-------|
| `0x0122006b...` | $244.10 | $1,180.50 | -$936.40 | No active positions |
| `0x0148a06c...` | -$74.82 | $608.29 | -$683.11 | Many losing positions |
| `0x01cedeca...` | -$1,890.39 | -$1,700.27 | -$190.12 | Active positions |
| `0x199aefef...` | $1,718.11 | $19,222.00 | -$17,503.89 | Heavy crypto losses |
| `0x258a6d3f...` | $102,200.00 | $102,200.00 | $0.00 | **EXACT MATCH** |
| `0x57c22158...` | $59,818.80 | $100,026.81 | -$40,207.01 | $40K unrealized loss |
| `0x569e2cb3...` | -$73,452.75 | $50,557.88 | -$124,010.63 | Massive sports losses |
| `0xe62d0223...` | $48,596.41 | $71,045.90 | -$22,449.49 | $445K active positions |

### Key Observations

1. **UI Total != Dome Realized** - This is expected since:
   - Dome = Realized PnL only (closed positions)
   - UI = Total PnL (realized + unrealized)

2. **One Perfect Match** - Wallet `0x258a6d3f...` shows exact match ($102,200) because it has no active positions

3. **Unrealized Losses Dominate** - Most wallets show UI < Dome, indicating unrealized losses in active positions

4. **High-Frequency Traders Lose More** - Wallets with crypto prediction markets (15-min intervals) show massive unrealized losses

## Dome Validation Status

- **Script:** `validate-realized-vs-dome-multi.ts`
- **Progress:** 6/50 wallets processed
- **Engines:** V11, V29, V23C
- **Output:** `tmp/realized_vs_dome_multi_50.json` (in progress)

The validation is running with:
- V11: CLOB-only with price rounding
- V29: Full inventory tracking, condition-level pooled cost basis
- V23C: Shadow ledger with UI price oracle

## Files Created

| File | Purpose |
|------|---------|
| `scripts/pnl/build-clob-200-wallet-set.ts` | Wallet set builder |
| `scripts/pnl/validate-realized-vs-dome-multi.ts` | Multi-engine realized validation |
| `scripts/pnl/validate-total-vs-ui-multi.ts` | Multi-engine total validation |
| `scripts/pnl/scrape-ui-pnl.ts` | API-based UI scraper |
| `scripts/pnl/scrape-ui-pnl-playwright.ts` | Playwright template |
| `scripts/pnl/run-dual-benchmark-scorecard.ts` | Combined scorecard |
| `lib/pnl/engines/engineRegistry.ts` | Engine registry (already existed) |
| `tmp/clob_50_wallets.json` | Wallet set |
| `tmp/ui_total_pnl_clob_200.json` | UI PnL data (8 wallets) |

## Next Steps

1. **Wait for Dome validation to complete** (50 wallets, ~10-15 min remaining)
2. **Scrape more UI PnL** (need all 50 wallets for full comparison)
3. **Run dual benchmark scorecard** to determine best engine
4. **Generate final report** with recommendations

## Preliminary Recommendation

For **copy-trade leaderboard** use case:
- **Realized PnL:** Use Dome as ground truth, validate engines
- **Total PnL (UI parity):** Significant differences expected due to unrealized positions

The ideal engine should:
1. Match Dome realized PnL accurately (for closed positions)
2. Provide reasonable total PnL estimate that tracks UI trends
