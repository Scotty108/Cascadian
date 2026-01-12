# PnL Investigation Complete Findings

> **Date:** January 10-11, 2026
> **Status:** Critical bugs identified, fixes documented
> **Key Discovery:** Self-fill collapse at tx_hash level is WRONG

---

## Executive Summary

After extensive investigation across multiple PnL engine versions (V1-V44) and multiple pilot validations, we identified the complete set of requirements for accurate CLOB-based PnL calculation. **Critical bug found:** self-fill collapse was being done at transaction level, which deletes legitimate maker volume.

---

## Critical Bug: Self-Fill Collapse Level

### The Problem

We were collapsing self-fills at `transaction_hash` level:
```sql
-- WRONG: tx-level collapse
WHERE tx_hash NOT IN (SELECT tx_hash FROM self_fill_txs) OR role = 'taker'
```

This is **too aggressive** because a single `tx_hash` can include multiple fills across different markets.

### Evidence

Test wallet `0x83388040066f4d0b2723385b2c34727dcf4adcbc`:
- Raw cash flow: **-$2,145**
- With tx-level collapse: **-$57.91** (WRONG)
- Self-fills at tx_hash level: **3**
- Self-fills at event_id level: **0**

### The Fix

Self-fill detection must be per `event_id`:

```sql
CREATE TABLE pm_wallet_event_role_flags_v1 (
  wallet LowCardinality(String),
  event_id String,
  has_maker UInt8,
  has_taker UInt8,
  is_self_fill UInt8 MATERIALIZED (has_maker = 1 AND has_taker = 1)
) ORDER BY (wallet, event_id)
```

---

## Validated PnL Formula

```
PnL = Cash_flow + Long_wins - Short_losses + Unrealized_long - Unrealized_short
```

---

## Critical Discoveries

1. **Self-Fill Collapse Must Be Event-Level** - tx-level deletes legitimate maker volume
2. **Role Flags Only Cover Dec 2025+** - older trades have uncollapsed self-fills
3. **NegRisk Conversions Invisible** - only 0.3% wallets, but $2.37M error if present
4. **Position-Level Phantom Required** - wallet-level gates miss position phantoms
5. **MTM Essential** - open positions need mark-to-market

---

## Pilot Results

| Pilot | Pass Rate | Root Cause |
|-------|-----------|------------|
| 30-wallet stratified | 30% | Pre-Dec trades + tx-level collapse |
| 6 "clean" wallets | 0% | tx-level collapse bug |
| 50-wallet random | 24% | Phantom + NegRisk |

---

## Critical Pitfalls

1. **Self-fill at tx_hash level** - WRONG, use event_id
2. **ReplacingMergeTree for position state** - use SummingMergeTree
3. **pm_market_metadata duplicates** - dedupe with any()
4. **pm_trader_events_v2 duplicates** - GROUP BY event_id
5. **ClickHouse arrays 1-indexed** - use outcome_index + 1
6. **Correlated subqueries** - not supported in JOINs
7. **Nested aggregates** - not allowed, use subquery

---

## Required Gates

| Gate | Check | Purpose |
|------|-------|---------|
| Position-Level Phantom | sold <= bought * 1.01 | No phantom inventory |
| NegRisk Conversions | count = 0 | No invisible swaps |
| Event-Level Self-Fill | Applied in calc | Correct collapse |

---

## Key Tables

| Table | Status |
|-------|--------|
| pm_wallet_tx_role_flags_v1 | **DEPRECATED** (tx-level) |
| pm_wallet_event_role_flags_v1 | **NEW** (event-level) |

---

## Next Steps

1. Backfill event-level role flags full history
2. Re-run pilot with event-level collapse
3. Build accurate cohort with all 3 gates
4. Add MTM for open positions

---

**Version:** 2.0 | **Updated:** January 11, 2026

---

## CRITICAL UPDATE: CTF Data Gap (Jan 11, 2026)

### The Real Issue

The pilot showed 97% phantom positions NOT because CLOB-only is fundamentally flawed, but because **CTF data is 7 weeks behind**:

| Data Source | Latest Data |
|-------------|-------------|
| CLOB trades | Jan 11, 2026 |
| CTF splits/merges | Nov 25, 2025 |

### Evidence

Phantom position `6519c5ae...`:
- Wallet SOLD 3,748 NO tokens on Dec 17, 2025
- Never bought from CLOB
- Market resolved YES won `[1,0]`
- **CTF split happened Dec 17 but not in our data**

### Implication

Once CTF backfill is complete (Nov 25 - present):
1. Phantom positions become explainable
2. PnL calculation can include CTF events
3. Cohort size should increase dramatically

### Next Step

Backfill `pm_ctf_split_merge_expanded` from Nov 25, 2025 to present.

---

## UPDATE: CTF Backfill Complete (Jan 11, 2026)

### What We Did
- Rebuilt `pm_ctf_split_merge_expanded` table from `pm_ctf_events`
- Now have **177M rows** of CTF Split/Merge events up to Jan 11, 2026

### Remaining Gap
Some phantom positions STILL unexplained because tokens came from:
- **P2P ERC1155 transfers** (not indexed)
- **Contract-to-wallet transfers** (not indexed)
- **Other token flow mechanisms** we don't track

### Example: ETH Up/Down 15m Market
- Wallet `0x4687...` sold 3,748 NO tokens without buying from CLOB
- No CTF split found (even with current data)
- No NegRisk conversion found
- **Tokens came from an unindexed source**

### Token Flow Sources (Priority)

| Source | Table | Status |
|--------|-------|--------|
| CLOB trades | pm_trader_events_v3 | Current |
| CTF Split/Merge | pm_ctf_split_merge_expanded | Now current |
| NegRisk conversions | pm_neg_risk_conversions_v1 | Current |
| P2P ERC1155 transfers | NOT INDEXED | GAP |
| Contract interactions | NOT INDEXED | GAP |

### Next Step
To achieve complete PnL accuracy, need to index ERC1155 `TransferSingle`/`TransferBatch` events to track P2P token flows.
