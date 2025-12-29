# ClickHouse Quick Query Reference

**Quick lookup for common database queries in the Cascadian system.**

---

## Table Quick Reference

| Need | Table | Key Columns |
|------|-------|-------------|
| CLOB trades | `pm_trader_events_v2` | event_id, trader_wallet, token_id, side, usdc_amount, token_amount |
| AMM trades | `pm_fpmm_trades` | event_id, trader_wallet, fpmm_pool_address, side, usdc_amount, token_amount |
| PnL by wallet/condition | `pm_cascadian_pnl_v1_new` | trader_wallet, condition_id, outcome_index, realized_pnl |
| Market info | `pm_market_metadata` | condition_id, question, outcomes, volume_usdc, is_closed |
| Resolutions | `pm_condition_resolutions` | condition_id, payout_numerators, resolved_at |
| Token → Condition mapping | `pm_token_to_condition_map_v3` | token_id_dec, condition_id, outcome_index |
| CTF events | `pm_ctf_events` | user_address, condition_id, event_type, amount_or_payout |
| Split/Merge expanded | `pm_ctf_split_merge_expanded` | wallet, condition_id, outcome_index, cash_delta, shares_delta |
| ERC1155 transfers | `pm_erc1155_transfers` | tx_hash, token_id, from_address, to_address, value |
| USDC flows | `pm_erc20_usdc_flows` | tx_hash, from_address, to_address, amount_usdc, flow_type |
| Wallet ledger | `pm_wallet_condition_ledger_v9` | wallet, condition_id, tx_hash, usdc_delta, token_delta |

---

## Common Queries

### 1. Get Wallet Total PnL

```sql
SELECT
  trader_wallet,
  SUM(realized_pnl) as total_realized_pnl,
  COUNT(DISTINCT condition_id) as markets_traded,
  SUM(trade_count) as total_trades
FROM pm_cascadian_pnl_v1_new
WHERE trader_wallet = '0x...'
GROUP BY trader_wallet
```

### 2. Get Wallet PnL by Market (with metadata)

```sql
SELECT
  p.condition_id,
  m.question,
  m.outcome_label,
  SUM(p.realized_pnl) as total_pnl,
  SUM(p.trade_count) as num_trades,
  MAX(p.is_resolved) as is_resolved
FROM pm_cascadian_pnl_v1_new p
LEFT JOIN pm_market_metadata m
  ON p.condition_id = m.condition_id
WHERE p.trader_wallet = '0x...'
GROUP BY p.condition_id, m.question, m.outcome_label
ORDER BY total_pnl DESC
LIMIT 20
```

### 3. Get Recent Trades (Deduplicated)

```sql
SELECT
  event_id,
  any(trader_wallet) as wallet,
  any(side) as side,
  any(token_id) as token_id,
  any(usdc_amount) / 1000000.0 as usdc,
  any(token_amount) / 1000000.0 as shares,
  any(fee_amount) / 1000000.0 as fee,
  any(trade_time) as trade_time,
  any(transaction_hash) as tx_hash
FROM pm_trader_events_v2
WHERE trader_wallet = '0x...'
  AND is_deleted = 0
GROUP BY event_id
ORDER BY any(trade_time) DESC
LIMIT 50
```

### 4. Get Market Details with Resolution

```sql
SELECT
  m.condition_id,
  m.market_id,
  m.slug,
  m.question,
  m.outcomes,
  m.category,
  m.tags,
  m.volume_usdc,
  m.liquidity_usdc,
  m.is_active,
  m.is_closed,
  r.payout_numerators,
  r.payout_denominator,
  r.resolved_at
FROM pm_market_metadata m
LEFT JOIN pm_condition_resolutions r
  ON m.condition_id = r.condition_id
WHERE m.condition_id = '...'
```

### 5. Find Top Markets by Volume

```sql
SELECT
  condition_id,
  market_id,
  slug,
  question,
  category,
  volume_usdc,
  liquidity_usdc,
  is_active,
  is_closed
FROM pm_market_metadata
WHERE is_active = 1
ORDER BY volume_usdc DESC
LIMIT 20
```

