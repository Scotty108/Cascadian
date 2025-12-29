# PnL Engine TDD Validation Plan

**Status:** ACTIVE VALIDATION ROADMAP
**Date:** 2025-11-24
**Terminal:** Claude 3
**Priority:** Engine validation BEFORE any new builds

---

## Executive Summary

This document provides a concrete, step-by-step Test-Driven Development (TDD) validation plan for the Polymarket PnL engine. The goal is to **validate correctness first** with existing data before chasing data gaps.

**Key Principle:** Stop calling anything "canonical" until it passes these tests.

---

## Part 1: Canonical State Model

### 1.1 Core Entities

| Entity | Description | Primary Key |
|--------|-------------|-------------|
| **Wallet** | Trader address | `wallet_address` (lowercase, 0x-prefixed) |
| **Condition** | Binary market outcome | `condition_id` (64-char hex, lowercase, no 0x) |
| **Token** | ERC1155 position token | `token_id_dec` (decimal string) |
| **Outcome** | Yes/No position (0 or 1) | `outcome_index` (0 or 1) |
| **Position** | Wallet's holding in one outcome | `(wallet, condition_id, outcome_index)` |

### 1.2 Field Mappings to Existing Tables

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ CANONICAL FIELD          │ CLICKHOUSE SOURCE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│ wallet_address           │ pm_trader_events_v2.trader_wallet               │
│                          │ pm_ctf_events.user_address                      │
├─────────────────────────────────────────────────────────────────────────────┤
│ condition_id             │ pm_token_to_condition_map_v3.condition_id       │
│                          │ pm_ctf_events.condition_id                      │
│                          │ pm_condition_resolutions.condition_id           │
├─────────────────────────────────────────────────────────────────────────────┤
│ token_id                 │ pm_trader_events_v2.token_id                    │
│                          │ pm_token_to_condition_map_v3.token_id_dec       │
├─────────────────────────────────────────────────────────────────────────────┤
│ outcome_index            │ pm_token_to_condition_map_v3.outcome_index      │
│                          │ (0=No, 1=Yes for most markets)                  │
├─────────────────────────────────────────────────────────────────────────────┤
│ usdc_amount              │ pm_trader_events_v2.usdc_amount                 │
│                          │ (already in USDC, not wei)                      │
├─────────────────────────────────────────────────────────────────────────────┤
│ shares                   │ pm_trader_events_v2.token_amount                │
│                          │ (already normalized, not raw)                   │
├─────────────────────────────────────────────────────────────────────────────┤
│ fee                      │ pm_trader_events_v2.fee_amount                  │
├─────────────────────────────────────────────────────────────────────────────┤
│ resolved_price           │ Derived from pm_condition_resolutions:          │
│                          │ arrayElement(payout_numerators, outcome_idx+1)  │
│                          │ / payout_denominator                            │
├─────────────────────────────────────────────────────────────────────────────┤
│ is_resolved              │ EXISTS in pm_condition_resolutions              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Position State Model

For each `(wallet, condition_id, outcome_index)` position, we track:

```typescript
interface Position {
  wallet_address: string;      // 0x-prefixed lowercase
  condition_id: string;        // 64-char hex, no 0x
  outcome_index: number;       // 0 or 1

  // Accumulated from trades
  total_shares_bought: number; // sum of BUY shares
  total_shares_sold: number;   // sum of SELL shares
  total_cost_basis: number;    // USDC spent buying (+ fees)
  total_sale_proceeds: number; // USDC received selling (- fees)

  // Derived
  net_shares: number;          // bought - sold
  net_cash_flow: number;       // proceeds - cost_basis (negative = spent)

  // Resolution (if resolved)
  resolution_price: number;    // 0.0 or 1.0
  resolution_value: number;    // net_shares × resolution_price
  realized_pnl: number;        // resolution_value + net_cash_flow
}
```

### 1.4 Data Sources Inventory

