# Data Transformation & Mapping Logic - Quick Reference Index

**Complete Documentation:** `/Users/scotty/Projects/Cascadian-app/DATA_TRANSFORMATION_COMPLETE_DOCUMENTATION.md`

## Quick Links to Key Sections

### Normalization Patterns
- **IDN** (condition_id normalization): `lower(replaceAll(condition_id, '0x', ''))`
  - Used in: `/scripts/run-market-id-normalization.ts:155`, `/scripts/delta-probes-abc.ts:66,119,155,169`
  
- **Wallet address normalization**: `lower(wallet_address)`
  - Used in: `/scripts/build-trades-dedup-mat.ts:85`

### Field Transformations

| Pattern | Formula | Files |
|---------|---------|-------|
| **NDR** - Direction | `side = BUY if usdc_net > 0 AND token_net > 0` | `/scripts/step4-settlement-rules.ts:101-103` |
| **CAR** - Array Index | `arrayElement(outcomes, outcome_index + 1)` | `/scripts/enrich-token-map.ts:141,216` |
| **PNL** - Cashflow | `price * shares * sign - fees` | `/scripts/run-market-id-normalization.ts:192-195` |
| **PNL** - Settlement | `shares * payout_per_share if condition met, else 0` | `/scripts/step4-settlement-rules.ts:106-119` |

### Mapping Tables

| Table | Purpose | Created By |
|-------|---------|-----------|
| `condition_market_map` | condition_id → market_id | gamma_markets join |
| `pm_tokenid_market_map` | token_id → market outcome | `/scripts/map-tokenid-to-market.ts` |
| `ctf_token_map` | Complete token metadata | `/scripts/enrich-token-map.ts` |
| `winning_index` | condition_id_norm → winning outcome | `/scripts/step5-outcome-mapping.ts` |
| `market_resolutions_final` | Full resolution + payout vectors | Multiple scripts |

### Data Source Chains

**CLOB → Trades:**
- `/scripts/ingest-clob-fills.ts` → trades_raw
- `/scripts/build-trades-dedup-mat.ts` → trades_dedup_mat (deduplicated)

**ERC1155 → Positions:**
- `/scripts/flatten-erc1155.ts` → pm_erc1155_flats
- `/scripts/build-approval-proxies.ts` → pm_user_proxy_wallets (parallel)
- `/scripts/enrich-token-map.ts` → token_market_enriched (join both)

**Market Data → Outcomes:**
- Gamma API → gamma_markets
- `/scripts/map-tokenid-to-market.ts` → pm_tokenid_market_map
- `/scripts/enrich-token-map.ts` → ctf_token_map (enriched)
- `/scripts/step5-outcome-mapping.ts` → winning_index

### Join Patterns

**Pattern 1: Trade → Resolution (PnL)**
```sql
FROM trades_dedup_mat t
LEFT JOIN winning_index m 
  ON lower(replaceAll(t.condition_id, '0x', '')) = m.condition_id_norm
```
Used in: `/scripts/run-market-id-normalization.ts:264`, `/scripts/delta-probes-abc.ts`

**Pattern 2: Position → Outcome (Holdings)**
```sql
FROM pm_erc1155_flats f
LEFT JOIN token_market_enriched t ON f.token_id = t.token_id
```
Used in: `/migrations/clickhouse/016_enhance_polymarket_tables.sql:191`

**Pattern 3: Proxy Resolution**
```sql
FROM pm_erc1155_flats f
LEFT JOIN pm_user_proxy_wallets p ON lower(f.from_addr) = lower(p.proxy_wallet)
```
Used in: `/migrations/clickhouse/016_enhance_polymarket_tables.sql:176`

### Key Files by Purpose

**Normalization:**
- `/scripts/build-trades-dedup-mat.ts` - Deduplication + normalization
- `/scripts/run-market-id-normalization.ts` - Normalization migration
- `/scripts/validate-outcome-mapping-final.ts` - Verification

**Mapping:**
- `/scripts/map-tokenid-to-market.ts` - Token → market
- `/scripts/enrich-token-map.ts` - Token enrichment (**CAR** pattern)
- `/scripts/step5-outcome-mapping.ts` - Resolution → index
- `/scripts/validate-outcome-mapping.ts` - Mapping validation

**Settlement & PnL:**
- `/scripts/step4-settlement-rules.ts` - Settlement logic (**NDR** + **PNL**)
- `/scripts/test-settlement-rules.ts` - Unit tests
- `/scripts/calculate-realized-pnl.ts` - End-to-end PnL

**Ingestion:**
- `/scripts/ingest-clob-fills.ts` - CLOB API → trades
- `/scripts/flatten-erc1155.ts` - ERC1155 decoding
- `/scripts/build-approval-proxies.ts` - Proxy mapping

**Verification:**
- `/scripts/coverage-monitor.ts` - **JD** join audit
- `/scripts/analyze-mapping-tables.ts` - Data quality
- `/scripts/diagnostic-final-validation.ts` - End-to-end

**Views:**
- `/migrations/clickhouse/016_enhance_polymarket_tables.sql:104` - markets_enriched
- `/migrations/clickhouse/016_enhance_polymarket_tables.sql:138` - token_market_enriched
- `/migrations/clickhouse/016_enhance_polymarket_tables.sql:191` - erc1155_transfers_enriched
- `/migrations/clickhouse/016_enhance_polymarket_tables.sql:233` - wallet_positions_current

### Critical Gotchas

1. **ClickHouse arrays are 1-indexed** → Always `arrayElement(arr, idx + 1)`
2. **Normalize before joining** → `lower(replaceAll(condition_id, '0x', ''))`
3. **Signed cashflows** → BUY negative, SELL positive
4. **Settlement logic** → BUY+WIN=payout, BUY+LOSE=0, SELL+LOSE=payout, SELL+WIN=0
5. **Payout vectors** → Array(UInt64) divided by denominator

### Core Schemas

**trades_dedup_mat** (ReplacingMergeTree)
- dedup_key, wallet_address, market_id, condition_id, outcome_index
- side, entry_price, shares, transaction_hash, log_index, block_number

**ctf_token_map**
- token_id, condition_id, condition_id_norm, market_id
- outcome, outcome_index, question

**pm_erc1155_flats**
- block_number, block_time, tx_hash, log_index
- operator, from_addr, to_addr, token_id, amount, event_type

**winning_index**
- condition_id_norm, winning_index, resolved_at, resolver_method

**Aggregation Views:**
- **outcome_positions_v2**: wallet, condition_id_norm, outcome_idx, net_shares
- **trade_cashflows_v3**: wallet, condition_id_norm, outcome_idx, px, sh, cashflow_usdc

### Stable Pattern Labels (From CLAUDE.md)

- **IDN** - ID Normalization
- **NDR** - Net Direction Resolver  
- **PNL** - PnL from Vector
- **CAR** - ClickHouse Array Rule
- **AR** - Atomic Rebuild
- **JD** - Join Discipline
- **GATE** - Quality Thresholds

---

**See complete documentation:** `DATA_TRANSFORMATION_COMPLETE_DOCUMENTATION.md` (964 lines)