### 6. Get Wallet Trading Volume

```sql
SELECT
  trader_wallet,
  COUNT(DISTINCT event_id) as num_trades,
  SUM(usdc) as total_volume_usdc,
  SUM(fee) as total_fees_usdc,
  MIN(trade_time) as first_trade,
  MAX(trade_time) as last_trade
FROM (
  SELECT
    event_id,
    any(trader_wallet) as trader_wallet,
    any(usdc_amount) / 1000000.0 as usdc,
    any(fee_amount) / 1000000.0 as fee,
    any(trade_time) as trade_time
  FROM pm_trader_events_v2
  WHERE trader_wallet = '0x...'
    AND is_deleted = 0
  GROUP BY event_id
)
GROUP BY trader_wallet
```

### 7. Get Market Traders Leaderboard

```sql
SELECT
  trader_wallet,
  SUM(realized_pnl) as total_pnl,
  SUM(trade_count) as num_trades,
  COUNT(DISTINCT condition_id) as num_markets
FROM pm_cascadian_pnl_v1_new
WHERE condition_id = '...'
GROUP BY trader_wallet
ORDER BY total_pnl DESC
LIMIT 50
```

### 8. Get CTF Events for Wallet

```sql
SELECT
  event_type,
  user_address,
  condition_id,
  partition_index_sets,
  toFloat64(amount_or_payout) / 1000000.0 as amount_usdc,
  event_timestamp,
  tx_hash,
  block_number
FROM pm_ctf_events
WHERE user_address = '0x...'
  AND is_deleted = 0
ORDER BY event_timestamp DESC
LIMIT 100
```

### 9. Get Split/Merge Activity for Wallet

```sql
SELECT
  wallet,
  condition_id,
  outcome_index,
  event_type,
  cash_delta,
  shares_delta,
  event_timestamp,
  tx_hash
FROM pm_ctf_split_merge_expanded
WHERE wallet = '0x...'
  AND is_deleted = 0
ORDER BY event_timestamp DESC
LIMIT 100
```

### 10. Map Token ID to Market Info

```sql
SELECT
  t.token_id_dec,
  t.condition_id,
  t.outcome_index,
  m.question,
  m.outcomes,
  m.category
FROM pm_token_to_condition_map_v3 t
LEFT JOIN pm_market_metadata m
  ON t.condition_id = m.condition_id
WHERE t.token_id_dec = '...'
```

### 11. Get Resolved Markets with Payouts

```sql
SELECT
  r.condition_id,
  m.question,
  m.outcomes,
  r.payout_numerators,
  r.payout_denominator,
  r.resolved_at,
  m.volume_usdc
FROM pm_condition_resolutions r
LEFT JOIN pm_market_metadata m
  ON r.condition_id = m.condition_id
WHERE r.is_deleted = 0
ORDER BY r.resolved_at DESC
LIMIT 50
```

### 12. Get Wallet Position Summary

```sql
SELECT
  condition_id,
  outcome_index,
  SUM(usdc_delta) as net_usdc_spent,
  SUM(token_delta) as net_shares_held,
  COUNT(*) as num_transactions,
  MIN(tx_time) as first_tx,
  MAX(tx_time) as last_tx
FROM pm_wallet_condition_ledger_v9
WHERE wallet = '0x...'
  AND is_deleted = 0
GROUP BY condition_id, outcome_index
HAVING ABS(net_shares_held) > 0.01
ORDER BY last_tx DESC
```

### 13. Get Active Markets by Category

```sql
SELECT
  category,
  COUNT(*) as num_markets,
  SUM(volume_usdc) as total_volume,
  AVG(volume_usdc) as avg_volume
FROM pm_market_metadata
WHERE is_active = 1
  AND is_closed = 0
GROUP BY category
ORDER BY total_volume DESC
```

### 14. Get FPMM Pool Trades

