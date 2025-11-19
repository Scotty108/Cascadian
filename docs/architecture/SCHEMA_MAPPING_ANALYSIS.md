# Cascadian ClickHouse Schema Mapping - Complete Analysis

## Executive Summary

The Cascadian ClickHouse database contains **87+ tables** organized into 5 layers:
1. **Raw/Staging Layer** - Blockchain events (ERC1155, ERC20)
2. **CLOB Layer** - Polymarket CLOB order fills
3. **Bridge Layer** - Token/market/condition mappings
4. **Enriched Layer** - Normalized views with context
5. **Analytics Layer** - P&L and metrics tables

### Key Finding
**Wallet trade history can be reconstructed from THREE authoritative sources:**
- **CLOB Fills**: `pm_trades` (537 rows, CLOB API data)
- **ERC1155 Transfers**: `pm_erc1155_flats` (position changes on blockchain)
- **ERC20 Transfers**: `erc20_transfers_staging` (USDC deposits/withdrawals)

---

## PART 1: CLOB Fills Data

### Primary Source: `pm_trades`

```
Table: pm_trades
Engine: ReplacingMergeTree(created_at)
Row Count: 537 rows (test/subset data)
Key Columns:
  - id (String): Unique trade ID from CLOB API
  - market_id (String): Polymarket market identifier
  - maker_address (String): Counterparty maker (lowercase)
  - taker_address (String): Counterparty taker (lowercase)
  - side (LowCardinality(String)): "BUY" or "SELL"
  - size (String): Trade size in outcome tokens
  - price (Float64): Execution price (0-1 probability)
  - timestamp (DateTime): Trade execution time
  - transaction_hash (String): Blockchain transaction hash
  - asset_id (String): Token ID (links to ctf_token_map)
  - fee_rate_bps (UInt16): Fee in basis points

Grain: Per-fill (one row per CLOB order match)
Purpose: Official CLOB order book fills from Polymarket API
Data Completeness: PARTIAL (only 537 rows - appears to be test/demo data)
Indexes: Bloom filters on maker_address, taker_address

Historical Notes:
  - Ingested via scripts/ingest-clob-fills.ts
  - Fetches from https://clob.polymarket.com/api/v1/trades
  - May need backfill for full historical coverage
```

### Assessment
- **Status**: ✅ Schema exists and is well-designed
- **Data Completeness**: ❌ SEVERELY INCOMPLETE (537 rows for all wallets/markets)
- **Recommendation**: This table needs FULL BACKFILL via CLOB API

### Alternative: `trades_raw`

```
Table: trades_raw
Engine: MergeTree (partitioned by month)
Row Count: 159,574,259 rows (MASSIVE dataset)
Key Columns:
  - trade_id (String): Unique identifier
  - wallet_address (String): Single wallet (role unclear)
  - market_id (String): Polymarket market ID
  - side (Enum8): 'YES' (1) or 'NO' (2)
  - entry_price (Decimal 18,8): Execution price
  - shares (Decimal 18,8): Trade size
  - timestamp (DateTime): Execution time
  - transaction_hash (String): Blockchain tx hash
  - usd_value (Decimal 18,2): Trade value in USD
  - pnl (Nullable Decimal 18,2): Post-resolution P&L
  - is_closed (Bool): Whether position closed

Grain: Per-trade (one row per trade)
Purpose: LEGACY/GENERIC trades table - source unclear
Data Completeness: COMPLETE (159M+ trades across 1M+ wallets)
Coverage: Dec 18, 2022 - Oct 31, 2025 (1,048 days)
Issues:
  - 0.79% corrupted market_id='12' records
  - Side field uses YES/NO (outcome label) not BUY/SELL (direction)
  - Wallet_address role unclear (EOA vs proxy vs aggregator?)
```

### Assessment
- **Status**: ✅ Complete dataset available
- **Data Quality**: ⚠️ Has known issues (0.79% corrupted, enum confusion)
- **Recommendation**: USE THIS for historical analysis but apply data quality filters

---

## PART 2: ERC1155 Token Transfers

### Primary Source: `pm_erc1155_flats`

