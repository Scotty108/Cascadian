# Wallet Address Fields - Technical Reference

## Complete Field-by-Field Inventory

### PRIMARY WALLET IDENTIFIER PATTERN

#### wallet_address (10 occurrences - PRIMARY)
- **Tables**: wallets_dim, wallet_metrics, wallet_metrics_complete, wallet_resolution_outcomes, wallet_metrics_by_category, wallet_metrics_daily, trades_raw, elite_trade_attributions, pm_trades_external, erc1155_transfers_enriched (via to_addr alias)
- **Type**: String
- **Format**: 0x-prefixed 40-character hex (Ethereum address)
- **Case**: lowercase
- **Nullable**: No
- **Indexed**: Yes (PRIMARY KEY or bloom_filter in most tables)
- **Source**: Direct from blockchain or API
- **Semantics**: EOA or proxy contract that initiated the transaction
- **Example**: 0x1234567890abcdef1234567890abcdef12345678
- **Constraint**: Always lowercase, always 42 chars (0x + 40 hex)
- **Canonicalization**: ALREADY STANDARDIZED

---

### ORDER BOOK (CLOB) SPECIFIC PATTERNS

#### maker_address (pm_trades)
- **Type**: String
- **Format**: 0x-prefixed lowercase
- **Indexed**: bloom_filter(0.01)
- **Semantics**: The wallet that placed the limit order being filled
- **Source**: Polymarket CLOB API
- **Relationship**: Could be proxy or EOA
- **Join with**: pm_user_proxy_wallets via proxy_wallet field
- **Notes**: Different from wallet_address pattern (uses maker/taker split)
- **Example Query**:
```sql
SELECT p.maker_address, pw.user_eoa, COUNT(*) as orders
FROM pm_trades p
LEFT JOIN pm_user_proxy_wallets pw ON lower(p.maker_address) = lower(pw.proxy_wallet)
GROUP BY p.maker_address, pw.user_eoa
```

#### taker_address (pm_trades)
- **Type**: String
- **Format**: 0x-prefixed lowercase
- **Indexed**: bloom_filter(0.01)
- **Semantics**: The wallet that accepted the limit order
- **Source**: Polymarket CLOB API
- **Relationship**: Could be proxy or EOA
- **Join with**: pm_user_proxy_wallets via proxy_wallet field
- **Notes**: Market taker may be trader or AMM
- **Example Query**:
```sql
SELECT p.taker_address, COUNT(*) as fills
FROM pm_trades p
WHERE p.timestamp >= now() - interval 30 day
GROUP BY p.taker_address
ORDER BY fills DESC LIMIT 50
```

---

### ERC1155 TRANSFER PATTERNS

#### from_addr (erc1155_transfers_enriched)
- **Type**: String
- **Format**: 0x-prefixed lowercase
- **Semantics**: Token sender in ERC1155 TransferSingle/TransferBatch event
- **Source**: Blockchain (Polymarket CTF Exchange contract)
- **Special Cases**:
  - 0x0000... (burn address) = minting
  - Proxy contract = EOA can be found in pm_user_proxy_wallets
- **Decoded Field**: from_eoa (pulled via proxy mapping)
- **Related Field**: from_type ('proxy' or 'direct')
- **Example Query**:
```sql
SELECT from_addr, from_eoa, COUNT(*) as transfers
FROM erc1155_transfers_enriched
WHERE from_type = 'proxy'
GROUP BY from_addr, from_eoa
ORDER BY transfers DESC
```

#### to_addr (erc1155_transfers_enriched)
- **Type**: String
- **Format**: 0x-prefixed lowercase
- **Semantics**: Token recipient in ERC1155 transfer
- **Source**: Blockchain (Polymarket CTF Exchange contract)
- **Special Cases**:
  - 0x0000... (burn address) = redemption
  - Proxy contract = EOA can be found in pm_user_proxy_wallets
- **Decoded Field**: to_eoa (pulled via proxy mapping)
- **Related Field**: to_type ('proxy' or 'direct')
- **Aggregated In**: wallet_positions_current (aliased as `wallet`)
- **Example Query**:
```sql
SELECT to_addr AS wallet_holder, SUM(amount) as total_tokens
FROM erc1155_transfers_enriched
WHERE event_type = 'TransferSingle' AND to_addr != '0x0000000000000000000000000000000000000000'
GROUP BY wallet_holder
ORDER BY total_tokens DESC
```

---

### PROXY RELATIONSHIP PATTERNS