| Table | Rows | Purpose | Status |
|-------|------|---------|--------|
| `pm_trader_events_v2` | 274.6M | CLOB trades | ✅ Primary source |
| `pm_ctf_events` | 15.8M | CTF events (PayoutRedemption only) | ⚠️ Missing Split/Merge |
| `pm_condition_resolutions` | 184.7K | Resolution payouts | ✅ Complete |
| `pm_token_to_condition_map_v3` | ~282K | Token→Condition mapping | ✅ Complete |

---

## Part 2: Event Rules

### 2.1 Trade Events (pm_trader_events_v2)

**Source:** CLOB order fills

**Event Types:**
| role | side | Effect |
|------|------|--------|
| maker/taker | BUY | +shares, -USDC, -fee |
| maker/taker | SELL | -shares, +USDC, -fee |

**Canonical Transformation:**

```sql
-- Cash delta (negative = money out, positive = money in)
cash_delta_usdc = CASE
    WHEN side = 'BUY'  THEN -(usdc_amount + fee_amount)  -- spent money
    WHEN side = 'SELL' THEN +(usdc_amount - fee_amount)  -- received money
END

-- Shares delta (positive = gained shares, negative = lost shares)
shares_delta = CASE
    WHEN side = 'BUY'  THEN +token_amount
    WHEN side = 'SELL' THEN -token_amount
END
```

**Validation Check:**
```sql
-- Every trade should have: usdc_amount > 0, token_amount > 0
SELECT count(*) as invalid_trades
FROM pm_trader_events_v2
WHERE usdc_amount <= 0 OR token_amount <= 0;
-- Expected: 0
```

### 2.2 PositionSplit Events

**Source:** CTF contract (NOT currently in pm_ctf_events)

**Effect:** Collateral → Equal positions in all outcomes
- USDC out: `amount`
- Shares in: `+amount` for EACH outcome

**Example:** Split 100 USDC → Get 100 Yes shares AND 100 No shares

**Current Status:** ⚠️ NOT CAPTURED - treat as data quality gap

### 2.3 PositionsMerge Events

**Source:** CTF contract (NOT currently in pm_ctf_events)

**Effect:** Equal positions in all outcomes → Collateral
- Shares out: `-amount` from EACH outcome
- USDC in: `+amount`

**Example:** Merge 100 Yes + 100 No → Get 100 USDC back

**Current Status:** ⚠️ NOT CAPTURED - treat as data quality gap

### 2.4 PayoutRedemption Events

**Source:** `pm_ctf_events` where `event_type = 'PayoutRedemption'`

**Effect:** Winning shares → USDC at resolution price
- Shares out: `-shares_redeemed` (winning outcome only)
- USDC in: `+payout_amount`

**Field Mapping:**
```sql
-- In pm_ctf_events:
-- amount_or_payout contains the USDC payout amount
-- partition_index_sets indicates which outcome (parse carefully!)
```

**CRITICAL BUG FOUND:** The V2/V3/V4 views DOUBLE-COUNT redemptions:
1. PayoutRedemption is included in `vw_pm_ledger_v2` trade_cash
2. Then resolution_cash recalculates: `final_shares × resolved_price`
3. This counts the payout twice!

**Correct Approach:** Use trades-only ledger (`vw_pm_ledger`) for trade_cash, then add resolution value for unredeemed shares only.

### 2.5 ConditionResolution Events

**Source:** `pm_condition_resolutions`

**Effect:** Sets the payout for each outcome
- `payout_numerators`: Array like `[0, 1]` or `[1, 0]`
- `payout_denominator`: Usually `1`
- Resolution price = `numerator[outcome_index] / denominator`

**Validation:**
```sql
-- All resolutions should have exactly 2 outcomes, denominator = 1
SELECT
    condition_id,
    payout_numerators,
    payout_denominator
FROM pm_condition_resolutions
WHERE payout_denominator != '1'
   OR length(splitByChar(',', payout_numerators)) != 2
LIMIT 10;
```

---

## Part 3: Validation Test Suite

### Test Wallets

