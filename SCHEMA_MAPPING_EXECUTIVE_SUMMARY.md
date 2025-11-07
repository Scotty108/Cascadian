# Cascadian Schema Mapping - EXECUTIVE SUMMARY

## Quick Answer to Your Questions

### 1. Where are CLOB Fills?
- **Primary**: `pm_trades` (537 rows) ❌ INCOMPLETE - needs full CLOB API backfill
- **Alternative**: `trades_raw` (159.5M rows) ✅ COMPLETE - historical trades with full coverage
  - Contains all Polymarket trades from Dec 2022 - Oct 31, 2025
  - Quality caveat: 0.79% have corrupted market_id='12'

### 2. Where are ERC1155 Token Transfers?
- **Authoritative Source**: `pm_erc1155_flats` ❌ SCHEMA READY BUT NOT POPULATED
  - Captures: TransferSingle and TransferBatch events from ConditionalTokens contract
  - Action needed: Execute `scripts/flatten-erc1155.ts` to populate
  - Expected result: Hundreds of millions of blockchain position transfers

### 3. Where are ERC20 Transfers (USDC)?
- **Primary**: `erc20_transfers_staging` ❌ SCHEMA EXISTS, NOT POPULATED
  - Captures: USDC Transfer events from Polygon
  - Action needed: Implement ERC20 backfill script (similar to ERC1155)

### 4. Where are Wallet-to-Proxy Mappings?
- **Source**: `pm_user_proxy_wallets` ❌ DEPENDS ON ERC1155 BACKFILL
  - Built from: Analysis of pm_erc1155_flats transfer patterns
  - Purpose: Map user EOA → proxy wallet for trade attribution
  - Chicken-and-egg: Can't populate until ERC1155 is populated

### 5. What about Position Tracking?
- **Current Holdings**: `outcome_positions_v2` ✅ PRESUMED READY
- **P&L Calculations**: Multiple tables (⚠️ MANY ARE BROKEN)
  - Use ONLY: `trade_flows_v2` (correct cashflows) + `market_resolutions_final`
  - Avoid: `realized_pnl_by_market_v2` (has 36x inflation bug)

---

## The Wallet Trade History Reconstruction Path

To reconstruct COMPLETE wallet history, you need (in order):

```
INPUT: User wallet address (e.g., 0xa4b366ad22fc0d06f1e934ff468e8922431a87b8)
                                    |
                                    ↓
STEP 1: Find proxy wallets via pm_user_proxy_wallets
        ❌ BLOCKED: Needs ERC1155 backfill first
                                    |
                                    ↓
STEP 2: Get CLOB fills via pm_trades
        ❌ BLOCKED: Only 537 rows exist (need CLOB API backfill)
                                    |
                                    ↓
STEP 3: Get position transfers via pm_erc1155_flats
        ❌ BLOCKED: Schema ready but empty (need flatten-erc1155.ts)
                                    |
                                    ↓
STEP 4: Get USDC flows via erc20_transfers
        ❌ BLOCKED: Not implemented yet
                                    |
                                    ↓
STEP 5: Calculate P&L from resolved positions
        ⚠️ PARTIAL: trade_flows_v2 works, but views have bugs
                                    |
                                    ↓
OUTPUT: Complete wallet trade history with P&L
```

---

## Critical Blockers (What's Missing)

### BLOCKER 1: ERC1155 Transfers Not Ingested
```
Table: pm_erc1155_flats
Status: ❌ EMPTY
Impact: Can't identify proxy wallets OR reconstruct positions
Fix: npx tsx scripts/flatten-erc1155.ts
Time: ~1-2 hours
```

### BLOCKER 2: CLOB Trades Severely Incomplete
```
Table: pm_trades
Current: 537 rows
Expected: 10M+ rows (based on Polymarket volume)
Impact: Missing 99.7% of official CLOB order fills
Fix: npx tsx scripts/ingest-clob-fills-backfill.ts
Time: ~2-4 hours + API rate limits
```