#### user_eoa (pm_user_proxy_wallets)
- **Type**: String
- **Format**: 0x-prefixed lowercase
- **Semantics**: The Externally Owned Account (true owner) that controls proxy
- **Source**: Discovered via:
  - Approve events (proxy approval signatures)
  - Transfer analysis (first trader through proxy)
  - External inference
- **Cardinality**: 1-to-many (one EOA can have multiple proxies)
- **Indexed**: PRIMARY KEY (paired with proxy_wallet)
- **Status Field**: is_active (0/1)
- **Timeline**: first_seen_at, last_seen_at
- **Example Query**:
```sql
SELECT user_eoa, COUNT(*) as proxy_count
FROM pm_user_proxy_wallets
WHERE is_active = 1
GROUP BY user_eoa
HAVING COUNT(*) > 1
ORDER BY proxy_count DESC
```

#### proxy_wallet (pm_user_proxy_wallets)
- **Type**: String
- **Format**: 0x-prefixed lowercase
- **Semantics**: Smart contract proxy that operates on behalf of user_eoa
- **Source**: Discovered via blockchain analysis
- **Common Proxies**: SafeProxy, Gnosis Safe, custom implementations
- **Relationship**: Typically 1-to-1 with user_eoa (but can be 1-to-many)
- **Indexed**: PRIMARY KEY (paired with user_eoa)
- **Join Pattern**: JOIN pm_user_proxy_wallets ON lower(from_addr) = lower(proxy_wallet)
- **Example Query**:
```sql
SELECT proxy_wallet, user_eoa, first_seen_at, last_seen_at
FROM pm_user_proxy_wallets
WHERE is_active = 1
ORDER BY first_seen_at DESC
```

---

### EXTERNAL SOURCE PATTERNS

#### wallet_address (pm_trades_external)
- **Type**: String
- **Format**: 0x-prefixed lowercase
- **Semantics**: "Proxy wallet or direct EOA" according to schema comment
- **Source**: Data API, Subgraph, Dune, AMM
- **Indexed**: bloom_filter(0.01)
- **Related Field**: operator_address (EOA operator, may be empty)
- **Flag Field**: is_proxy_trade (UInt8: 1=proxy, 0=direct)
- **Data Sources**: data_source field tracks origin (data_api, subgraph, dune, amm)
- **Example Query**:
```sql
SELECT 
  wallet_address,
  data_source,
  SUM(collateral_amount) as volume,
  COUNT(*) as trade_count
FROM pm_trades_external
WHERE block_time >= now() - interval 60 day
GROUP BY wallet_address, data_source
ORDER BY volume DESC
```

#### operator_address (pm_trades_external)
- **Type**: String (DEFAULT '')
- **Format**: 0x-prefixed lowercase (or empty string)
- **Semantics**: EOA that signed the transaction
- **Nullable**: Yes (empty string default)
- **Source**: Extracted from external sources if available
- **Relationship**: May be same as wallet_address or may be EOA behind proxy
- **Notes**: Can be empty/null for AMM trades
- **Example Query**:
```sql
SELECT 
  wallet_address,
  operator_address,
  COUNT(*) as signed_trades
FROM pm_trades_external
WHERE operator_address != '' AND is_proxy_trade = 1
GROUP BY wallet_address, operator_address
```

---

### SPECIAL DECODED FIELDS

#### from_eoa (erc1155_transfers_enriched)
- **Type**: String
- **Format**: 0x-prefixed lowercase
- **Semantics**: Decoded EOA owner if from_addr is proxy
- **Source**: JOIN with pm_user_proxy_wallets
- **Null Behavior**: Empty string if from_addr is direct EOA or unmapped proxy
- **Join Logic**: 
```sql
LEFT JOIN pm_user_proxy_wallets pf 
  ON lower(from_addr) = lower(pf.proxy_wallet)
  => pf.user_eoa AS from_eoa
```
- **Related Field**: from_type ('proxy' or 'direct')
- **Usage**: True owner identification for sends

#### to_eoa (erc1155_transfers_enriched)
- **Type**: String
- **Format**: 0x-prefixed lowercase
- **Semantics**: Decoded EOA owner if to_addr is proxy
- **Source**: JOIN with pm_user_proxy_wallets
- **Null Behavior**: Empty string if to_addr is direct EOA or unmapped proxy
- **Join Logic**: 
```sql
LEFT JOIN pm_user_proxy_wallets pt 
  ON lower(to_addr) = lower(pt.proxy_wallet)
  => pt.user_eoa AS to_eoa
```
- **Related Field**: to_type ('proxy' or 'direct')
- **Usage**: True owner identification for receives