| Wallet | Name | Why Selected |
|--------|------|--------------|
| `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b` | Egg Wallet | Known UI reference, 1,573 trades |
| TBD | High Volume | Pick from top traders |
| TBD | Simple Case | Few trades, single market |
| TBD | Loss Only | Expected negative PnL |
| TBD | Split/Merge User | To flag data gaps |

---

## Step A: Single-Market Sanity Check

**Goal:** Verify arithmetic is correct for ONE market with known outcome

### A.1 Pick Test Market

```sql
-- Find a simple resolved market with egg wallet activity
SELECT
    m.condition_id,
    m.question,
    count(*) as trade_count,
    sum(CASE WHEN t.side = 'BUY' THEN t.usdc_amount ELSE 0 END) as total_bought,
    sum(CASE WHEN t.side = 'SELL' THEN t.usdc_amount ELSE 0 END) as total_sold
FROM pm_trader_events_v2 t
JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
WHERE t.trader_wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
GROUP BY m.condition_id, m.question
HAVING count(*) BETWEEN 5 AND 20  -- Not too simple, not too complex
ORDER BY total_bought DESC
LIMIT 5;
```

### A.2 Manual Calculation Template

For the selected market, manually compute:

```sql
-- Step 1: Get all trades for this wallet + market
WITH trades AS (
    SELECT
        t.event_id,
        t.trade_time,
        t.side,
        m.outcome_index,
        t.usdc_amount,
        t.token_amount,
        t.fee_amount,
        -- Directional values
        CASE WHEN t.side = 'BUY'
             THEN -(t.usdc_amount + t.fee_amount)
             ELSE +(t.usdc_amount - t.fee_amount)
        END as cash_delta,
        CASE WHEN t.side = 'BUY'
             THEN +t.token_amount
             ELSE -t.token_amount
        END as shares_delta
    FROM pm_trader_events_v2 t
    JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
    WHERE t.trader_wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
      AND m.condition_id = '<CONDITION_ID>'
    ORDER BY t.trade_time
)
SELECT * FROM trades;

-- Step 2: Aggregate by outcome
WITH trades AS (
    -- ... same as above
),
by_outcome AS (
    SELECT
        outcome_index,
        sum(cash_delta) as total_cash,
        sum(shares_delta) as final_shares,
        sum(CASE WHEN shares_delta > 0 THEN shares_delta ELSE 0 END) as bought,
        sum(CASE WHEN shares_delta < 0 THEN -shares_delta ELSE 0 END) as sold
    FROM trades
    GROUP BY outcome_index
)
SELECT * FROM by_outcome;

-- Step 3: Get resolution
SELECT
    condition_id,
    payout_numerators,
    payout_denominator
FROM pm_condition_resolutions
WHERE condition_id = '<CONDITION_ID>';

-- Step 4: Calculate PnL manually
-- resolved_price[outcome_0] = numerators[0] / denominator
-- resolved_price[outcome_1] = numerators[1] / denominator
-- resolution_value = sum(final_shares[i] × resolved_price[i])
-- realized_pnl = resolution_value + total_cash
```

### A.3 Validation Criteria

| Check | Query | Expected |
|-------|-------|----------|
| Trade count matches | COUNT(*) | Matches row count from A.1 |
| No negative shares held | final_shares per outcome | >= 0 for resolved markets |
| PnL sign correct | If bought winner at < 1.0 | Positive PnL |
| Manual vs View | Compare to vw_pm_realized_pnl_v5 | Match within $0.01 |

---

## Step B: Single-Wallet Reconciliation

**Goal:** Validate ALL markets for egg wallet against UI

### B.1 Aggregate Wallet PnL

