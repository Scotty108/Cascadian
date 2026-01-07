# Copy Trading Leaderboard - December 31, 2025

## v3: Momentum-Based Ranking with Cash Flow Proxy

### Critical Discovery: Cash Flow ≠ Resolved PnL

**Problem Found:** Our initial acceleration metrics used `sells - buys` (cash flow), which shows:
- Wallets with large open positions as "negative" (they've bought but haven't sold yet)
- Example: Wallet 0x84cb17a5 shows -$1.7M cash flow but +$12K resolved PnL (CCR-v1)

**Root Cause:** Cash flow doesn't account for:
1. Positions that haven't resolved yet (unrealized)
2. Positions that resolved but weren't claimed (synthetic settlement)

**Correct Formula (CCR-v1):**
```
For maker-only trades:
- side='buy' → wallet BOUGHT tokens (paid USDC, received tokens)
- side='sell' → wallet SOLD tokens (received USDC, sent tokens)

net_tokens = sum(buy_tokens) - sum(sell_tokens)
net_usdc = sum(sell_usdc) - sum(buy_usdc)
realized_pnl = net_usdc + (net_tokens * payout)  // payout=1 for winner, 0 for loser
```

**Validation:** Formula matches CCR-v1 within 0.01% for wallet 0x92d8a88f ($33,640.94 vs $33,641)

---

## Momentum Leaders (Cash Flow Proxy)

> **Note:** These use cash flow as a momentum indicator. For accurate realized PnL, use CCR-v1 engine.

### Top 10 Accelerating Wallets (7d/14d)

| Rank | Wallet | 7d Cash | Daily Rate | Accel | Avg Buy |
|------|--------|---------|------------|-------|---------|
| 1 | `0x50e070f5fb1a2539674402c05f71c5d982fe292e` | $5,327 | $761/d | 65.2x | 35.6¢ |
| 2 | `0xffd428c596330135eaba495b536972e20e000f95` | $3,005 | $429/d | 57.2x | 49.5¢ |
| 3 | `0x130d18eb0bf08e3067141ac4ec28dbfeef4f1ef2` | $21,099 | $3,014/d | 46.3x | 55.6¢ |
| 4 | `0xf6044bca3cb5cf7bbba8fa50f0a0ebd1780f36b3` | $3,754 | $536/d | 39.5x | 41.9¢ |
| 5 | `0xea66954db9270f1f11371cf8e357ba01281c68ff` | $4,400 | $629/d | 34.2x | 34.1¢ |
| 6 | `0x0af4aae99b519b675b38eb39afc7ffe3ff0a89b4` | $2,568 | $367/d | 32.4x | 52.4¢ |
| 7 | `0xbb66bff09be6b30eabfd5e37fb4255cfc0f4c55b` | $2,306 | $329/d | 31.2x | 28.7¢ |
| 8 | `0xe95218883f377c5661d164c89283933a3415bde4` | $2,477 | $354/d | 27.2x | 20.8¢ |
| 9 | `0xe0586a72946dabda6275a10b5a2fa64973f0d73e` | $4,167 | $595/d | 26.0x | 52.8¢ |
| 10 | `0xbe29870f43688b26a3a718863fcb37f7ec1eb4b9` | $7,970 | $1,139/d | 25.9x | 25.4¢ |

**Filter Criteria:**
- Minimum $1,000 7d cash flow
- Minimum $100 14d cash flow
- Avg buy price 10-85¢ (excludes arbers)
- Active: 20+ trades in last 7 days
- Acceleration > 1.0 (growing)

---

## Whale Momentum (High Volume)

| Wallet | 7d Cash | Daily Rate | Accel | Trades |
|--------|---------|------------|-------|--------|
| `0x99cca2e8e9231d62ef99252f059a1d50f7679eec` | $32,557 | $4,651/d | 25.5x | 105 |
| `0x130d18eb0bf08e3067141ac4ec28dbfeef4f1ef2` | $21,099 | $3,014/d | 46.3x | 168 |
| `0xbe29870f43688b26a3a718863fcb37f7ec1eb4b9` | $7,970 | $1,139/d | 25.9x | 30 |
| `0x948cc2f1138a516c0f4fd03eb30015c331fd42ee` | $6,993 | $999/d | 20.9x | 26 |

