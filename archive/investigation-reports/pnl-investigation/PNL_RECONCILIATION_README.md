# P&L Reconciliation Methodology

**Wallet:** `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b`
**Date:** November 12, 2025
**Purpose:** Reconcile lifetime P&L against Dome API, Polymarket UI, and Positions API

---

## Known Baselines

| Source | Value | Scope |
|--------|-------|-------|
| **Dome API** | $87,030.505 | Lifetime P&L (all time) |
| **Polymarket UI** | $95,365 | Lifetime realized + unrealized (192 predictions) |
| **Positions API** | $9,610.48 | Current 39 open positions ($1,137 realized + $8,473 unrealized) |
| **Our Pipeline** | $14,500 | Window P&L (Aug 21, 2024 → now) |

---

## Data Sources (AUTHORIZED ONLY)

### 1. `default.clob_fills`
**Source:** Raw Goldsky blockchain feed
**Usage:** Primary source for all buy/sell activity
**Fields:** `timestamp`, `asset_id`, `market`, `side`, `size`, `price`, `fee_rate_bps`, `transaction_hash`, `maker_address`

**Rules:**
- ✅ Use for all P&L calculations
- ❌ Do NOT use inferred tables (`vw_trades_canonical`, `trade_direction_assignments`)
- ❌ Do NOT use synthetic rows

### 2. `default.erc1155_transfers`
**Source:** On-chain ERC-1155 token transfers
**Usage:** Track position balances, detect redemptions (burns to 0x000...000)
**Fields:** `block_timestamp`, `token_id`, `from_address`, `to_address`, `value`, `transaction_hash`

**Rules:**
- ✅ Use for balance verification
- ✅ Use for redemption detection (to_address = 0x000...000)
- ❌ Do NOT realize P&L again on redemptions (already realized at resolution)

### 3. `default.market_resolutions_final`
**Source:** Market resolution outcomes
**Usage:** Value held positions at resolution time
**Fields:** `condition_id_norm`, `winning_index`, `resolution_time`, `payout_numerators`

**Rules:**
- ✅ Realize P&L for shares held at resolution
- ✅ Use payout_numerators for valuation (winning outcome = 1.0, losing = 0.0)
- ❌ Do NOT double-count on subsequent redemption

---

## Token Decoding Formula

**Critical:** Use bitwise operations (NOT string manipulation)

```typescript
// CORRECT (bitwise operations)
const tokenBigInt = BigInt('0x' + hex);
const condition_id = (tokenBigInt >> 8n).toString(16).padStart(64, '0');
const outcome_index = Number(tokenBigInt & 255n);

// WRONG (string manipulation)
const condition_id = hex.slice(0, 62) + '00';  // ❌ DO NOT USE
const outcome_index = parseInt(hex.slice(-2), 16);  // ❌ DO NOT USE
```

**ClickHouse Implementation:**
```sql
SELECT
  lower(hex(bitShiftRight(
    reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))),
    8
  ))) as condition_id_norm,
  toUInt8(bitAnd(
    reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))),
    255
  )) as outcome_index
```

**Validation:** 100% match rate on 25 random assets (see `token_decode_validation.csv`)

---

## P&L Calculation Rules

### Realized P&L (from CLOB fills)

**Method:** Average cost basis with FIFO accounting

```typescript
// On BUY
position.cost_basis += (fill.size * fill.price) + fee;
position.total_bought += fill.size;
position.avg_cost = position.cost_basis / position.total_bought;

// On SELL
const revenue = (fill.size * fill.price) - fee;
const cost = position.avg_cost * fill.size;
const realized_pnl = revenue - cost;

position.realized_pnl += realized_pnl;
position.total_sold += fill.size;
position.cost_basis = position.avg_cost * (position.total_bought - position.total_sold);
```

### Realized P&L (at resolution)

**Method:** Value shares held at resolution time

```typescript
// At resolution_time
const shares_held = position.net_position;  // From ERC-1155 balance
const payout = resolution.payout_numerators[position.outcome_index];
const resolution_value = shares_held * payout;  // Winning = 1.0, Losing = 0.0
const resolution_cost = position.cost_basis;
const resolution_pnl = resolution_value - resolution_cost;

position.realized_pnl += resolution_pnl;
position.cost_basis = 0;  // Reset after resolution
position.net_position = 0;  // Fully realized
```

### Unrealized P&L

**Method:** Mark-to-market on open positions

```typescript
// For positions NOT yet resolved
const current_price = await fetchFromGammaAPI(asset_id);
const current_value = position.net_position * current_price;
const unrealized_pnl = current_value - position.cost_basis;
```

### Fee Treatment

**Rule:** Fees are subtracted from revenue on SELLs, added to cost on BUYs

```typescript
// BUY: fee increases cost basis
const buy_cost = (size * price) + fee;

// SELL: fee reduces revenue
const sell_revenue = (size * price) - fee;
```