```sql
-- Our calculated total (using trades-only approach)
WITH per_outcome AS (
    SELECT
        t.trader_wallet as wallet_address,
        m.condition_id,
        m.outcome_index,
        sum(CASE WHEN t.side = 'BUY'
                 THEN -(t.usdc_amount + t.fee_amount)
                 ELSE +(t.usdc_amount - t.fee_amount) END) as cash_delta,
        sum(CASE WHEN t.side = 'BUY'
                 THEN +t.token_amount
                 ELSE -t.token_amount END) as final_shares
    FROM pm_trader_events_v2 t
    JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
    WHERE t.trader_wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
    GROUP BY t.trader_wallet, m.condition_id, m.outcome_index
),
with_resolution AS (
    SELECT
        p.*,
        r.payout_numerators,
        r.payout_denominator,
        r.condition_id IS NOT NULL as is_resolved,
        -- Parse resolution price (array is 1-indexed in ClickHouse)
        CASE WHEN r.condition_id IS NOT NULL
             THEN toFloat64(splitByChar(',', replaceAll(replaceAll(r.payout_numerators, '[', ''), ']', ''))[p.outcome_index + 1])
                  / toFloat64(r.payout_denominator)
             ELSE 0
        END as resolved_price
    FROM per_outcome p
    LEFT JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id
)
SELECT
    condition_id,
    is_resolved,
    sum(cash_delta) as trade_cash,
    sum(final_shares * resolved_price) as resolution_value,
    sum(cash_delta) + sum(final_shares * resolved_price) as realized_pnl
FROM with_resolution
WHERE is_resolved = 1  -- Only resolved markets for now
GROUP BY condition_id, is_resolved
ORDER BY realized_pnl DESC;
```

### B.2 Compare to UI

**UI Reference Data (from user):**

| Market | UI PnL | Our PnL | Gap |
|--------|--------|---------|-----|
| Below $4.50 May | $41,289.47 | $26,187.88 | -$15,101.59 (36%) |
| More than $6 March | $25,528.83 | $0.00 | -$25,528.83 (100%) |
| $3.25-3.50 August | $5,925.46 | $6,946.99 | +$1,021.53 (17%) |
| $3.25-3.50 July | $5,637.10 | $9,671.77 | +$4,034.67 (71%) |

### B.3 Categorize Discrepancies

```sql
-- For each market with discrepancy, run:
-- 1. Trade count check
SELECT
    m.condition_id,
    m.question,
    count(*) as our_trade_count
FROM pm_trader_events_v2 t
JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
WHERE t.trader_wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
  AND m.condition_id = '<CONDITION_ID>'
GROUP BY m.condition_id, m.question;

-- 2. Check for CTF events (Split/Merge/Redemption)
SELECT event_type, count(*)
FROM pm_ctf_events
WHERE user_address = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
  AND condition_id = '<CONDITION_ID>'
GROUP BY event_type;
```

### B.4 Data Quality Flags

For each discrepancy, assign a flag:

| Flag | Meaning | Action |
|------|---------|--------|
| `MISSING_TRADES` | Zero trades but should have some | Backfill needed |
| `PARTIAL_TRADES` | Some trades, but UI shows more | Backfill needed (AMM?) |
| `CALC_ERROR` | Trades match but PnL differs | Debug calculation |
| `OVER_REPORTED` | Our PnL > UI PnL | Check for double-count |
| `CTF_GAP` | Missing Split/Merge events | Flag, exclude from validation |

---

## Step C: Condition-Level Zero-Sum Test

**Goal:** For any resolved condition, sum of all wallet PnLs should equal negative total fees

### C.1 Theory

In a binary market:
- All USDC comes from traders (zero-sum game)
- **Polymarket has ZERO trading fees** (confirmed)
- Therefore: `SUM(all_wallet_pnl) = 0` (perfect zero-sum)

### C.2 Validation Query

