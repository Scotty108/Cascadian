# PnL V7: Proxy CTF Discovery Specification

**Date:** 2025-11-28 (Session 12)
**Status:** DESIGN DOCUMENT
**Parent Document:** [PNL_V6_UNIFIED_SPEC.md](./PNL_V6_UNIFIED_SPEC.md)

---

## Problem Statement

The V7 PnL engine has a blind spot: **wallets that mint tokens via proxy contracts or intermediary mechanisms**.

### Evidence (W1: 0x9d36c904...)

| Observation | Data |
|-------------|------|
| API Realized PnL | +$12,298.89 |
| V7 Realized PnL | -$3,774.93 |
| Variance | $16,073.81 (130%) |
| CTF USDC Flows | **$0** (completely absent) |
| CLOB Tokens Sold Without Corresponding Buys | YES |

### Root Cause Analysis

W1 sells tokens on CLOB that it never bought on CLOB. This means the tokens were acquired via:
1. **Direct CTF minting** - But no USDC flows to CTF contract in our data
2. **Proxy contract minting** - A smart contract mints on behalf of the user
3. **Wallet-to-wallet transfer** - Someone sent tokens to W1
4. **Off-chain acquisition** - Tokens acquired via another exchange

The current `pm_erc20_usdc_flows` table only captures **direct** USDC transfers where:
- `from_address` = User wallet, `to_address` = CTF contract (deposit)
- `from_address` = CTF contract, `to_address` = User wallet (payout)

It misses proxy patterns where an intermediary contract handles the USDC flow.

---

## Data Sources Available

### 1. pm_erc20_usdc_flows (Current)

**Coverage:** Direct USDC ↔ CTF contract flows only

```sql
-- Current capture
SELECT * FROM pm_erc20_usdc_flows
WHERE (from_address = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045'  -- CTF payout
   OR to_address = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045')   -- CTF deposit
```

**Limitation:** Misses proxy contracts that interact with CTF on behalf of users.

### 2. pm_erc1155_transfers (Available)

**Coverage:** All ERC1155 token movements

```sql
-- Token minting events (from zero address)
SELECT * FROM pm_erc1155_transfers
WHERE from_address = '0x0000000000000000000000000000000000000000'
  AND to_address = {user_wallet}
```

**Potential:** Can detect when tokens are minted TO a user wallet, even if USDC went through a proxy.

### 3. pm_ctf_events (Available)

**Coverage:** Condition Token Framework events

| Event Type | Purpose |
|------------|---------|
| `PositionSplit` | Token minting from collateral |
| `PositionMerge` | Token burning for collateral |
| `PayoutRedemption` | Winning token redemption |

```sql
-- Check for minting events
SELECT * FROM pm_ctf_events
WHERE event_type = 'PositionSplit'
  AND user_address = {user_wallet}
```

**Note:** Need to verify `user_address` field semantics - may show proxy contract, not end user.

### 4. Raw USDC Transfer Logs (Not Currently Available)

We could expand our ingestion to capture ALL USDC transfers (not just CTF-related) and then identify proxy patterns:

```
User → Proxy → CTF contract (deposit)
CTF contract → Proxy → User (payout)
```

This requires additional Goldsky pipeline work.

---

## Inference Approach

### Strategy 1: ERC1155 Minting Detection

If a wallet receives ERC1155 tokens from the zero address (mint), we can infer CTF minting occurred.

```sql
-- Infer CTF deposits from ERC1155 mints
WITH minted_tokens AS (
  SELECT
    to_address AS wallet,
    token_id,
    value AS tokens_minted,
    block_number
  FROM pm_erc1155_transfers
  WHERE from_address = '0x0000000000000000000000000000000000000000'
)
SELECT
  wallet,
  SUM(tokens_minted) AS total_tokens_minted
FROM minted_tokens
GROUP BY wallet
```

**Limitation:** We don't know the USDC cost of minting without correlating to USDC flows.

**Assumption:** For binary markets, minting 1 token of each outcome costs $1 USDC.

```sql
-- Inferred CTF deposit = tokens_minted (for binary markets)
-- Each mint creates 1 YES + 1 NO token for $1 USDC
inferred_ctf_deposit = tokens_minted_yes / 1  -- or tokens_minted_no
```

### Strategy 2: CLOB Position Imbalance Detection

If a wallet has net sells on CLOB without corresponding buys, the tokens came from elsewhere:

```sql
WITH clob_flows AS (
  SELECT
    wallet,
    token_id,
    SUM(CASE WHEN side = 'buy' THEN tokens ELSE 0 END) AS bought,
    SUM(CASE WHEN side = 'sell' THEN tokens ELSE 0 END) AS sold
  FROM clob_deduped
  GROUP BY wallet, token_id
)
SELECT
  wallet,
  token_id,
  bought,
  sold,
  sold - bought AS tokens_from_external_source
FROM clob_flows
WHERE sold > bought  -- Sold more than bought = external acquisition
```

This tells us the wallet acquired tokens outside CLOB, but not the cost.

### Strategy 3: Proxy Contract Identification

Identify known proxy patterns and trace the USDC flows:

**Known Proxy Contracts:**
- Exchange contract: `0xd91e80cf2e7be2e162c6513ced06f1dd0da35296`
- (Others TBD - need to analyze common patterns)