---

## CCR-v1 Validated Wallets

These wallets have been verified against CCR-v1 engine output:

| Wallet | CCR-v1 PnL | Win/Loss | Win Rate |
|--------|------------|----------|----------|
| 0x92d8a88f0a... | +$33,641 | 93/53 | 64% |
| 0x060e941560... | +$89,768 | 17/19 | 47% |
| 0x84cb17a50b... | +$12,256 | 154/103 | 60% |

> **Note:** These are REALIZED PnL on resolved positions. Cash flow metrics differ significantly due to open positions.

---

## Red Flags - Avoid These

| Type | Why Avoid |
|------|-----------|
| 99¢ Arbers | Speed game, not copyable |
| Negative acceleration | Slowing down |
| High avg buy (>90¢) | Low edge, high risk |
| No recent activity | May have stopped trading |

---

## Technical Architecture Notes

### Pre-computed Table (In Progress)
```sql
-- pm_wallet_condition_realized_v1
-- One row per (wallet, condition_id) at resolution
CREATE TABLE pm_wallet_condition_realized_v1 (
  wallet String,
  condition_id String,
  resolved_ts DateTime,
  realized_pnl Float64,
  cost_basis Float64,
  volume Float64,
  trades UInt32,
  is_win UInt8,
  ...
) ENGINE = ReplacingMergeTree()
ORDER BY (wallet, condition_id)
```

### Why Maker-Only?
- `pm_trader_events_v2` has both maker and taker rows per fill
- Maker-only avoids double-counting
- Matches CCR-v1 engine semantics

### CTF Events Impact
Wallets with PayoutRedemption events need special handling:
- Redemptions are "sells" at payout price ($1 for winner, $0 for loser)
- Synthetic settlement in SQL doesn't account for this
- Use CCR-v1 engine for accurate numbers

---

## Recommended Queries

### Momentum Leaders (Cash Flow Proxy)
```sql
SELECT
  wallet,
  round(pnl_7d, 0) as pnl_7d,
  round((pnl_7d/7) / nullIf(pnl_14d/14, 0), 2) as acceleration,
  round(avg_buy_price, 3) as avg_buy_price
FROM (
  SELECT
    lower(trader_wallet) as wallet,
    sumIf(if(side = 'sell', usdc_amount, -usdc_amount),
          trade_time >= now() - INTERVAL 7 DAY) / 1e6 as pnl_7d,
    sumIf(if(side = 'sell', usdc_amount, -usdc_amount),
          trade_time >= now() - INTERVAL 14 DAY) / 1e6 as pnl_14d,
    sumIf(usdc_amount, side = 'buy') /
      nullIf(sumIf(token_amount, side = 'buy'), 0) as avg_buy_price
  FROM pm_trader_events_v2
  WHERE is_deleted = 0 AND role = 'maker'
    AND trade_time >= now() - INTERVAL 30 DAY
  GROUP BY wallet
)
WHERE pnl_7d >= 1000 AND pnl_14d >= 100
  AND avg_buy_price BETWEEN 0.10 AND 0.85
ORDER BY acceleration DESC
LIMIT 20
```

### Accurate Realized PnL (Per Wallet)
Use `getWalletPnl()` in `lib/pnl/getWalletPnl.ts` which calls CCR-v1 engine.

---

## Next Steps

1. **Complete pre-computed table population** - Use CCR-v1 engine output directly
2. **Build daily rollup table** - `pm_wallet_daily_realized_v1`
3. **Acceleration on resolved PnL** - Replace cash flow proxy with actual realized

---

*Generated: December 31, 2025*
*Metrics: Cash flow proxy for momentum, CCR-v1 for realized PnL*
