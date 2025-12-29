# PnL V1 Step 1: Quick Reference Summary

**Status:** ✅ COMPLETE
**Created:** 2025-11-24
**Terminal:** Claude 3

---

## What Was Built

### View Created: `vw_pm_ledger`

**Purpose:** Canonical trade ledger that normalizes all trades from wallet perspective

**Key Features:**
- ✅ Scales micro-USDC and micro-shares by 1e6 to decimal
- ✅ Calculates signed deltas: buy = +shares/-cash, sell = -shares/+cash
- ✅ Joins `pm_trader_events_v2` with `pm_token_to_condition_map_v3`
- ✅ Includes role, fees, block time, transaction hash

**Rows:** 269,790,594 trade events

---

## View Schema

```sql
CREATE OR REPLACE VIEW vw_pm_ledger AS
SELECT
    lower(t.trader_wallet)          AS wallet_address,
    m.condition_id,
    m.outcome_index,
    toString(t.token_id)            AS token_id,
    t.trade_time                    AS block_time,
    t.block_number,
    t.transaction_hash              AS tx_hash,
    lower(t.role)                   AS role,
    lower(t.side)                   AS side_raw,
    t.token_amount / 1e6            AS shares,        -- scaled
    t.usdc_amount  / 1e6            AS usdc,          -- scaled
    t.fee_amount   / 1e6            AS fee,           -- scaled
    CASE
        WHEN lower(t.side) = 'buy'  THEN  t.token_amount / 1e6
        WHEN lower(t.side) = 'sell' THEN -t.token_amount / 1e6
    END AS shares_delta,
    CASE
        WHEN lower(t.side) = 'buy'  THEN - (t.usdc_amount + t.fee_amount) / 1e6
        WHEN lower(t.side) = 'sell' THEN   (t.usdc_amount - t.fee_amount) / 1e6
    END AS cash_delta_usdc,
    t.fee_amount / 1e6              AS fee_usdc,
    'TRADE'                         AS event_type
FROM pm_trader_events_v2 t
INNER JOIN pm_token_to_condition_map_v3 m
    ON toString(t.token_id) = toString(m.token_id_dec)
```

---

## Validation Results

| Test | Status | Details |
|------|--------|---------|
| **Sign Convention** | ✅ PASS | 100% correct buy/sell signs |
| **Scaling** | ✅ PASS | All values in decimal ranges |
| **Join Integrity** | ⚠️ 98.52% | 1.48% join loss acceptable |
| **Cash Flow** | ✅ PASS | 100% consistent |
| **Fees** | ✅ PASS | Makers 0%, takers correct |
| **Balance Tracking** | ✅ PASS | Positions tracked correctly |

---

## Key Findings

### Trade Volume
- **Total trades:** 269,790,594
- **Buy/Sell split:** ~50/50 (134.9M each)
- **Top market:** 10.2M trades (condition_id: dd22472e55...)

### Fee Analysis
- **Makers:** 100% zero fees (134.9M trades)
- **Takers:** 99.99% have fees recorded
- **Avg taker fee:** $0.000461
- **Max fee:** $1,338.00

### Position Status
- **Open positions:** 91.4% (expected - markets not resolved)
- **Fully closed:** 6.7%
- **Nearly closed:** 1.8%

### Data Quality
- **Sign correctness:** >99.9999%
- **Scaling accuracy:** 100%
- **Cash flow consistency:** 100%

---

## Example Queries

### Get wallet trades for a market
```sql
SELECT *
FROM vw_pm_ledger
WHERE condition_id = 'dd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917'
  AND wallet_address = lower('0xc5d563a36ae78145c45a50134d48a1215220f80a')
ORDER BY block_time, tx_hash
LIMIT 100
```

### Calculate net position
```sql
SELECT
    wallet_address,
    token_id,
    sum(shares_delta) AS net_shares,
    sum(cash_delta_usdc) AS net_cash,
    count() AS trade_count
FROM vw_pm_ledger
WHERE condition_id = 'YOUR_CONDITION_ID'
GROUP BY wallet_address, token_id
ORDER BY abs(net_shares) DESC
```

### Top markets by volume
```sql
SELECT
    condition_id,
    count() AS trade_count,
    sum(abs(usdc)) AS total_volume_usdc
FROM vw_pm_ledger
GROUP BY condition_id
ORDER BY trade_count DESC
LIMIT 20
```

---

## Scripts Available

### Creation
```bash
npx tsx scripts/create-pnl-ledger-v1.ts
```
Creates the view and runs basic sanity checks.

### Validation
```bash
npx tsx scripts/validate-pnl-ledger-v1.ts
```
Runs comprehensive validation tests (6 tests total).

Both scripts are **idempotent** - safe to re-run.

---

## Next Steps: Step 2

**Goal:** Add resolution events and calculate realized PnL

**Tasks:**
1. Query `pm_condition_resolutions` for resolved markets
2. Create synthetic "RESOLUTION" event rows with payouts
3. Build `vw_pm_realized_pnl_v1` combining trades + resolutions
4. Validate realized PnL calculations

**Data sources:**
- `vw_pm_ledger` (trades) ← **just built**
- `pm_condition_resolutions` (outcomes)
- `pm_token_to_condition_map_v3` (outcome index mapping)

**Estimated time:** 2-3 hours

---

## Files Created

1. **View:** `vw_pm_ledger` (in ClickHouse)
2. **Script:** `scripts/create-pnl-ledger-v1.ts`
3. **Script:** `scripts/validate-pnl-ledger-v1.ts`
4. **Report:** `docs/systems/database/PNL_V1_STEP1_VALIDATION_REPORT.md`
5. **Summary:** `docs/systems/database/PNL_V1_STEP1_SUMMARY.md` (this file)

---

## Important Notes

### Sign Convention (Wallet Perspective)
- **BUY:** shares go up (+), cash goes down (-)
- **SELL:** shares go down (-), cash goes up (+)

### Scaling
- All amounts in decimal USDC and shares (not micro-units)
- Original data: 1,000,000 micro = 1.0 decimal

### Fees
- Makers: always $0.00
- Takers: variable, typically < $1.00
- Fees are SUBTRACTED from proceeds (sell) or ADDED to cost (buy)

### Cash Delta Formula
```sql
-- Buy:  cash_delta = -(usdc + fee)  [money OUT of wallet]
-- Sell: cash_delta = (usdc - fee)   [money INTO wallet]
```

---

**Ready for Step 2:** ✅ Yes
**Validation Status:** ✅ PASS
**Blockers:** None

---

**Terminal:** Claude 3
**Date:** 2025-11-24
**Spec:** PNL_ENGINE_CANONICAL_SPEC.md v1.0
