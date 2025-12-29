# Unified PnL Engine Specification

**Date:** 2025-11-28
**Status:** Design Phase

## Overview

Calculate realized PnL matching Polymarket's official numbers using multiple data sources.

## Data Sources

### 1. CLOB Trades (pm_trader_events_v2)
- Buy/sell orders on the Central Limit Order Book
- Contains: trader_wallet, token_id, side (buy/sell), usdc_amount, token_amount
- **Issue:** Requires GROUP BY event_id for deduplication

### 2. ERC1155 Transfers (pm_erc1155_transfers)
- Token transfers between wallets
- Contains: from_address, to_address, token_id, value, block_timestamp
- **Use:** Track token acquisition/disposition not visible in CLOB

### 3. CTF Events (pm_ctf_events)
- PayoutRedemption: Wallet redeems winning tokens for USDC
- PositionSplit/Merge: Minting/burning (attributed to Exchange, not users)
- Contains: user_address, event_type, amount_or_payout, condition_id

### 4. Condition Resolutions (pm_condition_resolutions)
- Winning outcome for each condition
- Contains: condition_id, payout_numerators (e.g., "[1,0]")

### 5. Token Mapping (pm_token_to_condition_map_v3)
- Maps token_id to condition_id + outcome_index
- **Critical:** token_id can be hex or decimal

## PnL Formula

For a wallet's realized PnL on a RESOLVED market:

```
Realized PnL = (total_usdc_received - total_usdc_spent) + (final_tokens × payout_price)
```

Where:
- **total_usdc_received** = CLOB sells + PayoutRedemptions
- **total_usdc_spent** = CLOB buys + CTF minting costs (via ERC1155 analysis)
- **final_tokens** = net token balance at resolution
- **payout_price** = 1.0 if winning outcome, 0.0 if losing

## Token Balance Calculation

For each token_id:

```sql
token_balance =
  + ERC1155 transfers IN (to_address = wallet)
  - ERC1155 transfers OUT (from_address = wallet)
  + CLOB buys
  - CLOB sells
```

**Key Insight:** If CLOB shows negative net tokens (sold without buying), user acquired via:
1. ERC1155 transfer IN from another wallet/exchange
2. CTF minting (which will show as transfer from 0x0 address)

## Implementation Steps

### Step 1: Token Flow View
Create a view that combines CLOB + ERC1155 for net token positions:

```sql
CREATE VIEW vw_wallet_token_flows AS
WITH
-- CLOB trades
clob_flows AS (
  SELECT
    trader_wallet as wallet,
    token_id,
    SUM(CASE WHEN side = 'buy' THEN token_amount ELSE -token_amount END) as clob_net_tokens,
    SUM(CASE WHEN side = 'buy' THEN -usdc_amount ELSE usdc_amount END) as clob_net_usdc
  FROM (
    SELECT event_id, any(trader_wallet) as trader_wallet, any(token_id) as token_id,
           any(side) as side, any(token_amount) as token_amount, any(usdc_amount) as usdc_amount
    FROM pm_trader_events_v2 WHERE is_deleted = 0
    GROUP BY event_id
  )
  GROUP BY trader_wallet, token_id
),
-- ERC1155 transfers (convert hex value to decimal)
erc1155_flows AS (
  SELECT
    wallet,
    token_id,
    SUM(direction * value_dec) as erc1155_net_tokens
  FROM (
    SELECT
      CASE WHEN to_address != '0x0000000000000000000000000000000000000000' THEN to_address ELSE '' END as wallet,
      1 as direction,
      token_id,
      reinterpretAsUInt256(unhex(substring(value, 3))) as value_dec
    FROM pm_erc1155_transfers WHERE to_address != ''
    UNION ALL
    SELECT
      from_address as wallet,
      -1 as direction,
      token_id,
      reinterpretAsUInt256(unhex(substring(value, 3))) as value_dec
    FROM pm_erc1155_transfers WHERE from_address != '0x0000000000000000000000000000000000000000'
  )
  GROUP BY wallet, token_id
)
SELECT
  COALESCE(c.wallet, e.wallet) as wallet,
  COALESCE(c.token_id, e.token_id) as token_id,
  COALESCE(c.clob_net_tokens, 0) as clob_net_tokens,
  COALESCE(c.clob_net_usdc, 0) as clob_net_usdc,
  COALESCE(e.erc1155_net_tokens, 0) as erc1155_net_tokens
FROM clob_flows c
FULL OUTER JOIN erc1155_flows e ON c.wallet = e.wallet AND c.token_id = e.token_id
```

### Step 2: Resolve and Calculate PnL

```sql
CREATE VIEW vw_realized_pnl_unified AS
WITH token_positions AS (
  SELECT * FROM vw_wallet_token_flows
),
with_mapping AS (
  SELECT t.*, m.condition_id, m.outcome_index
  FROM token_positions t
  JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
),
with_resolution AS (
  SELECT w.*, r.payout_numerators
  FROM with_mapping w
  LEFT JOIN pm_condition_resolutions r ON lower(w.condition_id) = lower(r.condition_id)
  WHERE r.payout_numerators IS NOT NULL
),
with_payout AS (
  SELECT
    *,
    arrayElement(JSONExtract(payout_numerators, 'Array(Float64)'), outcome_index + 1) as payout_price
  FROM with_resolution
)
SELECT
  wallet,
  condition_id,
  outcome_index,
  clob_net_usdc as cash_flow,
  clob_net_tokens + erc1155_net_tokens as final_tokens,
  payout_price,
  clob_net_usdc + ((clob_net_tokens + erc1155_net_tokens) * payout_price) as realized_pnl
FROM with_payout
```

## Validation Test Cases

### W1 (0x9d36c904930a7d06c5403f9e16996e919f586486)
- Expected (API): +$12,298.89
- CLOB-only calc: -$17,543.75
- Archive: -$6,138.89

### W2 (TBD)
- Needs API lookup

## Known Issues

1. **Token ID formats:** Need to handle both hex and decimal in joins
2. **Value encoding:** ERC1155 value is hex string, needs conversion
3. **Zero address filtering:** Mints come from 0x0, burns go to 0x0
4. **Exchange contract:** Most mints go through Exchange, need to trace

## Files

- `migrate-erc1155-transfers.ts` - Copies ERC1155 data from old DB
- `calculate-w1-market-pnl.ts` - CLOB-only calculation (for reference)
- `build-pnl-unified.ts` - To be created

---

*Design Phase - Implementation after ERC1155 migration completes*
