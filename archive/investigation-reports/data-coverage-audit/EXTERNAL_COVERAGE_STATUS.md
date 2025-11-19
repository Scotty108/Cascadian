# External Trade Coverage Status

**Generated:** 2025-11-16T03:08:36.497Z
**Agent:** C2 - External Data Ingestion
**Mission:** Phase 8 - Coverage and Integration Metrics

---

## Executive Summary

**External trades ingested:** 46
**Wallets with external trades:** 1
**Markets with external-only trades:** 6
**Markets with both CLOB + external:** 0

**External share of total volume:** 100.00%
  - Internal (CLOB): $0
  - External (AMM/Data-API): $74,740.961

---

## Wallet-Level Coverage

Wallets that have external trades ingested:

| Wallet | Internal Trades | External Trades | Internal Notional | External Notional | External % | Status |
|--------|----------------|-----------------|-------------------|-------------------|------------|--------|
| `...` | 0 | 46 | $0.00 | $74740.96 | 100.00% | pending |

---

## Market-Level Coverage

Distribution of markets by data source:

| Coverage Type | Market Count | Description |
|---------------|--------------|-------------|
| **CLOB Only** | 118,660 | Markets with only CLOB trades (no external data) |
| **External Only** | 6 | Markets with only external trades (ghost markets, AMM-only) |
| **Both** | 0 | Markets with both CLOB and external trades |

### Sample Markets with External Trades

| Condition ID | Question | Internal Trades | External Trades | Internal Wallets | External Wallets |
|--------------|----------|----------------|-----------------|------------------|------------------|
| `f2ce8d3897ac5009...` | Xi Jinping out in 2025? | 0 | 27 | 0 | 1 |
| `bff3fad6e9c96b6e...` | Will Trump sell over 100k Gold Cards in 2025? | 0 | 14 | 0 | 1 |
| `e9c127a8c35f045d...` | Will Elon cut the budget by at least 10% in 2025? | 0 | 2 | 0 | 1 |
| `293fb49f43b12631...` | Will Satoshi move any Bitcoin in 2025? | 0 | 1 | 0 | 1 |
| `fc4453f83b30fdad...` | Will China unban Bitcoin in 2025? | 0 | 1 | 0 | 1 |
| `ce733629b3b1bea0...` | Will a US ally get a nuke in 2025? | 0 | 1 | 0 | 1 |

---

## UNION View Validation

**pm_trades_with_external** integrity check:

| Metric | Count |
|--------|-------|
| pm_trades (CLOB only) | 38,945,566 |
| external_trades_raw | 46 |
| pm_trades_with_external (UNION) | 38,945,612 |

✅ **Row count validated:** 38,945,612 = 38,945,566 (CLOB) + 46 (external)

⚠️  **Duplicate trades detected** - Same trade appears in both CLOB and external sources

---

## For C1: Trusted Wallets and Markets

### Fully Backfilled Wallets

Wallets with status='done' in wallet_backfill_plan:

⚠️  No wallets marked as fully backfilled yet.

### Ghost Markets (External-Only)

Markets that exist ONLY in external sources:

```sql
-- Ghost markets query
SELECT DISTINCT condition_id, market_question
FROM external_trades_raw
WHERE condition_id NOT IN (
  SELECT DISTINCT condition_id FROM pm_trades WHERE data_source = 'clob_fills'
)
```

These 6 markets have **zero CLOB coverage** and rely entirely on external ingestion.

---

## Next Steps

1. **For C1:** Switch P&L views to `pm_trades_with_external`
2. **For C1:** Validate P&L calculations for fully backfilled wallets
3. **For C1:** Compare computed P&L against Dome baseline
4. **For C2:** Continue backfilling remaining pending wallets
5. **For C2:** Monitor for API errors or data quality issues

---

**Report Generated:** 2025-11-16T03:08:36.497Z
**C2 - External Data Ingestion Agent**
