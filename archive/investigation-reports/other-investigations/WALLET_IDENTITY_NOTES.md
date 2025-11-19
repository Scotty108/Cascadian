# Wallet Identity Notes - Track B

**Date:** 2025-11-12
**Status:** B1.2 Complete

## Discovered Wallet Columns

### Primary Tables

#### `clob_fills` (Main trading table)
- **`proxy_wallet`** (String): Proxy contract address that executes trades
- **`user_eoa`** (String): Externally owned account (actual user wallet)

#### `pm_user_proxy_wallets_v2` (Mapping table)
- **`user_eoa`** (String): User's EOA address
- **`proxy_wallet`** (String): Associated proxy wallet address
- **Purpose:** Explicit mapping between EOA and proxy wallets

#### `erc1155_transfers` (Blockchain events)
- **`from_address`** (String): Source address for token transfers
- **`to_address`** (String): Destination address for token transfers

### Secondary Tables

Multiple position/aggregation tables use a generic **`wallet`** column:
- `outcome_positions_v2`
- `outcome_positions_v3`
- `trades_raw`
- Various views (`vw_wallet_*`)

---

## Polymarket Data API Semantics

### Data API `/positions` Endpoint

**Example:**
```
https://data-api.polymarket.com/positions?user=0xcce2b7c71f21e358b8e5e797e586cbc03160d58b
```

**Response structure:**
```json
{
  "proxyWallet": "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b",
  "asset": "...",
  "conditionId": "...",
  "size": 69982.788569,
  "avgPrice": 0.906546,
  "realizedPnl": -41.784348,
  ...
}
```

### Key Findings from Polymarket Docs

1. **`user` query parameter:**
   - Accepts the proxy wallet address
   - This is the "canonical" user identity from Polymarket's perspective

2. **`proxyWallet` field in response:**
   - Always matches the `user` parameter
   - This is how Polymarket identifies users across positions and trades

3. **Proxy Wallet System:**
   - Polymarket uses proxy contracts for trading
   - Users interact via their EOA, but trades execute via proxy
   - The proxy wallet is the primary key for user identity in their system

---

## Canonical Wallet Decision

### Analysis

**Option 1: Use `user_eoa`**
- ❌ Pro: True user ownership
- ❌ Con: Doesn't match Polymarket's Data API semantics
- ❌ Con: May have 1-to-many relationship with proxies

**Option 2: Use `proxy_wallet`** ✅
- ✅ Pro: Matches Polymarket Data API's `proxyWallet` field
- ✅ Pro: Consistent with how Polymarket aggregates positions and P&L
- ✅ Pro: Available in `clob_fills` table
- ✅ Pro: Explicit mapping table exists (`pm_user_proxy_wallets_v2`)

### Decision

**Canonical wallet = `proxy_wallet`**

**Reasoning:**
1. Polymarket's Data API uses `proxyWallet` as the user identity
2. For Track B validation, we need to match their semantics exactly
3. The `/positions?user={address}` endpoint expects a proxy wallet address
4. Our `clob_fills` table already has `proxy_wallet` column

---

## Mapping Strategy

### For Track B Validation

When querying for user-level data:

```sql
-- Primary method: Use proxy_wallet directly
SELECT *
FROM clob_fills
WHERE proxy_wallet = '0x...'
```

### Fallback Logic

If `proxy_wallet` is NULL or empty:
```sql
-- Fallback to user_eoa
SELECT *
FROM clob_fills
WHERE proxy_wallet = '0x...' OR user_eoa = '0x...'
```

### Explicit Mapping

Use `pm_user_proxy_wallets_v2` to understand EOA ↔ Proxy relationships:
```sql
SELECT
  user_eoa,
  proxy_wallet,
  COUNT(*) as fills
FROM clob_fills
GROUP BY user_eoa, proxy_wallet
```

---

## Remaining Uncertainties

### 1. Proxy Wallet Uniqueness
- **Question:** Can one user_eoa have multiple proxy_wallets?
- **Impact:** Low - we follow Polymarket's lead and use proxy as canonical
- **Resolution:** Check `pm_user_proxy_wallets_v2` for 1-to-many relationships

### 2. Historical Data Consistency
- **Question:** Are proxy_wallet values consistently populated in older fills?
- **Impact:** Medium - may need fallback logic for old data
- **Resolution:** Run coverage check on proxy_wallet NULL rate by date

### 3. Edge Cases
- **Question:** Do system wallets (market makers, liquidity providers) use proxies?
- **Impact:** Low - will identify in B2.2 system wallet detection
- **Resolution:** Heuristic analysis in next step

---

## B1 Status Summary

✅ **Completed:**
- Discovered all wallet-related columns across 15+ tables
- Identified primary columns: `proxy_wallet`, `user_eoa`
- Researched Polymarket Data API semantics
- Made canonical wallet decision: **proxy_wallet**

✅ **Decision:** Use `proxy_wallet` as canonical wallet identity for Track B

📋 **Next Steps:**
- B2.1: Build `wallet_identity_map` table
- B2.2: Detect system wallets
- B3: Build Track B wallet fixture

---

_— Claude 2
Track B - Wallet Identity & Attribution Validation
Session: 2025-11-12 (PST)_