---

## CANONICALIZATION RULES

### Rule 1: Normalize Format
```
INPUT: Any format (0x..., without 0x, mixed case)
OUTPUT: 0x + 40 lowercase hex chars

IMPLEMENTATION:
  canonical = '0x' + lpad(lower(substr(address, -40)), 40, '0')
```

### Rule 2: Resolve Proxies to EOAs
```
INPUT: wallet_address (could be proxy or EOA)
LOGIC:
  1. Check if address exists in pm_user_proxy_wallets.proxy_wallet
  2. If yes, use user_eoa as canonical
  3. If no, use address as canonical

SQL:
  SELECT COALESCE(pw.user_eoa, w.wallet_address) as canonical_wallet
  FROM (SELECT ? as wallet_address) w
  LEFT JOIN pm_user_proxy_wallets pw 
    ON lower(w.wallet_address) = lower(pw.proxy_wallet)
```

### Rule 3: Deduplicate Maker/Taker
```
INPUT: pm_trades with maker_address, taker_address
LOGIC:
  1. Apply proxy resolution to both maker and taker
  2. Store both canonical values if different
  3. If same canonical owner, deduplicate

RESULT: Set of (primary_wallet, secondary_wallets_involved)
```

### Rule 4: Handle EOA/Proxy Chains
```
EDGE CASE: Chain of proxies (rare but possible)
  - EOA1 -> Proxy1 -> Proxy2 (Proxy2 operates Proxy1)
  
SOLUTION: 
  1. Current schema only maps direct proxy->EOA
  2. Would need recursive lookup if chains exist
  3. For MVP: Warn if user_eoa itself is in proxy_wallet list
```

---

## DATA TYPE REQUIREMENTS