**Consistency with Dome:** Dome API includes fees in their calculations. We must match this.

---

## Double-Counting Prevention

### Resolution → Redemption Sequence

**Problem:** Position resolved, then later redeemed. Can't realize twice.

**Solution:**
1. **At resolution:** Realize P&L based on payout (winning = $1/share, losing = $0/share)
2. **At redemption (burn to 0x000...000):** Do NOT realize again - only update balance

```typescript
// CORRECT
if (position.is_resolved) {
  // Already realized at resolution
  // Redemption only affects balance, not P&L
  position.is_redeemed = true;
} else {
  // Not yet resolved - redemption shouldn't happen
  console.warn('Redemption before resolution detected');
}
```

### Partial Close → Resolution → Redemption

**Sequence:**
1. Buy 10,000 shares @ $0.50 = $5,000 cost
2. Sell 5,000 shares @ $0.70 = **Realize +$1,000**
3. Market resolves → outcome wins ($1.00/share)
4. 5,000 shares held → **Realize +$2,500** (value $5,000 - cost $2,500)
5. Redeem 5,000 shares → **DO NOT realize again**

**Total realized:** $3,500 ($1,000 from partial exit + $2,500 from resolution)

---

## Three Operating Modes

### Mode 1: LIFETIME

**Scope:** All time (to match Dome $87K and UI $95K)
**Data:** All `clob_fills` since inception
**Output:** Total lifetime realized + current unrealized

```typescript
const lifetimeFills = await loadFills();  // No date filter
const lifetimePositions = buildPositionsFromFills(lifetimeFills);
applyResolutions(lifetimePositions, resolutions);
```

### Mode 2: WINDOW (Aug 21, 2024 → Now)

**Scope:** Our data window (to validate our $14.5K)
**Data:** `clob_fills` where `timestamp >= '2024-08-21 00:00:00'`
**Output:** Window realized + current unrealized

```typescript
const windowFills = await loadFills('2024-08-21 00:00:00');
const windowPositions = buildPositionsFromFills(windowFills);
applyResolutions(windowPositions, resolutions);
```

### Mode 3: POSITIONS_API

**Scope:** Current open positions only (to match Polymarket $9.6K)
**Data:** Only positions with `net_position > 0` and `NOT is_resolved`
**Output:** Partial exit realized + current unrealized on 39 positions

```typescript
const currentPositions = Array.from(positions.values()).filter(
  p => p.net_position > 0 && !p.is_resolved
);
```

---

## Edge Cases

### 1. Multi-Outcome Markets (outcome_index > 1)

**Handling:** Use `payout_numerators[outcome_index]` for valuation

```sql
SELECT payout_numerators
FROM market_resolutions_final
WHERE condition_id_norm = 'xyz';
-- Returns: [0, 0, 1] for 3-outcome market where outcome 2 won
```

### 2. [1,1] Payout Arrays (tie/split outcomes)

**Handling:** Pro-rata split (each outcome gets 50% if [0.5, 0.5])

```typescript
const payout = resolution.payout_numerators[position.outcome_index];
const value = position.net_position * payout;  // 0.5 * 10000 = 5000
```

### 3. Negative Risk Markets

**Handling:** Invert the payout logic (check market metadata)

```typescript
if (market.negative_risk) {
  // NOT IMPLEMENTED YET - requires market metadata
  console.warn('Negative risk market detected');
}
```

### 4. Pre-Cutoff Sells (no visible BUY)

**Problem:** First month shows 23 SELLs, 0 BUYs = closing old positions

**Lifetime Mode:**
- Try to source historical fills before Aug 21
- If unavailable, treat as inventory opened before window (unknown cost basis)

**Window Mode:**
- Do NOT infer cost basis
- These SELLs appear as revenue but can't calculate P&L without cost

```typescript
if (position.total_bought === 0 && position.total_sold > 0) {
  console.warn('Sell without buy detected - pre-cutoff position');
  // For lifetime: try to backfill
  // For window: exclude from realized P&L calculation
}
```

---

## Acceptance Criteria

### Dome Parity
- **Target:** Daily `pnl_to_date` matches within **0.5%** OR **$250**, whichever is smaller
- **Test:** Compare each day in `daily_pnl_series.csv` against Dome API response
- **Success:** ≥95% of days within tolerance

### UI Parity
- **Target:** Lifetime total within **0.5%** after historical backfill
- **Test:** Compare `lifetime` row in crosswalk table against $95,365
- **Success:** Delta < $477 (0.5% of $95,365)

### Positions API Parity
- **Target:**
  - Unrealized P&L within **0.25%**
  - Realized P&L (partial exits) within **2%** (allows rounding/fees)
  - Position count exact match (39)
- **Test:** Compare `positions_api` row against Polymarket API snapshot
- **Success:** All three criteria met