```
Table: pm_erc1155_flats
Engine: MergeTree (partitioned by month)
Row Count: NOT YET INGESTED (schema ready)
Key Columns:
  - block_number (UInt32): Blockchain block
  - block_time (DateTime): Block timestamp
  - tx_hash (String): Transaction hash
  - log_index (UInt32): Event index in transaction
  - operator (String): Address initiating transfer
  - from_address (String): Sender (EOA/wallet)
  - to_address (String): Recipient (proxy/contract)
  - token_id (String): ERC1155 token ID (outcome token)
  - amount (String): Hex-encoded amount transferred
  - address (String): ConditionalTokens contract address

Grain: Per-transfer event (one row per ERC1155 transfer)
Purpose: Complete record of Polymarket position changes on blockchain
Data Completeness: UNKNOWN - needs `flatten-erc1155.ts` execution
Source: Blockchain events for 0x4d97dcd97ec945f40cf65f87097ace5ea0476045

Events Captured:
  - TransferSingle (0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62)
  - TransferBatch (0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb)

Schema Creation:
  - Migration: migrations/clickhouse/016_enhance_polymarket_tables.sql
  - Ingestion: scripts/flatten-erc1155.ts (with schema creation)
```

### Assessment
- **Status**: ✅ Schema created and ready
- **Data Ingestion**: ❌ NOT YET RUN (need to execute flatten-erc1155.ts)
- **Expected Completeness**: HIGH (blockchain is source of truth)
- **Recommendation**: EXECUTE `scripts/flatten-erc1155.ts` to populate

### Supporting Table: `erc1155_transfers_enriched`

```
View: erc1155_transfers_enriched (created from migration 016)
Joins:
  - pm_erc1155_flats (base)
  - token_market_enriched (adds market context)
  - proxy_wallets_active (resolves proxy → EOA for from_addr)
  - proxy_wallets_active (resolves proxy → EOA for to_addr)

Result Columns:
  - [all from pm_erc1155_flats]
  - market_id, outcome, outcome_index (from token mapping)
  - is_winning_outcome (whether this token won)
  - from_eoa, from_type (proxy resolution)
  - to_eoa, to_type (proxy resolution)

Use Case: Attribution - which transfers belong to which user EOA
```

---

## PART 3: ERC20 Transfers (USDC)

### Primary Source: `erc20_transfers_staging`

```
Table: erc20_transfers_staging
Engine: ReplacingMergeTree(created_at)
Row Count: NOT YET INGESTED (schema ready)
Key Columns:
  - tx_hash (String): Transaction hash
  - log_index (Int32): Event index
  - block_number (UInt32): Blockchain block
  - block_hash (String): Block hash
  - address (String): Token contract address (USDC on Polygon)
  - topics (Array String): Event topics (includes Transfer signature)
  - data (String): Encoded transfer data (from, to, amount)
  - removed (Boolean): Whether event was removed (reorg)
  - token_type (String): Token type (should be "ERC20")
  - created_at (DateTime): Ingestion timestamp

Grain: Per-transfer event (one row per ERC20 Transfer)
Purpose: Track USDC deposits/withdrawals (position value in USD)
Data Completeness: NOT YET POPULATED
Source: Blockchain events filtered by:
  - Contract: USDC token on Polygon
  - Event: Transfer(indexed from, indexed to, uint256 amount)
```

### Assessment
- **Status**: ✅ Schema exists
- **Data Ingestion**: ❌ NOT YET POPULATED
- **Expected Completeness**: HIGH (blockchain source)
- **Recommendation**: EXECUTE backfill script after ERC1155 complete

### Additional ERC20 Table: `erc20_transfers`

```
Table: erc20_transfers (UNCLEAR STATUS)
Purpose: Likely processed/enriched version of erc20_transfers_staging
Status: Need to verify if populated
```

---

## PART 4: Bridge & Mapping Tables

### Token Mapping: `ctf_token_map`

