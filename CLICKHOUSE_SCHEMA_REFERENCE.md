# ClickHouse Schema Reference

## trades_raw (159,574,259 rows)

### Core Identifiers
- `trade_id` (String) - Unique trade identifier
- `wallet_address` (String) - Trader wallet address
- `market_id` (String) - Polymarket ID (note: 1.26M nulls/zeros)
- `condition_id` (String) - Condition ID for resolution
- `transaction_hash` (String) - Ethereum transaction hash

### Temporal
- `timestamp` (DateTime) - Trade execution time
- `created_at` (DateTime) - Record creation time
- `tx_timestamp` (DateTime) - Transaction timestamp

### Position Data
- `side` (Enum8: YES=1, NO=2) - Position side
- `outcome` (Nullable(Int8)) - Outcome index (NULL for open)
- `outcome_index` (Int16) - Outcome index
- `shares` (Decimal(18,8)) - Shares traded
- `entry_price` (Decimal(18,8)) - Entry price
- `exit_price` (Nullable(Decimal(18,8))) - Exit price (NULL if open)
- `close_price` (Decimal(10,6)) - Closing price

### Valuation
- `usd_value` (Decimal(18,2)) - USD trade value
- `pnl` (Nullable(Decimal(18,2))) - P&L in USD (NULL if open)
- `pnl_gross` (Decimal(18,6)) - Gross P&L
- `pnl_net` (Decimal(18,6)) - Net P&L
- `realized_pnl_usd` (Float64) - Realized P&L
- `return_pct` (Decimal(10,6)) - Return percentage

### Costs
- `fee_usd` (Decimal(18,6)) - Trading fees
- `slippage_usd` (Decimal(18,6)) - Price slippage cost

### Status
- `is_closed` (Bool) - Position closed flag
- `is_resolved` (UInt8) - Market resolved flag
- `resolved_outcome` (LowCardinality(String)) - Outcome if resolved
- `was_win` (Nullable(UInt8)) - Win flag (NULL if unresolved)

### Metadata
- `canonical_category` (String) - Market category
- `raw_tags` (Array(String)) - Tags array
- `recovery_status` (String) - Data recovery status
- `bankroll_at_entry` (Decimal(18,2)) - Wallet balance at entry
- `fair_price_at_entry` (Decimal(10,6)) - Fair value at entry
- `hours_held` (Decimal(10,2)) - Hours position held

---

## vw_trades_canonical (157,541,131 rows)

Cleaned view of trades_raw with direction inference.

### Key Differences from trades_raw
- Removes ~2M duplicate/anomalous records
- Adds direction inference columns
- Removes some PnL columns (use trades_raw for full data)

### Direction Columns
- `trade_direction` (Enum8: BUY=1, SELL=2, UNKNOWN=3) - Inferred trade direction
- `direction_confidence` (Enum8: HIGH=1, MEDIUM=2, LOW=3) - Direction confidence
- `direction_method` (String) - How direction was inferred

### Normalized Columns
- `wallet_address_norm` (String) - Normalized wallet address
- `market_id_norm` (String) - Normalized market ID
- `condition_id_norm` (String) - Normalized condition ID
- `outcome_token` (Enum8: YES=1, NO=2) - Outcome token

---

## trades_with_pnl (515,708 rows)

Resolved trades with complete P&L data.

### Coverage
- **Wallets:** 42,798 (only those with resolved trades)
- **Markets:** 33,817 (only those with resolved outcomes)
- **Date Range:** 2024-01-06 to 2025-10-31

### Schema
Subset of trades_raw including:
- All core identifiers (trade_id, wallet_address, market_id, etc.)
- Direction data (direction, direction_confidence)
- P&L data (pnl_usd, was_win)
- Resolution data (is_resolved, resolved_outcome, resolved_at)
- computed_at (DateTime) - When P&L was computed

---

## vw_trades_canonical_v2 (515,682 rows)

P&L view variant with additional transfer-based metrics.

