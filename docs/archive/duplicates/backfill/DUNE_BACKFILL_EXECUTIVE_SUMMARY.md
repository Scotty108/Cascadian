# Dune Analytics Polymarket P&L Research: Executive Summary

**TL;DR:** YES, use Dune for quick backfill (3-5 hours), then transition to own pipeline for sustainability.

---

## The Question

Can we backfill P&L for 4 test wallets (HolyMoses7, niggemon, etc.) using Dune Analytics instead of building our own from scratch?

---

## The Answer

### Quick Backfill: YES ✅
- **Feasibility:** HIGH (Dune has full Polymarket data)
- **Effort:** 3-5 hours
- **Cost:** FREE (use Dune free tier)
- **Confidence:** MEDIUM (70%) - needs validation vs polymarket.com UI

### Production Deployment: HYBRID APPROACH ✅
- **Phase 1:** Dune backfill for historical data (1,048 days)
- **Phase 2:** Own pipeline (CLOB API + Substreams) for ongoing sync
- **Total effort:** 4 weeks to production
- **Long-term cost:** Free (self-hosted)

---

## What Dune Has

| Resource | Status |
|----------|--------|
| **Polymarket tables** | 16 core tables ✅ (trades, positions, markets, users) |
| **P&L calculation** | MISSING ❌ (no canonical table - each dashboard does own logic) |
| **Data freshness** | 5-10 min lag (batch updated) |
| **Historical scope** | 1,048+ days available ✅ |
| **API export** | YES ✅ (JSON via API or CSV via UI) |

### The Gap

Dune doesn't provide a "realized_pnl" table. You must:
1. Extract trades + market resolution data
2. Apply the standard formula: `pnl = shares * (payout / denominator) - cost_basis`
3. Load into ClickHouse

---

## Quickest Path (3-5 hours)

```
1. Create Dune account (free)
2. Write SQL to extract HolyMoses7 trades:
   SELECT * FROM polymarket_polygon_market_trades
   WHERE trader = 0x[address]
3. Join to polymarket_polygon_market_outcomes for resolution data
4. Click "Export to CSV"
5. Write 100-line Python script to:
   - Normalize condition_id (lowercase, strip 0x)
   - Calculate realized PnL per market
   - Load to ClickHouse
6. Validate 100 sample trades vs polymarket.com UI
7. Repeat for 3 other wallets
```

**Result:** Full historical P&L for 4 wallets in ClickHouse, ready to display on dashboard.

---

## Why Not Just Use Dune Ongoing?

| Reason | Impact |
|--------|--------|
| **Data quality unknown** | No audit report comparing Dune to official UI |
| **Vendor lock-in** | Dune owns the data schema |
| **Cost** | Premium features cost $500-5000/month |
| **Real-time gaps** | 5-10 min lag (too slow for live dashboard) |
| **Customization** | Limited to Dune's SQL interface |

---

## The Recommended 4-Week Plan

### Week 1: Validate & Backfill
- Day 1-2: Dune CSV export + Python ETL (3-5 hours)
- Day 3-4: Load to ClickHouse, validate 100 trades
- Day 5-7: Backfill all 4 wallets, go/no-go decision

### Weeks 2-3: Parallel Pipeline
- Start ingesting live trades from Polymarket CLOB API
- Monitor blockchain for settlement events
- Reconcile vs Dune backfill

### Week 4: Cutover
- Stop dependency on Dune
- Run 30-day validation
- Production launch with own pipeline

---

## Top 3 Risks

| Risk | Mitigation |
|------|-----------|
| **P&L formula mismatch** | Validate 100 sample trades against polymarket.com before full load |
| **Resolved market gaps** | Ensure all markets show resolution data; handle timeouts |
| **Fee calculation** | Verify trading fees captured; should match declared totals ±1% |

---

## Comparison: Dune vs Substreams vs Build-From-Scratch

| Approach | Setup Time | Data Freshness | Cost | Effort |
|----------|-----------|-----------------|------|--------|
| **Dune backfill** | 3-5 hours | 5-10 min | Free | Low |
| **Substreams (streaming)** | 12-16 hours | 1-3 min | Free | High |
| **Build from CLOB API** | 8-12 hours | Real-time | Free | Medium |
| **Dune + CLOB API (hybrid)** | 10-14 hours | Real-time | Free | Medium |

**Winner:** Dune for backfill, then CLOB API for forward sync = best ROI.

---

## Go/No-Go Decision

### PROCEED with Dune backfill if:
- You can validate ±5% accuracy vs UI
- You commit to own pipeline by Week 4
- Team has 1 person available for 3-5 hours

### DO NOT use Dune-only if:
- You need real-time P&L (<1 min lag)
- You can't afford >5% margin of error
- You want zero external dependencies

---

## Next Steps

1. **TODAY:** Create Dune account, write sample SQL for HolyMoses7
2. **TOMORROW:** Export 100 trades, validate against polymarket.com
3. **THIS WEEK:** Run full backfill for 4 wallets
4. **NEXT WEEK:** Start own pipeline in parallel
5. **WEEK 4:** Production launch

---

## Resources

- **Dune Spellbook:** 16 core Polymarket tables, fully documented
- **Polymarket CLOB API:** Rest API for live trade data (free, 100 req/min)
- **Substreams polymarket-pnl:** Real-time P&L package (free to self-host)
- **Goldsky:** Commercial alternative to Dune (~$500-5000/month)

---

**Decision:** ✅ **HYBRID (Dune backfill + own pipeline) - RECOMMENDED**

**Timeline:** 4 weeks to production
**Cost:** Free
**Risk Level:** LOW (backfill is non-critical path)