```
Table: ctf_token_map
Engine: ReplacingMergeTree
Purpose: Maps ERC1155 token IDs → Polymarket market metadata

Core Columns:
  - token_id (String): ERC1155 token ID (unique per outcome token)
  - condition_id_norm (String): Normalized condition ID (lowercase, no 0x)
  - market_id (String): Polymarket market identifier
  - outcome (String): Outcome label ("Yes", "No", or specific name)
  - outcome_index (UInt8): 0-based index in market outcomes array
  - question (String): Market question text

Indexes:
  - idx_ctf_token_map_condition (bloom filter on condition_id_norm)
  - idx_ctf_token_map_market (bloom filter on market_id)

Join Key: token_id (links pm_erc1155_flats → market context)
```

### Market Mapping: `condition_market_map`

```
Table: condition_market_map
Engine: ReplacingMergeTree
Purpose: Cache for condition_id → market_id lookups

Columns:
  - condition_id (String): Blockchain condition ID
  - market_id (String): Polymarket market ID
  - event_id (String): Event ID (nullable)
  - canonical_category (String): Category label
  - raw_tags (Array String): Polymarket tags
  - ingested_at (DateTime): Cache timestamp

Row Count: ~151,843 rows (nearly all markets)
Completeness: VERY HIGH (~98% of markets)

Indexes:
  - idx_condition_market_map_condition (bloom on condition_id)
  - idx_condition_market_map_market (bloom on market_id)

Join Key: condition_id OR market_id
```

### Market Data: `gamma_markets`

```
Table: gamma_markets
Row Count: ~150K rows
Purpose: Market metadata from Polymarket Gamma API

Key Columns:
  - market_id (String): Primary identifier
  - condition_id (String): Blockchain condition ID
  - question (String): Market question
  - outcomes (Array String): Outcome labels ["Yes", "No"] or custom
  - end_date_iso (String): Market resolution date
  - volume (String): Market volume
  - category (String): Market category
  - tags (Array String): Tags
  - ingested_at (DateTime): Data fetch timestamp

Coverage: 100% of active Polymarket markets
Status: ✅ Complete and current
```

### Resolution Data: `market_resolutions_final`

```
Table: market_resolutions_final
Row Count: ~223,973 rows (resolved markets)
Purpose: Market resolutions - which outcome won

Key Columns:
  - market_id (String): Market identifier
  - condition_id (String): Blockchain condition
  - winner (String): Winning outcome label
  - winning_outcome_index (UInt8): 0-based index of winner
  - is_resolved (UInt8): 1=resolved, 0=open
  - resolution_source (String): Source of resolution (oracle, etc.)
  - resolved_at (DateTime): Resolution timestamp
  - payout_hash (String): Blockchain payout hash
  - ingested_at (DateTime): Data fetch timestamp

Coverage: ~44% of markets (223K of 151K unique, some have multiple)
Status: ✅ Complete for resolved markets

Completeness Note: Only 44% of trades are on RESOLVED markets
  - 159M trades, 151K markets
  - Only 33K markets have resolutions
  - Most recent trades are on UNRESOLVED markets
```

---

## PART 5: Proxy Wallet Mapping

### Table: `pm_user_proxy_wallets`

```
Table: pm_user_proxy_wallets
Engine: ReplacingMergeTree
Purpose: Maps user EOAs to their proxy/contract wallets

Columns:
  - user_eoa (LowCardinality String): User's main EOA wallet
  - proxy_wallet (String): Contract/proxy used for trading
  - source (String): How mapping was discovered ("erc1155_transfers", etc.)
  - first_seen_at (DateTime): First activity timestamp
  - last_seen_at (DateTime): Most recent activity
  - is_active (UInt8): 1=currently active

Row Count: DEPENDS ON INFERENCE
Data Source: Derived from pm_erc1155_flats analysis
  - Groups transfers by (from_address, to_address) patterns
  - Identifies repeat pairings as user EOA → proxy relationship

Purpose: Attribution
  - pm_trades shows maker_address/taker_address (proxies)
  - Need to map back to user_eoa for wallet attribution
  - Enable: wallet → proxy lookup
  - Enable: proxy → wallet reverse lookup
```

### View: `proxy_wallets_active`

```
View: proxy_wallets_active
Purpose: Filtered to only active proxies

Logic:
  SELECT user_eoa, proxy_wallet, source, first_seen_at, last_seen_at
  FROM pm_user_proxy_wallets
  WHERE is_active = 1

Use Cases:
  - Join to pm_erc1155_flats.from_addr to get user EOA
  - Join to pm_trades.maker_address to get user EOA
```