```sql
SELECT
  event_id,
  event_type,
  fpmm_pool_address,
  trader_wallet,
  outcome_index,
  side,
  usdc_amount,
  token_amount,
  fee_amount,
  block_number,
  transaction_hash
FROM pm_fpmm_trades
WHERE trader_wallet = '0x...'
  AND is_deleted = 0
ORDER BY block_number DESC
LIMIT 50
```

### 15. Get USDC Flow Events

```sql
SELECT
  tx_hash,
  log_index,
  from_address,
  to_address,
  amount_usdc,
  flow_type,
  block_number
FROM pm_erc20_usdc_flows
WHERE from_address = '0x...' OR to_address = '0x...'
  AND is_deleted = 0
ORDER BY block_number DESC
LIMIT 100
```

---

## Deduplication Pattern (CRITICAL)

**ALWAYS use this pattern for `pm_trader_events_v2`:**

```sql
SELECT ... FROM (
  SELECT
    event_id,
    any(trader_wallet) as trader_wallet,
    any(side) as side,
    any(token_id) as token_id,
    any(usdc_amount) / 1000000.0 as usdc,
    any(token_amount) / 1000000.0 as tokens,
    any(fee_amount) / 1000000.0 as fee,
    any(trade_time) as trade_time,
    any(transaction_hash) as tx_hash,
    any(block_number) as block_number
  FROM pm_trader_events_v2
  WHERE is_deleted = 0
    [AND your_filters_here]
  GROUP BY event_id
) deduped
WHERE [additional_filters]
ORDER BY trade_time DESC
```

**Why:** Table uses SharedMergeTree, historical duplicates exist (2-3x per wallet). GROUP BY event_id ensures accurate counts/sums.

---

## Unit Conversions

| Field | Raw Unit | Display Unit | Conversion |
|-------|----------|--------------|------------|
| usdc_amount | Raw (6 decimals) | USDC | `/ 1000000.0` |
| token_amount | Raw (6 decimals) | Shares | `/ 1000000.0` |
| fee_amount | Raw (6 decimals) | USDC | `/ 1000000.0` |
| amount_or_payout | String (raw) | USDC | `toFloat64(...) / 1000000.0` |
| value (ERC1155) | Hex string | Shares | `reinterpretAsUInt256(unhex(...)) / 1e6` |

---

## Array Access Patterns

**Remember: ClickHouse arrays are 1-indexed**

```sql
-- Get outcome label for outcome_index 0
SELECT arrayElement(outcomes, outcome_index + 1) as outcome_label
FROM pm_market_metadata
WHERE condition_id = '...'
```

```sql
-- Get payout for outcome_index 1
SELECT arrayElement(payout_numerators, outcome_index + 1) as payout
FROM pm_condition_resolutions
WHERE condition_id = '...'
```

---

## Performance Tips

1. **Always filter on sort key columns first** (e.g., trader_wallet, condition_id)
2. **Use PREWHERE for initial filtering** on large tables
3. **Avoid `SELECT *`** - specify only needed columns
4. **Use `LIMIT`** for exploratory queries
5. **Check query plans** with `EXPLAIN` if slow

Example with PREWHERE:
```sql
SELECT
  event_id,
  any(usdc_amount) / 1000000.0 as usdc
FROM pm_trader_events_v2
PREWHERE trader_wallet = '0x...'  -- Fast filter on sort key
WHERE is_deleted = 0              -- Additional filter
GROUP BY event_id
```

---

## Related Documentation

- **Database Audit Summary:** [DATABASE_AUDIT_SUMMARY.md](./DATABASE_AUDIT_SUMMARY.md)
- **Full Audit Report:** [COMPLETE_DATABASE_AUDIT.txt](./COMPLETE_DATABASE_AUDIT.txt)
- **PnL System:** [docs/READ_ME_FIRST_PNL.md](../../READ_ME_FIRST_PNL.md)
- **Stable Pack Reference:** [STABLE_PACK_REFERENCE.md](./STABLE_PACK_REFERENCE.md)

---

**Last Updated:** 2025-11-29
