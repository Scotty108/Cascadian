# PnL Engine Code Comparison: V13, V17, V18, V20, V22

**Date:** 2025-12-15
**Purpose:** Line-by-line comparison of fill selection, dedupe, and formula logic

---

## 1. Fill Selection Queries

### V13: CLOB Fills with CTF Events

```typescript
// FILE: lib/pnl/uiActivityEngineV13.ts, line 172-197

async function getClobTrades(wallet: string, negriskTokenDates?: Set<string>): Promise<LedgerEntry[]> {
  const query = `
    SELECT
      m.condition_id,
      m.outcome_index,
      m.category,
      fills.trade_time,
      fills.side,
      fills.qty_tokens,
      fills.price,
      fills.token_id
    FROM (
      SELECT
        any(token_id) as token_id,
        any(trade_time) as trade_time,
        any(side) as side,
        any(token_amount) / 1000000.0 as qty_tokens,
        CASE WHEN any(token_amount) > 0
          THEN any(usdc_amount) / any(token_amount)
          ELSE 0
        END as price
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
      GROUP BY event_id  -- ← DEDUPE HERE
    ) fills
    INNER JOIN pm_token_to_condition_map_v3 m ON fills.token_id = m.token_id_dec
  `;
}
```

**Key Points:**
- ✅ Dedupes via `GROUP BY event_id`
- ✅ Includes all roles (no `role` filter)
- ✅ Price calculated as `usdc_amount / token_amount` (includes fees)
- ❌ No unmapped trade filtering

---

### V17: Dedup Table with Paired Normalization

```typescript
// FILE: lib/pnl/uiActivityEngineV17.ts, line 144-159

async function loadPositionAggregates(wallet: string): Promise<PositionAgg[]> {
  const fillsQuery = `
    SELECT
      any(f.transaction_hash) as transaction_hash,
      any(f.token_id) as token_id,
      any(f.side) as side,
      any(f.token_amount) / 1000000.0 as tokens,
      any(f.usdc_amount) / 1000000.0 as usdc,
      any(m.condition_id) as condition_id,
      any(m.outcome_index) as outcome_index,
      COALESCE(any(m.category), 'Other') as category
    FROM pm_trader_events_dedup_v2_tbl f
    INNER JOIN pm_token_to_condition_map_v5 m ON f.token_id = m.token_id_dec
    WHERE lower(f.trader_wallet) = lower('${wallet}')
    GROUP BY f.event_id  -- ← STILL NEEDS DEDUPE (table has duplicates)
    ORDER BY transaction_hash, condition_id, outcome_index
  `;
}
```

**Paired-Outcome Normalization (TypeScript):**
```typescript
// FILE: lib/pnl/uiActivityEngineV17.ts, line 201-229

// Group by (tx_hash, condition_id)
const groups = new Map<string, Fill[]>();
for (const fill of typedFills) {
  const key = `${fill.transaction_hash}_${fill.condition_id}`;
  groups.get(key)!.push(fill);
}

// Detect and mark paired hedge legs
for (const [, groupFills] of groups) {
  const outcomes = new Set(groupFills.map((f) => f.outcome_index));
  if (!outcomes.has(0) || !outcomes.has(1) || groupFills.length < 2) {
    continue; // Not a paired-outcome group
  }

  const o0Fills = groupFills.filter((f) => f.outcome_index === 0);
  const o1Fills = groupFills.filter((f) => f.outcome_index === 1);

  // Check for paired pattern: opposite directions, matching amounts
  for (const o0 of o0Fills) {
    for (const o1 of o1Fills) {
      const oppositeDirection = o0.side !== o1.side;
      const amountMatch = Math.abs(o0.tokens - o1.tokens) <= 1.0; // ← EPSILON

      if (oppositeDirection && amountMatch) {
        // Mark the sell leg as hedge (to be dropped)
        if (o0.side === 'sell') {
          o0.isPairedHedgeLeg = true;
        } else {
          o1.isPairedHedgeLeg = true;
        }
        break;
      }
    }
  }
}

// Filter out hedge legs
const normalizedFills = typedFills.filter((f) => !f.isPairedHedgeLeg);
```

**Key Points:**
- ✅ Uses dedup table but still needs `GROUP BY event_id`
- ✅ Paired normalization prevents complete-set arbitrage double-counting
- ✅ Includes all roles
- ❌ No unmapped trade filtering

