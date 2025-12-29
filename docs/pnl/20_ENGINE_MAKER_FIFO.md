# Engine: Maker-Only FIFO (maker_fifo_v1)

**Version:** v1
**Status:** DEPRECATED (does not match Polymarket UI)
**Files:** `scripts/pnl/fast-compute-priority-wallets.ts`

---

## Algorithm

### Data Loading

```sql
SELECT * FROM pm_trader_events_v2
WHERE lower(trader_wallet) = lower('0x...')
  AND is_deleted = 0
  AND role = 'maker'  -- ⚠️ ONLY MAKER TRADES
GROUP BY event_id    -- Dedupe
```

### Cost Basis: FIFO

For each position (token_id):

**On BUY:**
```typescript
position.amount += tokens;
position.costBasis += usdc;
position.avgPrice = position.costBasis / position.amount;
```

**On SELL:**
```typescript
const pnl = tokens * (sellPrice - position.avgPrice);
position.realizedPnl += pnl;
position.amount -= tokens;
// Note: Uses same avgPrice calculation as FIFO but simplified
```

---

## Known Failure Modes

### 1. Ignores Taker Trades

Only includes `role = 'maker'`. For wallets with significant taker activity (30-50% of volume), this misses a large portion of their trading.

**Impact:** Overestimates PnL because it sees buys but not corresponding sells.

### 2. No Splits/Merges/Redemptions

Completely ignores CTF events. If a wallet acquired tokens via split or redeemed at resolution, this engine doesn't track it.

**Impact:** Missing cost basis for split-acquired tokens, missing realized PnL from redemptions.

### 3. No Sell Clamping

Does not cap sell amounts at tracked position. Can generate "free money" if tokens arrived via untracked channels.

---

## Observed Results

### Wallet: 0x1ff26f9f8a048d4f6fb2e4283f32f6ca64d2dbbd (@cozyfnf)

| Metric | Value |
|--------|-------|
| Engine realized_pnl | $1,410,873 |
| UI PnL (WebFetch) | $1,409,525 |
| Delta | +0.1% ✅ |

**Why it worked:** Low taker ratio (11%), simple trading pattern.

### Wallet: 0x8fe70c889ce14f67acea5d597e3d0351d73b4f20

| Metric | Value |
|--------|-------|
| Engine realized_pnl | $342,418 |
| UI PnL (WebFetch) | -$3,538 |
| Delta | +9,778% ❌ FALSE POSITIVE |

**Why it failed:** High taker ratio (32%), engine missed 40% of volume.

---

## When to Use

**DO NOT USE** for UI parity or "winner" exports.

May use for:
- Historical reference
- Comparison against other engines
- Wallets with known 0% taker ratio

---

## Revert Instructions

To switch back to this engine:

```bash
export PNL_ENGINE_VERSION=maker_fifo_v1
```

Or in code:
```typescript
import { computePnL } from '@/lib/pnl/engineRouter';
const result = await computePnL(wallet, 'maker_fifo_v1');
```
