# SCOPE_AUDIT.md

## Database Coverage Summary

**Data Window:** 2022-12-18 to 2025-10-31 (1,048 days)

**Unique Wallets Tracked:** 996,334

**Target Snapshot:** 2024-10-31 (Unix: 1730419199)

---

## Table Breakdown

### trades_raw (Source Data - 159M Trades)
- **Min Date:** 2022-12-18
- **Max Date:** 2025-10-31
- **Distinct Wallets:** 996,334
- **Total Trades:** 159,574,259

### outcome_positions_v2 (Snapshot Table - No Timestamps)
- **Distinct Wallets:** 868,985
- **Total Positions:** 9,182,900
- **Note:** This is a snapshot table representing final settled positions

### trade_cashflows_v3 (Snapshot Table - No Timestamps)
- **Distinct Wallets:** 868,985
- **Total Cashflows:** 69,119,636
- **Note:** This is a snapshot table representing final cash flows

### winning_index (Resolution Data)
- **Distinct Markets:** 137,391
- **Total Resolutions:** 137,391
- **Note:** Maps market outcomes to winning indexes

---

## Gate Check: Data Recency

**Status:** ✅ PASS

**Result:** Data is current through 2024-10-31 or later

**Details:**
- Target snapshot: 2025-10-31 23:59:59 UTC (Unix: 1730419199)
- Latest trade timestamp: 2025-10-31 (Unix: 1761904838)
- Gate requirement: max_ts >= target snapshot

---

## Coverage Estimate

**Estimated Market Coverage:** ~664.2% of active Polymarket traders

**Assumptions:**
- Polymarket has approximately 100,000-200,000 active traders (public estimates)
- Our database tracks 996,334 unique wallets
- Coverage is based on wallet count, not trade volume

---

## Critical Finding

**outcome_positions_v2 and trade_cashflows_v3 are SNAPSHOT tables:**
- These tables do NOT contain timestamp fields
- They represent final settled positions and cashflows (point-in-time data)
- Date range derived from pm_trades (source table with timestamps)

**Data Architecture:**
- trades_raw: Raw trade data with timestamps (source of truth - 159M trades)
- outcome_positions_v2: Aggregated final positions per wallet/outcome
- trade_cashflows_v3: Aggregated final cashflows per wallet/outcome
- winning_index: Market resolution outcomes

---

## Summary

Data covers **996,334 unique wallets** from **2022-12-18** to **2025-10-31**.

✅ Database is current through target snapshot date.

**Total Activity:**
- 159,574,259 trades
- 9,182,900 outcome positions
- 69,119,636 cashflow records
- 137,391 resolved markets

---

*Generated: 2025-11-07T06:24:28.745Z*
*Query source: trades_raw (timestamps), outcome_positions_v2, trade_cashflows_v3, winning_index*