```sql
-- Pick a resolved condition with good coverage
WITH condition_pnl AS (
    SELECT
        t.trader_wallet,
        m.condition_id,
        m.outcome_index,
        sum(CASE WHEN t.side = 'BUY'
                 THEN -(t.usdc_amount + t.fee_amount)
                 ELSE +(t.usdc_amount - t.fee_amount) END) as cash_delta,
        sum(CASE WHEN t.side = 'BUY'
                 THEN +t.token_amount
                 ELSE -t.token_amount END) as final_shares,
        sum(t.fee_amount) as fees_paid
    FROM pm_trader_events_v2 t
    JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
    WHERE m.condition_id = '<TEST_CONDITION_ID>'
    GROUP BY t.trader_wallet, m.condition_id, m.outcome_index
),
with_resolution AS (
    SELECT
        c.*,
        toFloat64(splitByChar(',', replaceAll(replaceAll(r.payout_numerators, '[', ''), ']', ''))[c.outcome_index + 1])
            / toFloat64(r.payout_denominator) as resolved_price
    FROM condition_pnl c
    JOIN pm_condition_resolutions r ON c.condition_id = r.condition_id
),
wallet_pnl AS (
    SELECT
        trader_wallet,
        sum(cash_delta) + sum(final_shares * resolved_price) as realized_pnl,
        sum(fees_paid) as total_fees
    FROM with_resolution
    GROUP BY trader_wallet
)
SELECT
    sum(realized_pnl) as total_pnl_all_wallets,
    sum(total_fees) as total_fees_all_wallets,
    sum(realized_pnl) + sum(total_fees) as should_be_zero
FROM wallet_pnl;

-- Expected: should_be_zero ≈ 0 (within rounding tolerance)
```

### C.3 Tolerance

- Accept if `abs(sum_pnl) < $1.00` for small markets
- Accept if `abs(sum_pnl) / total_volume < 0.001` (0.1%)
- **Note:** Polymarket has zero fees, so we expect exact zero-sum

---

## Step D: External Oracle Comparison

**Goal:** Use UI as ground truth for wallet-level validation

### D.1 Protocol

1. Select 3-5 test wallets
2. For EACH wallet, record UI totals:
   - Total closed position PnL
   - Per-market breakdown (top 10)
3. Compare to our calculations
4. Categorize gaps per Step B.4

### D.2 Test Wallet Selection Query

```sql
-- Find wallets with variety of outcomes
SELECT
    trader_wallet,
    count(DISTINCT m.condition_id) as markets,
    count(*) as trades,
    sum(t.usdc_amount) as volume
FROM pm_trader_events_v2 t
JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
GROUP BY trader_wallet
HAVING markets BETWEEN 10 AND 100  -- Manageable size
   AND trades BETWEEN 100 AND 5000
ORDER BY volume DESC
LIMIT 20;
```

### D.3 Acceptance Criteria

| Metric | Target |
|--------|--------|
| Wallet-level PnL | Within 5% of UI OR gap explained by known data issues |
| Per-market PnL | 80% of markets within 1% |
| Flagged markets | All gaps have assigned data quality flag |

---

## Step E: Edge Case Catalog

### E.1 Known Edge Cases

| Case | Description | Expected Behavior |
|------|-------------|-------------------|
| Unresolved market | Condition not in resolutions | PnL = 0, flag `UNREALIZED` |
| Zero trades | Token mapped but no trades | PnL = 0, flag `NO_TRADES` |
| Negative final shares | Sold more than bought | Flag `NEGATIVE_POSITION` - investigate |
| Multiple resolutions | Same condition resolved twice | Use latest by block_number |
| Missing token mapping | Trade exists but no mapping | Flag `UNMAPPED_TOKEN` |
| AMM-only trades | No CLOB trades, only AMM | Flag `AMM_ONLY` |

### E.2 Edge Case Detection Queries

```sql
-- Negative final shares (should not happen)
WITH positions AS (
    SELECT
        t.trader_wallet,
        m.condition_id,
        m.outcome_index,
        sum(CASE WHEN t.side = 'BUY' THEN t.token_amount ELSE -t.token_amount END) as final_shares
    FROM pm_trader_events_v2 t
    JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
    GROUP BY t.trader_wallet, m.condition_id, m.outcome_index
)
SELECT *
FROM positions
WHERE final_shares < -0.01  -- Allow small rounding
LIMIT 10;

-- Unmapped tokens
SELECT
    t.token_id,
    count(*) as trades,
    sum(t.usdc_amount) as volume
FROM pm_trader_events_v2 t
LEFT JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
WHERE m.condition_id IS NULL
GROUP BY t.token_id
ORDER BY volume DESC
LIMIT 10;
```