### Unique Columns
- `usdc_out_net` (Float64) - Net USDC outflow
- `usdc_in_net` (UInt8) - Net USDC inflow
- `tokens_in_net` (UInt256) - Net tokens in
- `tokens_out_net` (UInt8) - Net tokens out

---

## trade_direction_assignments (129,599,951 rows)

Direction inference mapping table (enrichment).

### Schema
- `tx_hash` (String) - Transaction hash
- `wallet_address` (String) - Wallet address
- `condition_id_norm` (String) - Condition ID
- `direction` (Enum8: BUY=1, SELL=2, UNKNOWN=3)
- `confidence` (Enum8: HIGH=1, MEDIUM=2, LOW=3)
- `usdc_out` (Float64) - USDC spent
- `usdc_in` (Float64) - USDC received
- `tokens_out` (UInt256) - Tokens sold
- `tokens_in` (UInt256) - Tokens bought
- `has_both_legs` (Bool) - Has buy and sell
- `reason` (String) - Assignment method
- `created_at` (DateTime) - Computed time

### Note
All rows have created_at = 2025-11-05 22:57:25 (single batch computation)

---

## trades_with_direction (82,138,586 rows)

Trades with direction inference and confidence.

### Schema
- Core fields from trades_raw
- `tx_hash` (String) - Transaction hash
- `side_token` (String) - Token position side
- `direction_from_transfers` (String) - Inferred direction
- `price` (Decimal(18,8)) - Trade price
- `confidence` (String) - Confidence level
- `reason` (String) - Inference method
- `computed_at` (DateTime) - When computed (2025-11-05 20:49:24)

---

## trades_with_recovered_cid (82,138,586 rows)

Trades with recovered condition IDs.

### Key Feature
- Recovered condition IDs for trades that previously had NULL values
- Same row count as trades_with_direction
- Maintains original timestamp range (2022-12-18 to 2025-10-31)

---

## market_candles_5m (8,051,265 rows)

5-minute OHLCV candles for all markets.

### Coverage
- **Markets:** 151,846 (100% match with trades_raw)
- **Granularity:** 5-minute buckets
- **Buckets:** ~8M total rows

### Typical Columns
- market_id (String)
- timestamp/time (DateTime)
- open (Decimal)
- high (Decimal)
- low (Decimal)
- close (Decimal)
- volume (Decimal)

---

## Reference Tables

### market_resolutions_final (223,973 rows)
Market outcomes and resolution data.

### market_key_map (156,952 rows)
Mapping between market identifiers and keys.

### condition_market_map (151,843 rows)
Mapping between condition IDs and market IDs.

### gamma_markets (149,907 rows)
Gamma protocol markets catalog.

### markets_dim (5,781 rows)
Market dimension reference table.

---

## Data Quality Notes

### Known Issues
1. **Null market_id:** 1,257,929 rows (0.79%) have NULL or '0x00...' market IDs
2. **Duplicates:** High-frequency duplicates in market_id='12' entries (204+ occurrences)
3. **Null outcomes:** 96.68% of trades have NULL pnl (expected for open positions)
4. **Partial coverage:** trades_with_pnl covers only 0.32% of trades (resolved subset)

### Quality Strengths
- Zero null wallet_address values
- Zero null transaction_hash values
- Perfect market_id coverage in market_candles_5m
- Complete timestamp coverage from Dec 2022

---

## Index/Query Optimization

### Primary Key Candidates
- trades_raw: (wallet_address, timestamp, transaction_hash)
- trades_with_pnl: (wallet_address, resolved_outcome, timestamp)

### Recommended Filters
```sql
-- For wallet analysis
WHERE wallet_address = '0x...'
  AND timestamp >= '2024-01-01'
  AND market_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
  AND market_id IS NOT NULL

-- For resolved trades only
WHERE is_resolved = 1
  AND resolved_outcome IS NOT NULL

-- For recent data
WHERE timestamp >= '2025-01-01'
```

