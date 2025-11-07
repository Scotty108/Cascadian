# Data Source Analysis: P&L Calculation

## Summary Answer to Your Question

**"Do we have everything we need in trades_raw? Or do we need to combine it with market_resolutions_final?"**

### Answer: trades_raw HAS everything structurally, but the realized_pnl_usd field is BROKEN

---

## trades_raw Schema (Complete)

```
✓ trade_id: String
✓ wallet_address: String
✓ market_id: String (NOT normalized)
✓ timestamp: DateTime
✓ side: Enum8('YES' = 1, 'NO' = 2)
✓ entry_price: Decimal(18, 8)
✓ exit_price: Nullable(Decimal(18, 8))
✓ shares: Decimal(18, 8)
✓ usd_value: Decimal(18, 2)
✓ pnl: Nullable(Decimal(18, 2))
✓ is_closed: Bool
✓ transaction_hash: String
✓ condition_id: String (NOT normalized - no 0x prefix removal or lowercase)
✓ was_win: Nullable(UInt8) - Win/loss indicator (1=win, 0=loss)
✓ resolved_outcome: LowCardinality(String) - Winning outcome
✓ outcome_index: Int16 - Winning outcome index
✓ is_resolved: UInt8 - Resolution status
✓ realized_pnl_usd: Float64 - *** BROKEN - NOT CALCULATED CORRECTLY ***
```

---

## Current Data Quality Issues

### Issue 1: realized_pnl_usd Field is Not Calculated Correctly

**niggemon wallet** (0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0):
- Actual SUM(realized_pnl_usd): **$117.24**
- Expected (from Polymarket): **$101,949.55**
- Error: **-99.88%** (off by 871.9x)

**LucasMeow wallet** (0x7f3c8979d0afa00007bae4747d5347122af05613):
- Actual SUM(realized_pnl_usd): **-$4,441,217.93**
- Expected (from Polymarket): **$179,243**
- Error: **NEGATIVE & 2,477.8% wrong**

**xcnstrategy** (0xcce2b7c71f21e358b8e5e797e586cbc03160d58b):
- Actual: **$0**
- Expected: **$94,730**
- Error: **-100%**

**HolyMoses7** (0xa4b366ad22fc0d06f1e934ff468e8922431a87b8):
- Actual: **$0**
- Expected: **$93,181**
- Error: **-100%**

### Issue 2: Not All Wallets Loaded

- LucasMeow, xcnstrategy: **NO DATA in outcome_positions_v2**
- Only niggemon and HolyMoses7 have partial data in aggregated tables

---

## Data Completeness Analysis

### What's Populated in trades_raw

For niggemon wallet (16,472 total trades):

| Field | Populated | % Complete | Status |
|-------|-----------|-----------|--------|
| entry_price | 16,472 | 100% | ✓ Complete |
| exit_price | 52 | 0.3% | ✗ **Mostly NULL** |
| was_win | 52 | 0.3% | ✗ **Mostly NULL** |
| resolved_outcome | 16,472 | 100% | ✓ Complete |
| outcome_index | 16,472 | 100% | ✓ Complete |
| is_resolved | 332 | 2% | ⚠️ Only resolved ones set |
| pnl field | 200 | 1.2% | ✗ **Sparse** |

---

## Root Cause

**trades_raw is NOT SELF-CONTAINED for P&L calculation** because:

1. **exit_price is 99.7% NULL** - cannot calculate (exit - entry) * shares
2. **was_win is 99.7% NULL** - cannot determine gains vs losses
3. **pnl field is 98.8% unpopulated** - not calculated
4. **Only 52 rows have complete data** (0.3% of trades)

This means **trades_raw must be enriched with data from market_resolutions_final**.

---

## Solution: Join trades_raw with market_resolutions_final

### The JOIN Strategy

```sql
SELECT
  t.*,
  m.winning_index,
  m.payout_numerators,
  m.payout_denominator
FROM trades_raw t
LEFT JOIN market_resolutions_final m
  ON normalize(t.condition_id) = m.condition_id_norm
WHERE t.wallet_address = lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
  AND m.winning_index IS NOT NULL
```

### Calculate P&L from the joined result

**For each resolved trade:**

```
1. Determine if wallet won:
   was_win = (t.outcome_index == m.winning_index) ? 1 : 0

2. Calculate payout (in this case, binary outcome = $1 per share):
   payout = shares * (arrayElement(m.payout_numerators, m.winning_index + 1) / m.payout_denominator)

3. Calculate realized P&L:
   realized_pnl = payout - t.usd_value (cost basis)

4. Aggregate:
   total_gains = SUM(realized_pnl) where realized_pnl > 0
   total_losses = SUM(ABS(realized_pnl)) where realized_pnl < 0
   net_pnl = total_gains - total_losses
```

---

## Answer to Your Question

**"Do we have everything we need in trades_raw? Or do we need to combine it with market_resolutions_final?"**

### **Answer: YES, we MUST combine with market_resolutions_final**

**Why:**
- trades_raw has cost basis (entry_price, usd_value) ✓
- trades_raw has outcome_index (what wallet bought) ✓
- trades_raw has shares (position size) ✓
- BUT trades_raw is MISSING:
  - winning_index (what actually won) ✗
  - payout_numerators/payout_denominator (payout calculation) ✗
  - exit_price (mostly NULL) ✗

**The fix requires:**
1. Normalize condition_id in trades_raw (remove 0x, lowercase)
2. Join with market_resolutions_final on condition_id_norm
3. Calculate: payout value using payout vectors
4. Calculate: realized_pnl = payout - cost_basis
5. Aggregate: gains and losses separately per wallet

---

## Implementation Steps

### Step 1: Create condition_id mapping
```
Add to trades_raw:
  condition_id_norm = lower(replaceAll(condition_id, '0x', ''))
```

### Step 2: Build enriched P&L table
```sql
CREATE TABLE wallet_pnl_correct ENGINE = MergeTree() ORDER BY wallet_address AS
SELECT
  t.wallet_address,
  SUM(CASE WHEN realized_pnl > 0 THEN realized_pnl ELSE 0 END) as total_gains,
  SUM(CASE WHEN realized_pnl < 0 THEN ABS(realized_pnl) ELSE 0 END) as total_losses,
  total_gains - total_losses as net_pnl
FROM (
  SELECT
    t.wallet_address,
    CASE
      WHEN m.winning_index IS NOT NULL
      THEN (t.shares * (arrayElement(m.payout_numerators, m.winning_index + 1) / m.payout_denominator)) - t.usd_value
      ELSE NULL
    END as realized_pnl
  FROM trades_raw t
  LEFT JOIN market_resolutions_final m
    ON lower(replaceAll(t.condition_id, '0x', '')) = m.condition_id_norm
  WHERE t.is_resolved = 1
)
GROUP BY wallet_address
```

### Step 3: Validate against Polymarket targets
```
niggemon: $101,949.55
LucasMeow: $179,243
xcnstrategy: $94,730
HolyMoses7: $93,181
```