---

## Part 4: External Validation Function

### 4.1 Purpose

A lightweight TypeScript function to recompute PnL outside ClickHouse for spot-checking.

### 4.2 Function Signature

```typescript
// File: lib/pnl/validate.ts

interface Trade {
  event_id: string;
  trade_time: Date;
  side: 'BUY' | 'SELL';
  outcome_index: number;
  usdc_amount: number;
  token_amount: number;
  fee_amount: number;
}

interface Resolution {
  payout_numerators: number[];  // e.g., [0, 1] or [1, 0]
  payout_denominator: number;   // usually 1
}

interface PositionSummary {
  outcome_index: number;
  total_cash_delta: number;     // USDC in/out
  final_shares: number;         // net shares held
  resolved_price: number;       // 0 or 1
  resolution_value: number;     // shares × price
  realized_pnl: number;         // resolution_value + cash_delta
}

interface ValidationResult {
  condition_id: string;
  wallet_address: string;
  positions: PositionSummary[];
  total_realized_pnl: number;
  trade_count: number;
  data_quality_flags: string[];
}

/**
 * Recomputes PnL for a single wallet + condition from raw trades.
 * Used for spot-checking ClickHouse calculations.
 */
export function computePnL(
  trades: Trade[],
  resolution: Resolution | null
): ValidationResult {
  // Group trades by outcome
  const byOutcome = new Map<number, { cash: number; shares: number }>();

  for (const trade of trades) {
    const current = byOutcome.get(trade.outcome_index) || { cash: 0, shares: 0 };

    if (trade.side === 'BUY') {
      current.cash -= (trade.usdc_amount + trade.fee_amount);
      current.shares += trade.token_amount;
    } else {
      current.cash += (trade.usdc_amount - trade.fee_amount);
      current.shares -= trade.token_amount;
    }

    byOutcome.set(trade.outcome_index, current);
  }

  // Calculate resolution values
  const positions: PositionSummary[] = [];
  let totalPnL = 0;
  const flags: string[] = [];

  for (const [outcome, pos] of byOutcome) {
    const resolvedPrice = resolution
      ? resolution.payout_numerators[outcome] / resolution.payout_denominator
      : 0;

    const resolutionValue = pos.shares * resolvedPrice;
    const realizedPnL = resolutionValue + pos.cash;

    positions.push({
      outcome_index: outcome,
      total_cash_delta: pos.cash,
      final_shares: pos.shares,
      resolved_price: resolvedPrice,
      resolution_value: resolutionValue,
      realized_pnl: realizedPnL
    });

    totalPnL += realizedPnL;

    // Flag edge cases
    if (pos.shares < -0.01) flags.push('NEGATIVE_POSITION');
  }

  if (!resolution) flags.push('UNREALIZED');
  if (trades.length === 0) flags.push('NO_TRADES');

  return {
    condition_id: '', // filled by caller
    wallet_address: '', // filled by caller
    positions,
    total_realized_pnl: totalPnL,
    trade_count: trades.length,
    data_quality_flags: flags
  };
}

/**
 * Fetches trades from ClickHouse and validates against expected PnL.
 */
export async function validateMarketPnL(
  wallet: string,
  conditionId: string,
  expectedPnL: number
): Promise<{
  computed: number;
  expected: number;
  difference: number;
  percentDiff: number;
  isValid: boolean;
  flags: string[];
}> {
  // Implementation: fetch trades, resolution, run computePnL
  // Compare result to expectedPnL
  // ...
}
```

### 4.3 Usage