---

## PART 6: Other Key Tables

### Position Tracking: `outcome_positions_v2`

```
Table: outcome_positions_v2
Purpose: Aggregated positions per wallet per outcome

Likely Columns:
  - wallet (String)
  - market_id (String)
  - condition_id (String)
  - token_id (String)
  - shares (Decimal): Total shares held
  - entry_value (Decimal): Cost basis
  - current_value (Decimal): Current mark-to-market

Grain: Per wallet, per outcome token
Data Source: Derived from pm_erc1155_flats or trades_raw
Purpose: Current holdings snapshot
```

### P&L Tables (MULTIPLE VARIANTS)

```
⚠️ WARNING: Multiple conflicting P&L tables exist:

table_name                          rows        status
─────────────────────────────────────────────────────────
trades_with_pnl                     515,708     ✅ Verified
wallet_pnl_summary_v2               [unknown]   ✅ Verified (-2.3% accuracy)
realized_pnl_by_market_v2           [unknown]   ❌ Known bug (36x inflation)
trade_flows_v2                      [unknown]   ✅ Correct cashflows
wallet_realized_pnl_v2              [unknown]   ⚠️ Depends on flow_v2
trades_raw_with_full_pnl            159.5M      ❌ Most PnL is NULL

RECOMMENDATION: Use only:
  1. trade_flows_v2 for cashflow calculations
  2. market_resolutions_final for settlements
  3. Rebuild P&L views from scratch using these sources
```

---

## PART 7: Data Quality Issues

### Issue 1: Corrupted market_id Values
```
Location: trades_raw
Problem: 0.79% of rows have market_id='12' (placeholder for unknown/bad)
Impact: ~1.26M rows cannot be mapped to real markets
Fix: WHERE market_id NOT IN ('12', '')
```

### Issue 2: Condition ID Normalization
```
Format Variations Found:
  - "0xB3D36E59..." (uppercase + 0x)
  - "0xb3d36e59..." (lowercase + 0x)
  - "b3d36e59..." (lowercase, no 0x)
  - "B3D36E59" (uppercase, no 0x)

Solution: Always use: lower(replaceAll(condition_id, '0x', ''))
```

### Issue 3: Side Field Confusion
```
trades_raw.side values: 'YES' (1) or 'NO' (2)
  - These are OUTCOME labels, not DIRECTION labels
  - Cannot use directly to calculate signed cashflows
  - Must infer direction from net flow analysis

pm_trades.side values: 'BUY' or 'SELL'
  - These are ACTUAL directions
  - Can use directly for signed calculations
```

### Issue 4: Resolution Coverage
```
Resolved Markets: 223K of 33K unique
Open/Unresolved: ~118K markets
Implication: 78% of market_id values have NO resolution data
  - Can only calculate realized P&L for 22% of trades
  - Must use unrealized P&L for open positions
```

---

## PART 8: Trade History Reconstruction Path

### Recommended Approach: MULTI-SOURCE FUSION

**For COMPLETE wallet history, use:**

```
STEP 1: Identify all proxy wallets
────────────────────────────────────
SELECT DISTINCT proxy_wallet
FROM pm_user_proxy_wallets
WHERE lower(user_eoa) = lower('0xYOUR_WALLET')
  AND is_active = 1

STEP 2: Get CLOB fills (trades)
────────────────────────────────
SELECT *
FROM pm_trades
WHERE lower(maker_address) = lower(proxy_wallet)
   OR lower(taker_address) = lower(proxy_wallet)
ORDER BY timestamp

Status: ⚠️ INCOMPLETE DATA (only 537 rows total)
Action: Requires CLOB API backfill

STEP 3: Get ERC1155 transfers (positions)
──────────────────────────────────────────
SELECT *
FROM erc1155_transfers_enriched
WHERE lower(from_eoa) = lower('0xYOUR_WALLET')
   OR lower(to_eoa) = lower('0xYOUR_WALLET')
ORDER BY block_time

Data Flow:
  from_eoa → sold shares (exit)
  to_eoa → received shares (entry or settlement)

Status: ⚠️ NEEDS POPULATION (schema ready)
Action: Execute flatten-erc1155.ts

STEP 4: Get USDC transfers (value tracking)
───────────────────────────────────────────
SELECT *
FROM erc20_transfers
WHERE from_addr = proxy_wallet OR to_addr = proxy_wallet
ORDER BY block_time

Data Flow:
  from_addr → sent USDC (margin/settlement)
  to_addr → received USDC (winnings/deposits)

Status: ❌ NOT READY
Action: Implement ERC20 backfill

STEP 5: Reconstruct P&L
──────────────────────
For each position:
  1. entry_cost = SUM(CLOB cashflow when qty increases)
  2. exit_price = CLOB fill price when qty decreases
  3. entry_value = SUM(ERC1155 in_amount * entry_cost)
  4. settlement = outcome_value if market resolved else NULL
  5. pnl = entry_value + settlement - exit_value
```