---

### V18: Maker-Only with Rounding

```typescript
// FILE: lib/pnl/uiActivityEngineV18.ts, line 139-166

async function loadPositionAggregates(wallet: string): Promise<PositionAgg[]> {
  const query = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(token_amount) / 1000000.0 as tokens,
        any(usdc_amount) / 1000000.0 as usdc
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
        AND role = 'maker'  -- ← 🔑 KEY DIFFERENCE: Maker only for UI parity
      GROUP BY event_id
    )
    SELECT
      m.condition_id,
      m.outcome_index,
      COALESCE(m.category, 'Other') as category,
      sum(CASE WHEN d.side = 'buy' THEN abs(d.tokens) ELSE 0 END) as buy_tokens,
      sum(CASE WHEN d.side = 'sell' THEN abs(d.tokens) ELSE 0 END) as sell_tokens,
      sum(CASE WHEN d.side = 'buy' THEN abs(d.usdc) ELSE 0 END) as buy_usdc,
      sum(CASE WHEN d.side = 'sell' THEN abs(d.usdc) ELSE 0 END) as sell_usdc,
      count() as trade_count
    FROM deduped d
    INNER JOIN pm_token_to_condition_map_v3 m ON d.token_id = m.token_id_dec
    GROUP BY m.condition_id, m.outcome_index, m.category
  `;
}
```

**Rounding Logic:**
```typescript
// FILE: lib/pnl/uiActivityEngineV18.ts, line 257-260

if (isResolved && resolution_price !== null) {
  // Realized PnL = cash_flow + (final_shares × resolution_price)
  // Round to cents for UI parity (John at Goldsky: UI rounds prices to cents)
  pos_realized_pnl = Math.round((trade_cash_flow + final_shares * resolution_price) * 100) / 100;
}
```

**Key Points:**
- 🔑 **Maker-only filter** (`role = 'maker'`)
- ✅ Per-position rounding to cents
- ✅ Aggregates directly in SQL
- ❌ No unmapped trade filtering
- ❌ No paired normalization

---

### V19: Unified Ledger v6 (CLOB-Only)

```typescript
// FILE: lib/pnl/uiActivityEngineV19.ts, line 114-148

async function loadPositionAggregates(wallet: string): Promise<PositionAgg[]> {
  const query = `
    WITH ledger_agg AS (
      SELECT
        condition_id,
        outcome_index,
        sum(usdc_delta) AS cash_flow,
        sum(token_delta) AS final_tokens,
        any(payout_norm) AS resolution_price,
        count() as trade_count
      FROM pm_unified_ledger_v6
      WHERE lower(wallet_address) = lower('${wallet}')
        AND source_type = 'CLOB'
        AND condition_id IS NOT NULL
        AND condition_id != ''  -- ← 🔑 EXCLUDE UNMAPPED TRADES
      GROUP BY condition_id, outcome_index
    )
    SELECT
      l.condition_id,
      l.outcome_index,
      COALESCE(m.category, 'Other') as category,
      l.cash_flow,
      l.final_tokens,
      l.resolution_price,
      l.trade_count
    FROM ledger_agg l
    LEFT JOIN (
      SELECT DISTINCT condition_id, category
      FROM pm_token_to_condition_map_v3
      WHERE category IS NOT NULL
    ) m ON l.condition_id = m.condition_id
  `;
}
```

**Key Points:**
- ✅ Unified ledger (no manual dedupe needed)
- ✅ **Filters out unmapped trades** (`condition_id IS NOT NULL`)
- ✅ Simple aggregation (`sum(usdc_delta)`, `sum(token_delta)`)
- ❌ CLOB-only (no CTF events)

---

### V20: Unified Ledger v7 - CANONICAL

```typescript
// FILE: lib/pnl/uiActivityEngineV20.ts, line 67-104

