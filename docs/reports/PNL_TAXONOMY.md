# PnL Taxonomy - Canonical Definitions

> **Date:** 2025-12-07
> **Purpose:** Single source of truth for PnL terminology across all validation harnesses

---

## Core Metrics

### 1. Realized PnL

**Definition:** Profit/loss from positions that have been **closed** (exited or resolved).

**Formula:**
```
realized_pnl = cash_flow + settlement_value

Where:
- cash_flow = sum(usdc_delta) for all trades
- settlement_value = tokens_held * payout_price (for resolved markets only)
```

**When it changes:**
- When you sell a position (CLOB sell)
- When a market resolves (your held tokens get settlement value)
- When you redeem winning tokens (converts settlement to cash)

**Key Insight:** Redemptions don't change realized PnL - they just convert the settlement_value to cash.

---

### 2. Unrealized PnL

**Definition:** Paper profit/loss on positions you still hold in **unresolved** markets.

**Formula:**
```
unrealized_pnl = position_value - cost_basis

Where:
- position_value = tokens_held * current_market_price
- cost_basis = USDC spent to acquire position
```

**When it changes:**
- Market price moves
- You buy/sell more tokens
- Market resolves (unrealized becomes realized)

---

### 3. Total PnL (UI PnL)

**Definition:** What the Polymarket UI displays as "Profit/Loss".

**Formula:**
```
total_pnl = realized_pnl + unrealized_pnl
         = sum(usdc_delta) + position_value
```

**Important:** The UI shows realized + unrealized together. This is why comparing our realized-only calculation to the UI will fail for wallets with active positions.

---

## Cohort Definitions

### CLOB_ONLY

**Definition:** Wallet has ONLY CLOB trades - no splits, merges, transfers, or redemptions.

**Detection:**
```sql
SELECT wallet_address
FROM pm_unified_ledger_v8_tbl
GROUP BY wallet_address
HAVING countIf(source_type != 'CLOB') = 0
```

**Accuracy Expectation:** 100% for closed positions, price-dependent for active.

---

### CLOB_CLOSED

**Definition:** CLOB_ONLY wallet where all positions are closed.

**Closed means:**
1. Net tokens = 0 (fully exited via sells), OR
2. Market is resolved (tokens settled)

**Detection:**
```sql
WITH positions AS (
  SELECT condition_id, sum(token_delta) as net_tokens
  FROM pm_unified_ledger_v8_tbl
  WHERE wallet_address = ? AND source_type = 'CLOB'
  GROUP BY condition_id
  HAVING abs(net_tokens) > 0.01
)
SELECT p.condition_id
FROM positions p
LEFT JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id
WHERE r.condition_id IS NULL  -- Unresolved with tokens = not closed
```

**Accuracy Expectation:** 100% for `sum(usdc_delta)`.

---

### CLOB_ACTIVE

**Definition:** CLOB_ONLY wallet with at least one unresolved position.

**Accuracy Expectation:** Requires current price feed. Error proportional to price estimation accuracy.

---

### TRANSFER_FREE

**Definition:** Wallet has zero ERC1155 transfers.

**Why it matters:** Transfers can move positions between wallets, breaking our accounting.

**Detection:**
```sql
SELECT count() = 0 as is_transfer_free
FROM pm_erc1155_transfers
WHERE lower(from_address) = ? OR lower(to_address) = ?
```

---

### TRADER_STRICT

**Definition:** CLOB_ONLY + TRANSFER_FREE + no splits/merges.

The cleanest wallet type - highest accuracy expectations.

---

### MIXED

**Definition:** Has some CTF events (splits/merges/redemptions) but not heavily.

**Accuracy Expectation:** 80-95% depending on event volume.

---

### MAKER_HEAVY

**Definition:** Market maker with frequent splits/merges (>10% of events).

**Accuracy Expectation:** 50-80%. Complex inventory management makes PnL tracking difficult.

---

## Validation Thresholds

### For Dome Benchmark (Realized-to-Realized)

| PnL Magnitude | Threshold | Rationale |
|---------------|-----------|-----------|
| |PnL| >= $200 | <= 6% error | Large enough for percentage to be meaningful |
| |PnL| < $200 | <= $10 absolute | Small PnL - percentages are noisy |

### For UI Benchmark (Total-to-Total)

| PnL Magnitude | Threshold | Rationale |
|---------------|-----------|-----------|
| |PnL| >= $200 | <= 5% error + sign match | Slightly tighter for UI parity |
| |PnL| < $200 | <= $10 absolute | Same as Dome |

### Special Cases

| Condition | Treatment |
|-----------|-----------|
| Sign disagreement | Auto-fail (we're + they're -, or vice versa) |
| Both near zero | Pass if both < $10 |
| Timeout | Mark as SUSPECT, don't count in pass rate |

---

## Engine Responsibilities

### V11 (Polymarket Subgraph Port)

- **Computes:** Realized PnL
- **Data Source:** `pm_trader_events_v2` via `polymarketEventLoader`
- **Best For:** Dome comparison (realized-to-realized)

### V17 (Canonical Cascadian Engine)

- **Computes:** Realized PnL (frozen formula)
- **Data Source:** Unified ledger
- **Status:** Production engine for Cascadian

### V29 (Inventory Engine)

- **Computes:** Realized + Unrealized PnL
- **Data Source:** Unified ledger with inventory tracking
- **Features:** Inventory guard, negative position handling
- **Best For:** Full UI parity (when we have price feed)

### realizedUiStyleV2

- **Computes:** Position-based realized + estimated unrealized
- **Data Source:** `pm_unified_ledger_v8_tbl`
- **Best For:** Quick UI approximation

---

## Data Trust Hierarchy

1. **ClickHouse data** (highest) - Our source of truth
2. **Engine output** - Derived from ClickHouse
3. **Dome API** - External benchmark for realized
4. **Polymarket UI** - Reference only (may include unrealized)

---

## Validation Output Schema

Every validation script should output:

```typescript
interface ValidationResult {
  // Identity
  wallet: string;
  cohort: 'CLOB_CLOSED' | 'CLOB_ACTIVE' | 'TRADER_STRICT' | 'MIXED' | 'MAKER_HEAVY';

  // Values compared
  benchmark_value: number;
  our_value: number;
  benchmark_source: 'dome' | 'ui' | 'benchmark_table';
  metric_type: 'realized' | 'unrealized' | 'total';

  // Error calculation
  abs_error: number;
  pct_error: number;
  threshold_used: 'pct' | 'abs';

  // Pass/fail
  passed: boolean;
  failure_reason?: string;
}
```

---

## Summary Table

| What UI Shows | What Dome Shows | What We Compute |
|---------------|-----------------|-----------------|
| Realized + Unrealized | Realized only | Depends on engine |
| total_pnl | dome_realized | V11: realized, V29: both |

**Key Takeaway:** When validating, match metric types:
- **Dome validation:** Compare realized vs realized
- **UI validation:** Compare total vs total (need unrealized)