---

## PART 9: Table Dependencies for Complete Picture

```
For Wallet Trade History:
┌─────────────────────────┐
│ wallet_address (EOA)    │
└────────────┬────────────┘
             │
             ↓
┌──────────────────────────────────────────────┐
│ pm_user_proxy_wallets                        │
│ Find: proxy wallets associated with EOA      │
└────────────┬─────────────────────────────────┘
             │
      ┌──────┴──────┐
      ↓             ↓
    ┌────────────────────┐      ┌─────────────────────────┐
    │ pm_trades          │      │ pm_erc1155_flats        │
    │ CLOB order fills   │      │ Position transfers      │
    │ (partial data)     │      │ (schema ready)          │
    └─────────┬──────────┘      └──────────┬──────────────┘
              │                           │
              ├───────────────┬───────────┤
              ↓               ↓           ↓
         ┌─────────────────────────────────────────┐
         │ ctf_token_map                           │
         │ Maps token_id → outcome → market        │
         └──────────┬──────────────────────────────┘
                    │
         ┌──────────┴───────────┐
         ↓                      ↓
    ┌──────────────────┐  ┌──────────────────────┐
    │ gamma_markets    │  │ condition_market_map │
    │ Market metadata  │  │ condition → market   │
    └──────────────────┘  └──────────────────────┘
         │                      │
         └──────────┬───────────┘
                    ↓
         ┌──────────────────────────┐
         │ market_resolutions_final │
         │ Which outcome won?       │
         └──────────┬───────────────┘
                    ↓
         ┌──────────────────────────┐
         │ REALIZED P&L CALCULATION │
         │ pnl = entry + settlement │
         └──────────────────────────┘
```

---

## PART 10: Completeness Assessment

### Data Layer Completeness

| Layer | Table | Rows | Complete? | Notes |
|-------|-------|------|-----------|-------|
| **Raw/Staging** | pm_erc1155_flats | 0 | ❌ | Schema ready, needs population |
| | erc20_transfers_staging | 0 | ❌ | Schema ready, needs population |
| | erc20_transfers | ? | ? | Status unclear |
| **CLOB** | pm_trades | 537 | ❌ | Severely incomplete (~0.3% of actual volume) |
| | trades_raw | 159.5M | ✅ | Complete but with 0.79% corrupt records |
| **Bridge** | ctf_token_map | ? | ✅ | Presumed complete |
| | condition_market_map | 151.8K | ✅ | 98% of markets |
| | gamma_markets | 150K | ✅ | Complete catalog |
| **Mapping** | pm_user_proxy_wallets | ? | ⚠️ | Depends on ERC1155 ingest |
| **Analytics** | market_resolutions_final | 223.9K | ✅ | All resolved markets |
| | outcome_positions_v2 | ? | ✅ | Derived, presumed complete |

### End-to-End Coverage

```
Dimension                Coverage        Status
────────────────────────────────────────────────
Markets (gamma_markets)  150K / 151K     ✅ 99%
Resolved Markets         223K / 151K     ✅ 44% resolved
Wallet Trades (raw)      159M            ✅ 100% (if corrupt removed)
Wallet Trades (CLOB)     537             ❌ 0.3%
ERC1155 Transfers        ?               ❌ Needs backfill
ERC20 Transfers          ?               ❌ Needs backfill
Proxy Mappings           ?               ⚠️ Depends on ERC1155

CRITICAL PATH BLOCKERS:
1. ❌ pm_erc1155_flats is empty (blocks proxy mapping inference)
2. ❌ pm_trades is incomplete (need CLOB API backfill)
3. ❌ erc20_transfers not populated
```