export async function calculateV20PnL(wallet: string): Promise<{...}> {
  const query = `
    WITH
      positions AS (
        SELECT
          condition_id,
          outcome_index,
          sum(usdc_delta) AS cash_flow,
          sum(token_delta) AS final_tokens,
          any(payout_norm) AS resolution_price
        FROM pm_unified_ledger_v7
        WHERE lower(wallet_address) = lower('${wallet}')
          AND source_type = 'CLOB'
          AND condition_id IS NOT NULL
          AND condition_id != ''
        GROUP BY condition_id, outcome_index
      ),
      position_pnl AS (
        SELECT
          condition_id,
          cash_flow,
          final_tokens,
          resolution_price,
          if(resolution_price IS NOT NULL,
             round(cash_flow + final_tokens * resolution_price, 2),
             0) AS pos_realized_pnl,
          if(resolution_price IS NULL,
             round(cash_flow + final_tokens * 0.5, 2),
             0) AS pos_unrealized_pnl,
          if(resolution_price IS NOT NULL, 1, 0) AS is_resolved
        FROM positions
      )
    SELECT
      sum(pos_realized_pnl) AS realized_pnl,
      sum(pos_unrealized_pnl) AS unrealized_pnl,
      sum(pos_realized_pnl) + sum(pos_unrealized_pnl) AS total_pnl,
      count() AS position_count,
      sumIf(1, is_resolved = 1) AS resolved_count
    FROM position_pnl
  `;
}
```

**Key Points:**
- ✅ Same as V19 but uses `pm_unified_ledger_v7`
- ✅ **Rounding in SQL** (`round(..., 2)`)
- ✅ **Validated on top 15 leaderboard** (0.01-2% error)
- ❌ CLOB-only

---

### V22: Dual Formula with CTF Events

```typescript
// FILE: lib/pnl/uiActivityEngineV22.ts, line 92-150

export async function calculateV22PnL(wallet: string): Promise<V22QuickResult> {
  const query = `
    WITH
      -- Aggregate by position and source type
      position_data AS (
        SELECT
          condition_id,
          outcome_index,
          sumIf(usdc_delta, source_type = 'CLOB') AS clob_usdc,
          sumIf(usdc_delta, source_type = 'PayoutRedemption') AS redemption_usdc,
          sumIf(usdc_delta, source_type = 'PositionsMerge') AS merge_usdc,
          sumIf(usdc_delta, source_type IN ('ERC1155_Transfer', 'CTF_Transfer')) AS transfer_usdc,
          sum(token_delta) AS net_tokens,
          any(payout_norm) AS resolution_price,
          count() AS event_count
        FROM pm_unified_ledger_v7
        WHERE lower(wallet_address) = lower('${wallet}')
          AND condition_id IS NOT NULL
          AND condition_id != ''
          -- Exclude funding events - they're not trading PnL
          AND source_type NOT IN ('Deposit', 'Withdrawal')
        GROUP BY condition_id, outcome_index
      ),
      -- Classify positions and calculate PnL
      position_pnl AS (
        SELECT
          condition_id,
          outcome_index,
          clob_usdc,
          redemption_usdc,
          merge_usdc,
          transfer_usdc,
          net_tokens,
          resolution_price,
          event_count,
          -- Trading USDC = CLOB + redemptions + merges (excludes transfers)
          clob_usdc + redemption_usdc + merge_usdc AS trading_usdc,
          -- Position classification
          if(abs(net_tokens) < 1, 1, 0) AS is_closed,
          if(abs(net_tokens) >= 1 AND resolution_price IS NOT NULL, 1, 0) AS is_open_resolved,
          if(abs(net_tokens) >= 1 AND resolution_price IS NULL, 1, 0) AS is_open_unresolved,
          -- PnL by position type (DUAL FORMULA):
          -- Closed positions: pure cash flow (no token valuation needed)
          if(abs(net_tokens) < 1,
             clob_usdc + redemption_usdc + merge_usdc,
             0) AS pos_closed_pnl,
          -- Open resolved: cash_flow + net_tokens * resolution_price
          if(abs(net_tokens) >= 1 AND resolution_price IS NOT NULL,
             clob_usdc + redemption_usdc + merge_usdc + net_tokens * resolution_price,
             0) AS pos_open_resolved_pnl,
          -- Open unresolved: cash_flow + net_tokens * 0.5
          if(abs(net_tokens) >= 1 AND resolution_price IS NULL,
             clob_usdc + redemption_usdc + merge_usdc + net_tokens * 0.5,
             0) AS pos_open_unresolved_pnl
        FROM position_data
      )
    SELECT
      sum(pos_closed_pnl) AS closed_pnl,
      sum(pos_open_resolved_pnl) AS open_resolved_pnl,
      sum(pos_open_unresolved_pnl) AS open_unresolved_pnl,
      ...
  `;
}
```

**Key Points:**
- ✅ **Includes CTF events** (PayoutRedemption, PositionsMerge)
- ✅ **Dual formula** (closed vs open positions)
- ✅ **Source breakdown** (CLOB, redemption, merge USDC)
- ✅ Excludes funding events (Deposit, Withdrawal)
- ❌ Experimental (not validated)

---

## 2. Fee Handling Comparison

| Engine | Fee Handling | Details |
|--------|--------------|---------|
| V13 | Implicit in USDC amounts | Fees already subtracted from `usdc_amount` in raw table |
| V17 | Implicit in USDC amounts | Same as V13 |
| V18 | Implicit in USDC amounts | Same as V13 |
| V19 | Implicit in `usdc_delta` | Ledger pre-processes fees |
| V20 | Implicit in `usdc_delta` | Same as V19 |
| V22 | **Explicit breakdown** | `clob_usdc`, `redemption_usdc`, `merge_usdc` (can audit fee impact per source) |

**Critical Insight:**
- Polymarket CLOB fees are **deducted from USDC received** on sells, **added to USDC paid** on buys
- Example: Buy 100 shares at $0.60 with 2% fee = pay $61.20 USDC
- V13-V20 use `usdc_amount` which **already has fees embedded**
- V22 breaks down by source, allowing fee audit

---

## 3. Deduplication Strategy Comparison

### V13, V17, V18: Manual GROUP BY

```sql
-- Pattern used in V13, V17, V18
SELECT any(token_id), any(side), any(token_amount), ...
FROM pm_trader_events_v2
WHERE trader_wallet = ?
GROUP BY event_id  -- ← Dedupe here
```

**Why needed:**
- `pm_trader_events_v2` has 2-3x duplicates per `event_id` (historical backfill artifacts)
- Table uses `SharedMergeTree` (not `ReplacingMergeTree`)
- Sort key doesn't include `event_id`, so can't dedupe automatically

**Cost:** ~10-20% query overhead for GROUP BY

---

### V19, V20, V22: Ledger Aggregation

```sql
-- Pattern used in V19, V20, V22
SELECT
  sum(usdc_delta) AS cash_flow,
  sum(token_delta) AS final_tokens