```sql
-- Find proxy contracts that interact with CTF
SELECT DISTINCT
  CASE
    WHEN to_address = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045'
    THEN from_address
    ELSE to_address
  END AS potential_proxy
FROM pm_erc20_usdc_flows
WHERE from_address != '0x4d97dcd97ec945f40cf65f87097ace5ea0476045'
  AND to_address != '0x4d97dcd97ec945f40cf65f87097ace5ea0476045'
-- Then analyze transaction traces for these addresses
```

---

## Schema Sketch

### Option A: Inferred CTF Flows Table

```sql
CREATE TABLE pm_ctf_flows_inferred (
  wallet LowCardinality(String),
  condition_id String,
  outcome_index UInt8,
  inferred_deposit_usdc Float64,  -- From ERC1155 minting
  inferred_payout_usdc Float64,   -- From ERC1155 burning to zero
  confidence Enum8('high' = 1, 'medium' = 2, 'low' = 3),
  source Enum8('erc1155_mint' = 1, 'clob_imbalance' = 2, 'proxy_trace' = 3)
) ENGINE = ReplacingMergeTree()
ORDER BY (wallet, condition_id, outcome_index)
```

### Option B: Enhanced V7 View with Inference

```sql
CREATE VIEW vw_realized_pnl_v7_enhanced AS
WITH
-- Existing CLOB + CTF flows
...,

-- Inferred minting from ERC1155
inferred_minting AS (
  SELECT
    to_address AS wallet,
    token_id,
    SUM(value) / 1000000.0 AS tokens_minted
  FROM pm_erc1155_transfers
  WHERE from_address = '0x0000000000000000000000000000000000000000'
  GROUP BY to_address, token_id
),

-- Join to get inferred USDC cost
with_inferred_deposit AS (
  SELECT
    im.wallet,
    m.condition_id,
    im.tokens_minted AS inferred_deposit_usdc  -- $1 per token pair
  FROM inferred_minting im
  INNER JOIN pm_token_to_condition_map_v3 m ON im.token_id = m.token_id_dec
)

-- Include in final calculation
SELECT
  ...,
  COALESCE(id.inferred_deposit_usdc, 0) AS inferred_ctf_deposit,
  realized_pnl_v7 - COALESCE(id.inferred_deposit_usdc, 0) AS realized_pnl_v7_enhanced
FROM ...
LEFT JOIN with_inferred_deposit id ON ...
```

---

## Validation Plan

### Step 1: Validate ERC1155 Minting Detection

For W1, check if ERC1155 minting events explain the missing tokens:

```sql
SELECT
  to_address AS wallet,
  token_id,
  SUM(value) / 1000000.0 AS tokens_minted
FROM pm_erc1155_transfers
WHERE to_address = '0x9d36c904930a7d06c5403f9e16996e919f586486'
  AND from_address = '0x0000000000000000000000000000000000000000'
GROUP BY to_address, token_id
```

Expected: Should find minting events for tokens W1 sold but never bought on CLOB.

### Step 2: Validate Inferred Cost Assumption

For binary markets:
- User deposits $X USDC
- User receives X YES tokens + X NO tokens
- Inferred deposit = tokens_minted

```
If W1 minted 1000 YES + 1000 NO tokens, cost was $1000 USDC
```

Validate by comparing inferred cost to CLOB sell proceeds:
- W1 sells 1000 NO tokens for $300 USDC (at $0.30)
- W1 holds 1000 YES tokens
- If YES wins: payout = $1000
- PnL = -$1000 (deposit) + $300 (NO sell) + $1000 (YES payout) = +$300

### Step 3: Cross-Validate with API

After implementing inference, compare enhanced V7 against API for wallets known to have CTF activity.

---

## Known Limitations

### 1. Multi-Outcome Markets

For markets with >2 outcomes, the minting cost is NOT 1:1 with tokens. Need market-specific collateral ratios.

### 2. Proxy Contract Variety

Many proxy patterns exist. We may never capture all of them without full transaction tracing.

### 3. Off-Chain Acquisitions

If tokens were acquired on another exchange and transferred on-chain, we cannot determine the cost basis.

### 4. Confidence Levels

Inferred values will always be lower confidence than direct USDC flow observations.

---

## Recommendation

### Phase 1: Ship CLOB-Only as Production

The CLOB engine is validated and correct for CLOB-only wallets. Ship it as the primary metric with clear documentation.

### Phase 2: Add Inference Layer (Experimental)

Build `pm_ctf_flows_inferred` table using ERC1155 minting detection. Flag as "enhanced" and expose via separate endpoint.

### Phase 3: Proxy Contract Discovery

Analyze top wallets with large CLOB imbalances to identify common proxy contracts. Add explicit support for known patterns.

### Phase 4: Full USDC Tracing (Future)

Expand Goldsky pipeline to capture ALL USDC transfers. Build transaction graph to trace proxy flows.

---

## Files

| File | Purpose |
|------|---------|
| `scripts/pnl/infer-ctf-minting.ts` | (TO CREATE) ERC1155 minting analysis |
| `scripts/pnl/detect-clob-imbalance.ts` | (TO CREATE) Find wallets with external token acquisition |
| `scripts/pnl/create-inferred-ctf-table.ts` | (TO CREATE) Build inferred CTF flows |

---

*Signed: Claude Code Terminal - Session 12*