---

## PART 11: Recommended Next Steps

### IMMEDIATE (Required for Trade History)

1. **Execute ERC1155 Backfill** (1-2 hours)
   ```bash
   npx tsx scripts/flatten-erc1155.ts
   ```
   - Populates pm_erc1155_flats with blockchain events
   - Enables proxy wallet mapping inference

2. **Infer Proxy Wallets** (30 minutes)
   ```bash
   npx tsx scripts/build-approval-proxies.ts
   ```
   - Uses pm_erc1155_flats to populate pm_user_proxy_wallets
   - Required for trade attribution

3. **Backfill CLOB Trades** (2-4 hours)
   ```bash
   npx tsx scripts/ingest-clob-fills-backfill.ts
   ```
   - Fetches all historical trades from Polymarket CLOB API
   - Handles pagination and rate limiting
   - Requires API access and historical crawl

### SECONDARY (Required for Complete P&L)

4. **Backfill ERC20 Transfers** (1-2 hours)
   - Implement script to ingest USDC transfers
   - Maps: proxy → USDC flows → user attribution

5. **Rebuild P&L Views** (2-3 hours)
   - Use verified formulas from trade_flows_v2
   - Replace broken realized_pnl_by_market_v2
   - Handle both resolved and unrealized positions

### VERIFICATION

6. **Data Quality Checks** (1 hour)
   ```sql
   -- Verify cross-table consistency
   SELECT COUNT(DISTINCT wallet) FROM pm_user_proxy_wallets;
   SELECT COUNT(DISTINCT token_id) FROM ctf_token_map;
   SELECT COUNT(DISTINCT market_id) FROM pm_erc1155_flats;
   ```

---

## Summary Tables

### Authoritative Sources for Each Data Type

| What You Need | Primary Source | Rows | Complete? | Notes |
|---------------|---|---|---|---|
| **CLOB Fills** | pm_trades | 537 | ❌ NO | Needs CLOB API backfill |
| **Alternative** | trades_raw | 159.5M | ✅ YES | Use with quality filters |
| **ERC1155 Xfers** | pm_erc1155_flats | 0 | ❌ NO | Schema ready, run flatten-erc1155.ts |
| **ERC20 Xfers** | erc20_transfers | ? | ❌ NO | Needs implementation |
| **Token Metadata** | ctf_token_map | ? | ✅ PRESUMED | Links tokens to markets |
| **Market Metadata** | gamma_markets | 150K | ✅ YES | Complete catalog |
| **Resolutions** | market_resolutions_final | 223K | ✅ YES | For resolved markets only |
| **Proxy Mapping** | pm_user_proxy_wallets | ? | ❌ BLOCKS on ERC1155 | Derived from transfers |

### Implementation Sequence

```
1. ✅ Schema exists (migrations 001-016 run)
2. ❌ ERC1155 backfill → pm_erc1155_flats
3. ❌ Proxy inference → pm_user_proxy_wallets
4. ❌ CLOB backfill → pm_trades (historical)
5. ❌ ERC20 backfill → erc20_transfers
6. ⚠️ Verify linkages (cross-table consistency)
7. ⚠️ Rebuild P&L views (using correct formulas)
```

---

## File Locations

- **Migrations**: `/migrations/clickhouse/` (001-016)
- **Backfill Scripts**: `/scripts/flatten-erc1155.ts`, `/scripts/ingest-clob-fills*.ts`
- **Reference Docs**: 
  - `/CLICKHOUSE_KEY_FINDINGS.md` (best summary)
  - `/CLICKHOUSE_EXPLORATION.md` (detailed schemas)
  - `/CASCADIAN_DATABASE_MASTER_REFERENCE.md` (comprehensive)
  - `/CLICKHOUSE_INVENTORY_REPORT.md` (data counts)