### BLOCKER 3: ERC20 Transfers Not Implemented
```
Table: erc20_transfers_staging
Status: ❌ SCHEMA READY, NOT POPULATED
Impact: Can't track USDC flows (margin/settlement)
Fix: Implement USDC transfer backfill (template: flatten-erc1155.ts)
Time: ~2-3 hours
```

### BLOCKER 4: Proxy Wallet Mapping Depends on ERC1155
```
Table: pm_user_proxy_wallets
Status: ❌ CAN'T POPULATE without ERC1155 data
Impact: Can't attribute trades to user EOAs
Build Sequence: ERC1155 → Proxy Inference → Done
```

---

## What's READY vs BLOCKED

### ✅ READY TO USE
- `trades_raw` - 159.5M complete trades (use with quality filter: market_id != '12')
- `gamma_markets` - 150K complete market metadata
- `condition_market_map` - 151.8K condition→market mappings
- `market_resolutions_final` - 223K resolved markets
- `ctf_token_map` - Token→market metadata
- `trade_flows_v2` - Correct cashflow calculations
- `markets_enriched`, `token_market_enriched` - Enriched views

### ❌ BLOCKED (Not Populated Yet)
- `pm_erc1155_flats` - ERC1155 transfers (schema exists, data missing)
- `pm_trades` - CLOB fills (severely incomplete: 537 of ~10M rows)
- `erc20_transfers` - USDC transfers (not implemented)
- `pm_user_proxy_wallets` - Proxy mappings (depends on ERC1155)
- `erc1155_transfers_enriched` - Enriched transfers (depends on pm_erc1155_flats)

### ⚠️ PARTIALLY BROKEN
- `realized_pnl_by_market_v2` - Has join bug causing 36x inflation
- `trades_with_pnl` - 96.68% NULL pnl values
- Multiple P&L variants - Conflicting formulas

---

## Recommended Fix Sequence

### IMMEDIATE (Get Trade History Working)
1. Execute ERC1155 backfill (1-2 hours)
   ```bash
   npx tsx scripts/flatten-erc1155.ts
   ```
   Result: pm_erc1155_flats populated with blockchain transfers

2. Infer proxy wallets (30 minutes)
   ```bash
   npx tsx scripts/build-approval-proxies.ts
   ```
   Result: pm_user_proxy_wallets populated with EOA→proxy mappings

3. Backfill CLOB trades (2-4 hours)
   ```bash
   npx tsx scripts/ingest-clob-fills-backfill.ts
   ```
   Result: pm_trades populated with full historical trades

### SECONDARY (Complete P&L)
4. Implement ERC20 backfill (1-2 hours)
   - Create script for USDC transfer ingestion
   - Populate erc20_transfers table

5. Rebuild P&L views (2-3 hours)
   - Replace broken realized_pnl_by_market_v2
   - Use verified formulas from trade_flows_v2

### VALIDATION (2-3 hours)
6. Cross-table consistency checks
7. Sample wallet reconciliation
8. P&L accuracy verification

**Total Time to Complete Trade History: 8-12 hours (mostly parallel execution)**

---

## The 3 Authoritative Data Sources

### SOURCE 1: CLOB Fills (Order Book Trades)
```
Best Table: pm_trades (if complete) OR trades_raw (current fallback)

For wallet 0xa4b366ad22fc0d06f1e934ff468e8922431a87b8:
  - 8,484 trades (from trades_raw)
  - Market dates: Dec 4, 2024 → Oct 29, 2025
  
Challenge: trades_raw uses YES/NO enum (outcome label) 
  not BUY/SELL (direction), must infer direction

When Complete: pm_trades will have:
  - maker_address, taker_address (cleaner attribution)
  - side: "BUY"/"SELL" (proper direction)
  - 10M+ rows covering full history
```

