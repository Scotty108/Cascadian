---
name: wallet-lookup
description: Look up any wallet's PnL, trades, win rate, and positions. Auto-use when user provides a wallet address (0x...) to check, or asks "look up this wallet", "what's the PnL for", "check wallet performance", "analyze this address", "how is this wallet doing", "wallet stats".
argument-hint: [wallet-address]
---

# Wallet Lookup

Quick comprehensive analysis of any Polymarket wallet.

## Usage

`/wallet-lookup 0x1234...` or just mention analyzing a wallet address.

## Workflow

Given wallet address `$ARGUMENTS`:

### 1. Normalize Address
```sql
-- Ensure lowercase, no 0x prefix issues
-- Use: lower('$ARGUMENTS')
```

### 2. FIFO Performance Summary
```sql
SELECT
  wallet,
  count() as total_positions,
  countIf(pnl_usd > 0) as winning_positions,
  countIf(pnl_usd < 0) as losing_positions,
  countIf(pnl_usd = 0) as breakeven,
  round(winning_positions / nullIf(winning_positions + losing_positions, 0) * 100, 1) as win_rate_pct,
  round(sum(pnl_usd), 2) as total_pnl_usd,
  round(sum(cost_basis_usd), 2) as total_invested,
  round(sum(pnl_usd) / nullIf(sum(cost_basis_usd), 0) * 100, 1) as roi_pct,
  min(trade_time) as first_trade,
  max(trade_time) as last_trade
FROM pm_trade_fifo_roi_v3
WHERE wallet = lower('$ARGUMENTS')
GROUP BY wallet
```

### 3. Recent Positions (Last 10)
```sql
SELECT
  condition_id,
  side,
  round(cost_basis_usd, 2) as cost,
  round(pnl_usd, 2) as pnl,
  round(roi_pct, 1) as roi,
  is_closed,
  trade_time
FROM pm_trade_fifo_roi_v3
WHERE wallet = lower('$ARGUMENTS')
ORDER BY trade_time DESC
LIMIT 10
```

### 4. Activity Check (CLOB)
```sql
SELECT
  count() as total_fills,
  countIf(side = 'BUY') as buys,
  countIf(side = 'SELL') as sells,
  round(sum(usdc_amount) / 1e6, 2) as total_volume_usd,
  min(fill_timestamp) as first_fill,
  max(fill_timestamp) as last_fill
FROM pm_canonical_fills_v4
WHERE wallet = lower('$ARGUMENTS')
  AND source != 'negrisk'
```

### 5. Open Positions (if available)
```sql
SELECT
  condition_id,
  net_tokens,
  cost_basis_usd,
  updated_at
FROM pm_wallet_position_fact_v1
WHERE wallet = lower('$ARGUMENTS')
  AND abs(net_tokens) > 0.01
ORDER BY abs(cost_basis_usd) DESC
LIMIT 10
```

## Output Format

```
WALLET SNAPSHOT: [address]

PERFORMANCE (FIFO)
  Total Positions:  [count]
  Win Rate:         [X]% ([wins]W / [losses]L)
  Total PnL:        $[amount] USD
  Total Invested:   $[amount] USD
  ROI:              [X]%
  Active Since:     [first_trade] → [last_trade]

ACTIVITY (CLOB)
  Total Fills:      [count] ([buys] buys, [sells] sells)
  Total Volume:     $[amount] USD
  First Fill:       [timestamp]
  Last Fill:        [timestamp]

RECENT POSITIONS (Last 10)
  Condition           Side    Cost       PnL        ROI     Status
  [id short]          LONG    $XXX       +$XX       +XX%    Closed
  [id short]          SHORT   $XXX       -$XX       -XX%    Open
  ...

OPEN POSITIONS ([count] active)
  Condition           Tokens     Cost Basis
  [id short]          XXX.XX     $XXX.XX
  ...

CLASSIFICATION
  [Based on metrics: whale/active trader/casual/specialist]
```

## Classification Rules

| Category | Criteria |
|----------|----------|
| Whale | > $100k total volume |
| Active Trader | > 100 positions, active in last 7 days |
| Smart Money | > 55% win rate, > 30 positions, > $10k PnL |
| Specialist | > 80% positions in one direction (LONG or SHORT) |
| Casual | < 20 positions |