FROM pm_unified_ledger_v7
WHERE wallet_address = ?
GROUP BY condition_id, outcome_index
```

**Why better:**
- Ledger is pre-aggregated (no duplicates)
- Direct summation (no `any()` hacks)
- Faster (no GROUP BY overhead on event_id)

---

## 4. Resolution Handling Comparison

### V13: Weighted Average Cost Basis

```typescript
// FILE: lib/pnl/uiActivityEngineV13.ts, line 554-589

for (const [key, state] of states.entries()) {
  if (state.amount > 0.001) {
    const [conditionId, outcomeStr] = key.split('_');
    const outcomeIndex = parseInt(outcomeStr, 10);
    const resolution = this.resolutionCache?.get(conditionId);

    if (resolution && resolution.payout_numerators.length > outcomeIndex) {
      const payout = resolution.payout_numerators[outcomeIndex];
      const avgCost = getAvgCost(state); // totalCost / amount
      const proceeds = state.amount * payout;
      const costBasis = state.amount * avgCost;
      const pnl = proceeds - costBasis;

      state.realized_pnl += pnl;
      resolutions++;
    }
  }
}
```

**Formula:** `(shares * resolution_price) - (shares * avg_cost)`

**Key Points:**
- ✅ Tracks cost basis per position
- ✅ Calculates PnL relative to acquisition cost
- ❌ Complex (requires state machine)

---

### V17, V18, V19, V20: Cash Flow + Final Shares

```typescript
// FILE: lib/pnl/uiActivityEngineV17.ts, line 340-360
// (Same logic in V18, V19, V20)

const trade_cash_flow = agg.sell_usdc - agg.buy_usdc;
const final_shares = agg.buy_tokens - agg.sell_tokens;

if (isResolved && resolution_price !== null) {
  // Realized PnL = cash_flow + (final_shares × resolution_price)
  pos_realized_pnl = trade_cash_flow + final_shares * resolution_price;
  resolutions++;
} else {
  // Unrealized: use current price estimate (0.5)
  const currentPrice = 0.5;
  pos_unrealized_pnl = trade_cash_flow + final_shares * currentPrice;
  pos_realized_pnl = 0; // No realized PnL until resolution
}
```

**Formula:** `cash_flow + (final_shares * resolution_price)`

**Key Points:**
- ✅ Simple (one-line calculation)
- ✅ No state machine needed
- ✅ Equivalent to cost-basis approach (algebraically)

---

### V22: Dual Formula (Closed vs Open)

```sql
-- FILE: lib/pnl/uiActivityEngineV22.ts, line 133-144