### SOURCE 2: ERC1155 Token Transfers (Position Changes)
```
Table: pm_erc1155_flats (WHEN POPULATED)

What it shows:
  - from_address sent outcome tokens (SOLD position)
  - to_address received outcome tokens (BOUGHT position)
  - token_id → market/outcome via ctf_token_map join
  - amount transferred in hex

For complete wallet history:
  - Each transfer = position change event
  - Can reconstruct entry/exit prices from CLOB trades
  - Can identify exactly which tokens owned at any time

Status: Ready but empty - EXECUTE NOW
```

### SOURCE 3: ERC20 Transfers (USDC Flows)
```
Table: erc20_transfers (WHEN IMPLEMENTED)

What it shows:
  - from_addr sent USDC (withdrawal/settlement)
  - to_addr received USDC (deposit/payout)
  - amount in standard ERC20 format (hex, wei)
  - Can attribute to wallets via proxy mapping

For complete wallet history:
  - Maps USDC in = margin deposits
  - Maps USDC out = margin withdrawals + settlement
  - Validates PnL calculations

Status: Schema exists but needs backfill implementation
```

---

## Join Pattern for Complete Wallet History

```sql
-- Get all activity for a wallet
WITH wallet_trades AS (
  SELECT * FROM pm_trades
  WHERE lower(maker_address) = lower('0x...')
     OR lower(taker_address) = lower('0x...')
),
wallet_transfers AS (
  SELECT * FROM pm_erc1155_flats
  WHERE lower(from_address) = lower('0x...') 
     OR lower(to_address) = lower('0x...')
),
wallet_usdc AS (
  SELECT * FROM erc20_transfers  -- When populated
  WHERE from_addr = '0x...' OR to_addr = '0x...'
)

-- Union and sort chronologically
SELECT 
  block_time as timestamp,
  'TRANSFER' as type,
  token_id, amount, to_address
FROM wallet_transfers
UNION ALL
SELECT
  timestamp,
  'TRADE' as type,
  market_id, size, price
FROM wallet_trades
UNION ALL
SELECT
  block_time,
  'USDC' as type,
  NULL, amount, to_addr
FROM wallet_usdc

ORDER BY timestamp
```

---

## Data Quality Notes

### Issue 1: Side Field Confusion (trades_raw)
```
trades_raw.side = Enum8('YES', 'NO')
  ❌ These are OUTCOME labels, not DIRECTION labels
  ❌ Can't use directly: side='YES' doesn't mean BUY

Correct approach:
  1. Use trade_flows_v2 which pre-computes signed cashflows
  2. OR infer direction from net flows (usdc + tokens)
```

### Issue 2: Corrupted market_id Values
```
trades_raw has 1.26M rows (0.79%) with market_id='12'
  ❌ Can't map to real markets
  ❌ Should be filtered out: WHERE market_id NOT IN ('12', '')
```

### Issue 3: Condition ID Format Variations
```
Be consistent: Always use lower(replaceAll(condition_id, '0x', ''))
Different tables have different formats:
  - Some uppercase 0x-prefixed
  - Some lowercase
  - Some no prefix
Standardize before joining!
```

### Issue 4: P&L Calculation Pitfalls
```
Resolved Markets: Only ~44% of trades have resolutions
  → Can't calculate realized P&L for 56% of positions
  → Must use unrealized P&L for open positions

Join Bug: realized_pnl_by_market_v2 has settlement join bug
  → Returns 36x inflated values
  → Don't use this table
  → Build fresh from trade_flows_v2 + market_resolutions_final
```

---

## Bottom Line

**Can you reconstruct wallet trade history?** 
✅ YES, all 3 data sources are architected:
- CLOB fills: `pm_trades` OR `trades_raw`
- Position changes: `pm_erc1155_flats`
- Value flows: `erc20_transfers`

**Is it ready NOW?**
❌ NO - needs 3 backfills (1-2 hours each, ~8-12 hours total):
1. ERC1155 blockchain events → pm_erc1155_flats
2. CLOB API historical trades → pm_trades
3. USDC transfers → erc20_transfers

**What should I do first?**
Execute ERC1155 backfill → it unblocks proxy mapping → enables everything else
```bash
npx tsx scripts/flatten-erc1155.ts
```