### Format Specification
- **Ethereum Address Standard**: EIP-55 (checksum optional, case-insensitive in ClickHouse)
- **Cascadian Constraint**: Stored as lowercase, 42 chars (0x + 40 hex)
- **ClickHouse Type**: String (not address type, which doesn't exist)

### Validation Functions

#### SQL Validation
```sql
-- Check if string is valid address
function isValidAddress(addr String):
  length(addr) = 42 AND
  addr LIKE '0x%' AND
  try_cast(substr(addr, 3), 'UInt256') IS NOT NULL

-- Normalize address  
function normalizeAddress(addr String):
  '0x' || lower(rightPad(substr(addr, -40), 40, '0'))
```

#### TypeScript Validation
```typescript
function isValidAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

function normalizeAddress(addr: string): string {
  return '0x' + addr.toLowerCase().slice(-40).padEnd(40, '0');
}
```

---

## JOIN PATTERNS FOR WALLET CANONICALIZATION

### Pattern 1: Direct Lookup (wallet_metrics)
```sql
SELECT w.wallet_address, m.realized_pnl
FROM wallet_metrics m
WHERE m.wallet_address = '0x...'
-- wallet_address is already canonical
```

### Pattern 2: Maker/Taker Resolution (pm_trades)
```sql
SELECT 
  COALESCE(pm.user_eoa, pt.maker_address) as canonical_maker,
  COALESCE(pt_user.user_eoa, pt.taker_address) as canonical_taker,
  COUNT(*) as fills
FROM pm_trades pt
LEFT JOIN pm_user_proxy_wallets pm 
  ON lower(pt.maker_address) = lower(pm.proxy_wallet)
LEFT JOIN pm_user_proxy_wallets pt_user
  ON lower(pt.taker_address) = lower(pt_user.proxy_wallet)
GROUP BY canonical_maker, canonical_taker
```

### Pattern 3: ERC1155 Sender/Receiver (erc1155_transfers)
```sql
SELECT
  COALESCE(pf.user_eoa, e.from_addr) as canonical_from,
  COALESCE(pt.user_eoa, e.to_addr) as canonical_to,
  COUNT(*) as transfers
FROM erc1155_transfers_enriched e
LEFT JOIN pm_user_proxy_wallets pf
  ON lower(e.from_addr) = lower(pf.proxy_wallet)
LEFT JOIN pm_user_proxy_wallets pt
  ON lower(e.to_addr) = lower(pt.proxy_wallet)
GROUP BY canonical_from, canonical_to
```

### Pattern 4: Multi-Table Union (all wallet activity)
```sql
SELECT 'wallet_metrics' as source, wallet_address, COUNT(*) as event_count
FROM wallet_metrics
GROUP BY wallet_address

UNION ALL

SELECT 'pm_trades_maker' as source, maker_address, COUNT(*) 
FROM pm_trades
GROUP BY maker_address

UNION ALL

SELECT 'pm_trades_taker' as source, taker_address, COUNT()
FROM pm_trades
GROUP BY taker_address

-- ... (add other sources)
-- Then resolve all to canonical via UNION with proxy mappings
```

---

## PERFORMANCE NOTES

### Index Strategy
- **wallet_address**: PRIMARY KEY or bloom_filter depending on table design
- **Bloom filters**: Used for high-cardinality lookups (50M+ row tables)
- **MinMax indexes**: Used for range queries on metrics

### Query Performance Tips
1. Always filter by date/partition first (timestamp, block_time)
2. Use bloom filters for WHERE clauses on maker/taker_address
3. Cache proxy mappings locally if doing cross-joins
4. For large unions, use UNION ALL with explicit partitioning

### Canonicalization Performance
- Proxy mapping lookup: O(1) with bloom filter (pm_user_proxy_wallets has only 5K rows)
- No performance penalty for adding canonical columns (metadata only)
- Consider materialized view for canonical_wallet_addresses if queried frequently

---

## COMMON PATTERNS & GOTCHAS

### Gotcha 1: Case Sensitivity in JOINs
```sql
-- WRONG (may miss lowercase matches)
JOIN pm_user_proxy_wallets p ON e.from_addr = p.proxy_wallet

-- RIGHT (always normalize)
JOIN pm_user_proxy_wallets p ON lower(e.from_addr) = lower(p.proxy_wallet)
```

### Gotcha 2: Null vs Empty String
```sql
-- operator_address is empty string, not NULL
-- This will NOT work:
WHERE operator_address IS NOT NULL

-- This WILL work:
WHERE operator_address != ''
```

### Gotcha 3: Burned Token Tracking
```sql
-- 0x0000... means mint/burn
-- Need to filter these out for position tracking
WHERE to_addr != '0x0000000000000000000000000000000000000000'
AND from_addr != '0x0000000000000000000000000000000000000000'
```

### Gotcha 4: Proxy Mappings May Be Incomplete
```sql
-- Not all proxies are mapped (only ones we've discovered)
-- from_eoa may be empty even for legitimate proxies
-- Build allowlist of known safe proxies (Gnosis Safe, etc.)
```

---

## MIGRATION CHECKLIST

### Step 1: Validate Current State
- [ ] Run SELECT COUNT(DISTINCT wallet_address) on each table
- [ ] Check for case variations in maker/taker_address
- [ ] Verify proxy mapping coverage
- [ ] Check for NULL vs empty string inconsistencies

### Step 2: Create Canonical Mapping Table
```sql
CREATE TABLE canonical_wallet_addresses (
  canonical_address String,
  addresses_seen Array(String),
  primary_eoa String,
  is_proxy UInt8,
  first_seen DateTime,
  last_seen DateTime,
  status String ('active', 'inactive'),
  ingested_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY canonical_address
```

### Step 3: Add Canonical Columns
- [ ] ALTER TABLE wallets_dim ADD COLUMN canonical_wallet_address String
- [ ] ALTER TABLE pm_trades ADD COLUMN canonical_maker_address String
- [ ] ALTER TABLE pm_trades ADD COLUMN canonical_taker_address String
- [ ] ALTER TABLE trades_raw ADD COLUMN canonical_wallet_address String
- [ ] ALTER TABLE pm_trades_external ADD COLUMN canonical_wallet_address String

### Step 4: Backfill Data
- [ ] Run UPDATE statements with COALESCE(proxy lookup, original address)
- [ ] Validate counts match before/after
- [ ] Test with sample queries on both old and new columns

### Step 5: Update Views & APIs
- [ ] Update wallet_metrics_daily to use canonical addresses
- [ ] Update erc1155_transfers_enriched to use canonical addresses
- [ ] Update API endpoints (/api/wallets/[address]/)
- [ ] Update leaderboard queries

---

**Document**: /Users/scotty/Projects/Cascadian-app/WALLET_FIELDS_TECHNICAL_REFERENCE.md
**Status**: Complete technical reference
**Use Case**: Implementation guide for wallet canonicalization
**Generated**: 2025-11-16