-- Closed positions: pure cash flow (no token valuation needed)
if(abs(net_tokens) < 1,
   clob_usdc + redemption_usdc + merge_usdc,
   0) AS pos_closed_pnl,

-- Open resolved: cash_flow + net_tokens * resolution_price
if(abs(net_tokens) >= 1 AND resolution_price IS NOT NULL,
   clob_usdc + redemption_usdc + merge_usdc + net_tokens * resolution_price,
   0) AS pos_open_resolved_pnl,

-- Open unresolved: cash_flow + net_tokens * 0.5
if(abs(net_tokens) >= 1 AND resolution_price IS NULL,
   clob_usdc + redemption_usdc + merge_usdc + net_tokens * 0.5,
   0) AS pos_open_unresolved_pnl
```

**Key Points:**
- ✅ **Avoids token valuation on closed positions** (|net_tokens| < 1)
- ✅ **Includes redemption USDC** (may fix phantom losses)
- ✅ Treats positions with tokens differently (standard formula)

---

## 5. Key Differences Summary

| Feature | V13 | V17 | V18 | V19 | V20 | V22 |
|---------|-----|-----|-----|-----|-----|-----|
| **Role Filter** | All | All | **Maker** | All | All | All |
| **Dedupe** | GROUP BY | GROUP BY | GROUP BY | Ledger | Ledger | Ledger |
| **Paired Norm** | No | **Yes** | No | No | No | No |
| **CTF Events** | Splits/Merges | No | No | No | No | **Redemptions/Merges** |
| **Unmapped Filter** | No | No | No | **Yes** | **Yes** | **Yes** |
| **Rounding** | None | None | **Cents (TS)** | None | **Cents (SQL)** | None |
| **Formula** | Weighted avg | Cash flow | Cash flow | Cash flow | Cash flow | **Dual** |
| **Source Breakdown** | No | No | No | No | No | **Yes** |

---

## 6. Failure Hypothesis Mapping

| Wallet | UI PnL | V18 PnL | Likely Fix | Engine to Test |
|--------|--------|---------|------------|----------------|
| 0x35f0 | +$3,292 | +$3,814 (+15.9%) | Paired normalization or closed-position dual formula | **V17** or **V22** |
| 0x3439 | $0 | -$8,260 (phantom loss) | Unmapped trade filtering or missing redemptions | **V19/V20** or **V22** |
| 0x227c | -$278 | +$184 (sign flip) | Include taker fills (maker-only flipped direction) | **V13/V17/V20** |
| 0x222a | +$520 | $0 (missing profit) | Include redemptions or taker fills | **V22** or **V13/V17** |
| 0x0e5f | -$400 | -$1 (undercounting) | Include redemptions or dual formula for closed positions | **V22** |

---

## 7. Recommended Action Plan

1. **Run V20 on all 5 wallets** (canonical, validated on top 15)
   - If V20 matches better → V18 maker-only filter is wrong

2. **Run V22 on all 5 wallets** (includes redemptions)
   - If V22 fixes phantom loss → redemptions are key
   - If V22 fixes undercounting → dual formula is key

3. **Run V17 on wallet 0x35f0** (paired normalization)
   - If V17 fixes overcounting → complete-set arbitrage is issue

4. **Manual query for wallet 0x3439** (phantom loss)
   ```sql
   SELECT count(*) FROM pm_trader_events_v2
   WHERE trader_wallet = '0x3439...'
     AND token_id NOT IN (SELECT token_id_dec FROM pm_token_to_condition_map_v3);
   ```

5. **Fee audit for wallet 0x227c** (sign flip)
   ```sql
   SELECT
     sumIf(usdc_amount, role = 'maker') as maker_usdc,
     sumIf(usdc_amount, role = 'taker') as taker_usdc
   FROM pm_trader_events_v2
   WHERE trader_wallet = '0x227c...';
   ```

---

**Conclusion:** V18's maker-only filter is the most likely culprit. V20 (canonical, all roles) or V22 (includes redemptions) should match UI better.