```typescript
// Example: Validate egg wallet's "$4.50 May" market
const result = await validateMarketPnL(
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  'ee3a389d0c1345900a200d0d11d241bd30bc05a6c761d69b741a967bf98830d2',
  41289.47  // UI expected value
);

console.log(result);
// {
//   computed: 26187.88,
//   expected: 41289.47,
//   difference: -15101.59,
//   percentDiff: -36.6,
//   isValid: false,
//   flags: ['PARTIAL_TRADES']
// }
```

---

## Part 5: Validation Sequence

### Phase 1: Foundation (Day 1)

- [ ] **1.1** Run Step A on ONE simple market
- [ ] **1.2** Verify manual calculation matches
- [ ] **1.3** Create validation function stub

### Phase 2: Egg Wallet Deep Dive (Day 2)

- [ ] **2.1** Run Step B full wallet reconciliation
- [ ] **2.2** Categorize all 4 egg market discrepancies
- [ ] **2.3** Document exact trade count vs UI

### Phase 3: Zero-Sum Validation (Day 3)

- [ ] **3.1** Pick 3 resolved conditions
- [ ] **3.2** Run Step C zero-sum test
- [ ] **3.3** Document any failures

### Phase 4: Multi-Wallet Validation (Day 4-5)

- [ ] **4.1** Select 3-5 additional wallets
- [ ] **4.2** Run Step D for each
- [ ] **4.3** Aggregate results

### Phase 5: Edge Cases & Documentation (Day 6)

- [ ] **5.1** Run Step E edge case detection
- [ ] **5.2** Document all data quality flags
- [ ] **5.3** Create final validation report

---

## Part 6: Success Criteria

### Before Calling Anything "Canonical"

| Criteria | Threshold |
|----------|-----------|
| Step A passes | 100% (must match manual calc) |
| Step C zero-sum | Within 0.1% of expected |
| Step D wallet match | 80% of markets within 1% OR flagged |
| All discrepancies | Have assigned data quality flag |

### Data Quality Acceptance

| Issue | Action |
|-------|--------|
| `MISSING_TRADES` (100% gap) | Flag, exclude from PnL totals |
| `PARTIAL_TRADES` (>20% gap) | Flag, show as "estimated" |
| `PARTIAL_TRADES` (<20% gap) | Accept with footnote |
| `CALC_ERROR` | Must fix before proceeding |
| `OVER_REPORTED` | Must fix before proceeding |

---

## Appendix: Quick Reference Queries

### Get Egg Wallet Resolved Markets

```sql
SELECT DISTINCT
    m.condition_id,
    m.question,
    r.payout_numerators,
    count(*) as trades
FROM pm_trader_events_v2 t
JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
WHERE t.trader_wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
GROUP BY m.condition_id, m.question, r.payout_numerators
ORDER BY trades DESC;
```

### Get Market PnL Breakdown

```sql
-- Replace <CONDITION_ID> with target
WITH trades AS (
    SELECT
        t.event_id,
        m.outcome_index,
        t.side,
        t.usdc_amount,
        t.token_amount,
        t.fee_amount
    FROM pm_trader_events_v2 t
    JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
    WHERE t.trader_wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
      AND m.condition_id = '<CONDITION_ID>'
)
SELECT
    outcome_index,
    count(*) as trade_count,
    sum(CASE WHEN side='BUY' THEN usdc_amount ELSE 0 END) as bought_usdc,
    sum(CASE WHEN side='SELL' THEN usdc_amount ELSE 0 END) as sold_usdc,
    sum(CASE WHEN side='BUY' THEN token_amount ELSE 0 END) as bought_shares,
    sum(CASE WHEN side='SELL' THEN token_amount ELSE 0 END) as sold_shares
FROM trades
GROUP BY outcome_index;
```

### Check Token Mapping Coverage

```sql
SELECT
    countIf(m.condition_id IS NOT NULL) as mapped,
    countIf(m.condition_id IS NULL) as unmapped,
    count(*) as total
FROM pm_trader_events_v2 t
LEFT JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
WHERE t.trader_wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
```

---

**Terminal:** Claude 3
**Date:** 2025-11-24
**Status:** VALIDATION ROADMAP READY
