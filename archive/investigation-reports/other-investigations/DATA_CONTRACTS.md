# Data Contracts - P&L Reconciliation
**Version:** 1.0
**Date:** 2025-11-12
**Wallet:** `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b`

---

## Source Tables

### 1. clob_fills
**Purpose:** Trade execution records from Polymarket CLOB
**Key:** `(tx_hash, asset_id, side)`

| Column | Type | Unit | Notes |
|--------|------|------|-------|
| `tx_hash` | String | - | Transaction hash |
| `timestamp` | DateTime | seconds | Block timestamp |
| `proxy_wallet` | String | - | User's proxy wallet address (lowercase) |
| `asset_id` | String | decimal | **NOT ERC1155 token_id** - internal CLOB ID |
| `market_slug` | String | - | Market identifier |
| `side` | Enum | - | `'BUY'` or `'SELL'` |
| `size` | Float64 | **microshares** | **MUST divide by 1,000,000** |
| `price` | Float64 | USD per share | Already in correct unit |
| `fee_rate_bps` | UInt32 | basis points | Fee = notional × (fee_rate_bps / 10000) |

**Critical Rules:**
- ✅ `size` is in microshares - **ALWAYS divide by 1,000,000**
- ❌ `asset_id` cannot be decoded directly - use as join key only
- ✅ `proxy_wallet` is normalized (lowercase, no checksum)

### 2. erc1155_transfers
**Purpose:** On-chain ERC1155 token movements
**Key:** `(tx_hash, log_index)`

| Column | Type | Unit | Notes |
|--------|------|------|-------|
| `tx_hash` | String | - | Transaction hash |
| `log_index` | UInt32 | - | Event index within transaction |
| `block_number` | UInt64 | - | Block number |
| `block_timestamp` | DateTime | seconds | Block time |
| `contract` | String | - | ERC1155 contract address |
| `token_id` | String | **hex with 0x** | **Canonical ERC1155 token_id** |
| `from_address` | String | - | Sender (0x000...000 = mint) |
| `to_address` | String | - | Receiver (0x000...000 = burn/redeem) |
| `value` | String | **microshares** | **MUST parse and divide by 1,000,000** |
| `operator` | String | - | Transaction initiator |

**Critical Rules:**
- ✅ `token_id` is hex string with `0x` prefix - **use for decoding**
- ✅ `value` is in microshares - **ALWAYS divide by 1,000,000**
- ✅ Burns/redemptions: `to_address = '0x0000000000000000000000000000000000000000'`

### 3. market_resolutions_final
**Purpose:** Resolution outcomes for conditional markets
**Key:** `condition_id_norm`

| Column | Type | Unit | Notes |
|--------|------|------|-------|
| `condition_id_norm` | FixedString(64) | hex | Normalized: 64 chars, lowercase, no 0x |
| `payout_numerators` | Array(UInt8) | - | Payout per outcome (0 or 1 for binary) |
| `payout_denominator` | UInt8 | - | Usually 1 |
| `outcome_count` | UInt8 | - | Number of outcomes (2 for binary) |
| `winning_outcome` | String | - | Human-readable winner ("Yes", "No", etc.) |
| `winning_index` | UInt16 | - | 0-indexed position in payout array |
| `resolved_at` | DateTime | seconds | Resolution timestamp |
| `source` | String | - | Data provenance |

**Critical Rules:**
- ✅ `condition_id_norm` is 64-char hex, lowercase, no prefix
- ✅ `payout_numerators` is ClickHouse array (1-indexed access)
- ✅ Binary markets: `payout_numerators = [1, 0]` or `[0, 1]`

---

## Token Decoding

### Standard ERC1155 Formula

```typescript
// Input: token_id from erc1155_transfers (hex string with 0x)
const tokenBigInt = BigInt(token_id);

// Decode
const condition_id_bigint = tokenBigInt >> 8n;
const outcome_index = Number(tokenBigInt & 255n);

// Format condition_id for joins
const condition_id_norm = condition_id_bigint.toString(16).padStart(64, '0');
```

**ClickHouse Equivalent:**
```sql
SELECT
  token_id,
  lpad(lower(hex(bitShiftRight(toUInt256(token_id), 8))), 64, '0') as condition_id_norm,
  toUInt8(bitAnd(toUInt256(token_id), 255)) as outcome_index
FROM erc1155_transfers
```

**Validation:**
- ✅ `outcome_index` must be < `outcome_count` from resolutions
- ✅ `condition_id_norm` must be 64 characters
- ✅ For binary markets, `outcome_index` should be 0 or 1

---

## Unit Conversions

### Shares (Microshares → Shares)
```typescript
// ALWAYS divide by 1,000,000
const shares = parseFloat(size) / 1_000_000;
const shares_erc1155 = parseFloat(value) / 1_000_000;
```