---

## Deliverables

### 1. Crosswalk Table (`pnl_crosswalk.csv`)

| Column | Description |
|--------|-------------|
| `scope` | lifetime, window_aug21_forward, positions_api |
| `realized_fills_usd` | P&L from buy/sell trades |
| `realized_resolutions_usd` | P&L from held-to-resolution |
| `unrealized_usd` | Mark-to-market on open positions |
| `total_pnl_usd` | Sum of realized + unrealized |
| `open_positions_count` | Positions with net_position > 0 |
| `closed_positions_count` | Positions fully exited |
| `source_of_truth` | Reference (UI, Dome, API, Our DB) |
| `delta_vs_ui` | Difference from Polymarket UI $95,365 |
| `delta_vs_dome` | Difference from Dome $87,030.505 |
| `delta_vs_positions_api` | Difference from Positions API $9,610.48 |

### 2. Daily P&L Series (`daily_pnl_series.csv`)

| Column | Description |
|--------|-------------|
| `date` | YYYY-MM-DD |
| `timestamp` | Unix timestamp |
| `pnl_to_date` | Cumulative P&L to this date |
| `realized_to_date` | Cumulative realized to this date |
| `unrealized_on_date` | Unrealized P&L on this date |
| `open_positions` | Count of open positions on this date |

### 3. Token Decode Validation (`token_decode_validation.csv`)

| Column | Description |
|--------|-------------|
| `token_id` | Asset ID from fills |
| `decoded_condition_id` | Our decoded condition_id |
| `decoded_outcome_index` | Our decoded outcome_index |
| `market_slug` | Market identifier |
| `winning_index` | Winning outcome (from resolutions) |
| `gamma_condition_id` | Gamma API verification (optional) |
| `gamma_outcome_index` | Gamma API verification (optional) |
| `match` | TRUE if our decode matches ClickHouse |

### 4. Dome Comparison (`dome_comparison.csv`)

| Column | Description |
|--------|-------------|
| `date` | YYYY-MM-DD |
| `timestamp` | Unix timestamp |
| `our_pnl` | Our calculated pnl_to_date |
| `dome_pnl` | Dome's pnl_to_date |
| `delta` | Difference (our - dome) |
| `delta_pct` | Percentage difference |
| `within_tolerance` | TRUE if within 0.5% or $250 |

---

## Execution

### Step 1: Validate Token Decode
```bash
npx tsx validate-token-decode.ts
```
**Expected:** 100% match rate on 25 assets

### Step 2: Run Main Reconciliation
```bash
npx tsx pnl-reconciliation-engine.ts
```
**Output:** Crosswalk table + daily series

### Step 3: Compare Against Dome
```bash
npx tsx compare-dome-api.ts
```
**Expected:** ≥95% of days within tolerance

### Step 4: Review Results
```bash
cat pnl_crosswalk.csv
cat daily_pnl_series.csv
cat token_decode_validation.csv
cat dome_comparison.csv
```

---

## Blocking Questions Answered

### 1. Why does Dome diverge on specific dates?

**Investigation steps:**
1. Query which assets had activity on that date
2. Check if decode mismatches exist for those assets
3. Verify fee calculations match Dome's methodology
4. Check if timing differences exist (block timestamp vs transaction timestamp)

### 2. Does Polymarket UI include items Dome excludes?

**Possible explanations:**
- Dust positions (< $1 value)
- Expired/merged assets
- Unredeemed resolved positions
- Historical positions from before Dome's data window

**Test:** Compare position count (UI = 192, our count = ?)

### 3. Is Positions API realized strictly partial closes?

**Answer:** YES
**Evidence:** API shows $1,137 realized from 4 positions with partial exits
**Confirmation:** This excludes fully closed positions and resolved positions

---

## Known Gaps

### Historical Data Before Aug 21, 2024

**Gap:** $65,500 (Dome $87K - Our $14.5K - API $9.6K)
**Cause:** CLOB fills start Aug 21, 2024
**Evidence:** First month shows 23 SELLs, 0 BUYs = closing old positions

**Options:**
1. **Backfill:** Request historical CLOB data before Aug 21
2. **Dune Query:** Get Dome's query output for missing fills
3. **Accept:** Treat Aug 21 as "genesis block" for our calculations

**Recommendation:** Option 3 (accept) unless historical reconciliation is critical

---

## Contact & References

**Project:** Cascadian P&L System
**Agent:** Claude 1
**Session:** November 12, 2025

**References:**
- Polymarket Gamma API: https://gamma-api.polymarket.com/
- Dome API: https://api.domeapi.io/v1/polymarket/
- ClickHouse Docs: https://clickhouse.com/docs/
- ERC-1155 Standard: https://eips.ethereum.org/EIPS/eip-1155

---

**Last Updated:** November 12, 2025
**Status:** Ready for execution