### Fees (Basis Points → USD)
```typescript
// Calculate fee from notional
const notional = shares * price;
const fee_usd = notional * (fee_rate_bps / 10_000);
```

### Resolution Payout (Array → Value)
```typescript
// ClickHouse arrays are 1-indexed!
const payout = payout_numerators[outcome_index + 1]; // +1 for ClickHouse

// For binary markets:
// Winner: payout = 1.0
// Loser: payout = 0.0
```

---

## Join Strategy

### Fill → Token_ID Join
```sql
-- Option A: Join via transaction hash
SELECT
  f.asset_id,
  f.size / 1000000.0 as shares,
  e.token_id
FROM clob_fills f
INNER JOIN erc1155_transfers e
  ON f.tx_hash = e.tx_hash
  AND abs(toUnixTimestamp(f.timestamp) - toUnixTimestamp(e.block_timestamp)) < 5
WHERE f.proxy_wallet = '{WALLET}'
```

### Token → Resolution Join
```sql
WITH decoded AS (
  SELECT
    token_id,
    lpad(lower(hex(bitShiftRight(toUInt256(token_id), 8))), 64, '0') as condition_id_norm,
    toUInt8(bitAnd(toUInt256(token_id), 255)) as outcome_index
  FROM erc1155_transfers
)
SELECT
  d.*,
  r.winning_index,
  r.payout_numerators,
  r.resolved_at
FROM decoded d
LEFT JOIN market_resolutions_final r
  ON d.condition_id_norm = r.condition_id_norm
```

---

## P&L Calculation Rules

### 1. Fill-Based Realized P&L

**On BUY:**
```typescript
position.cost_basis += (shares * price) + fee;
position.shares += shares;
position.avg_cost = position.cost_basis / position.shares;
```

**On SELL:**
```typescript
const revenue = (shares * price) - fee;
const cost = position.avg_cost * shares;
const realized_pnl = revenue - cost;

position.realized_pnl += realized_pnl;
position.shares -= shares;
position.cost_basis = position.avg_cost * position.shares;
```

### 2. Resolution-Based Realized P&L

**At Resolution (resolved_at):**
```typescript
// Calculate shares held at resolution using ERC1155 transfers
const shares_at_resolution = calculateBalanceAt(token_id, resolved_at);

// Get payout for this outcome
const payout = payout_numerators[outcome_index];  // 0 or 1 for binary

// Calculate value and realize
const resolution_value = shares_at_resolution * payout;
const resolution_cost = position.cost_basis;  // Remaining cost basis
const resolution_pnl = resolution_value - resolution_cost;

position.realized_pnl += resolution_pnl;
position.shares = 0;  // Position closed
position.cost_basis = 0;
```

**At Redemption (burn to 0x000...000):**
```typescript
// NO P&L REALIZATION
// Only update balance:
position.shares = 0;
// DO NOT touch position.realized_pnl
```

### 3. Unrealized P&L

**At Snapshot Timestamp:**
```typescript
// For unresolved positions only
const current_market_price = 0.50;  // Default mid-market
const mark_to_market_value = position.shares * current_market_price;
const unrealized_pnl = mark_to_market_value - position.cost_basis;
```

---

## Invariants

### Must Always Hold:
1. **No double counting:** Resolution + Redemption cannot both realize P&L
2. **Balance consistency:** ERC1155 balance = clob_fills balance (within tolerance)
3. **Payout validity:** `payout_numerators[outcome_index]` must not be undefined
4. **Unit consistency:** All shares in actual shares (not microshares) after loading
5. **Fee consistency:** Fees always reduce P&L (never increase)

### Sanity Checks:
- If `winning_index == outcome_index` and `shares > 0` → realized P&L should be positive
- Total realized (fills) + total realized (resolutions) should equal Dome baseline
- Position count should match Positions API

---

## Normalization Standards

### Addresses
- Always lowercase
- No checksum (EIP-55)
- Full 42 characters with `0x` prefix

### Condition IDs
- Always 64 characters (no prefix)
- Always lowercase hex
- Pad with leading zeros if needed

### Timestamps
- Always Unix timestamp (seconds since epoch)
- Use `toUnixTimestamp()` in ClickHouse
- Use `Math.floor(date.getTime() / 1000)` in TypeScript

---

## Known Issues (From Previous Investigation)

❌ **WRONG:** Decoding `clob_fills.asset_id` directly produces invalid outcome_indices (195, 239, etc.)
✅ **RIGHT:** Must join to `erc1155_transfers` first, then decode `token_id`

❌ **WRONG:** Using `size` directly without dividing by 1,000,000
✅ **RIGHT:** Always divide by 1,000,000 for both clob_fills and erc1155_transfers

❌ **WRONG:** Realizing P&L on both resolution AND redemption
✅ **RIGHT:** Realize only once at resolution, redemption only updates balance

---

**Signed:** Claude 1
**Status:** Data contracts locked
**Next:** Build fixture with 15 rows
