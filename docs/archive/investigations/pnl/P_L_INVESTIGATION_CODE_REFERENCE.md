# P&L Investigation - Code File Reference

## Schema Files (Read These First)

### 1. Condition ID Column Definition
**File:** `/Users/scotty/Projects/Cascadian-app/migrations/clickhouse/003_add_condition_id.sql`

**What it shows:**
- How condition_id column was added to trades_raw
- Indexed with bloom_filter for fast joins
- Defined as String with empty default

**Status:** Column exists but only 51% populated

---

### 2. Market-Condition Mapping Table (THE FIX)
**File:** `/Users/scotty/Projects/Cascadian-app/migrations/clickhouse/014_create_ingestion_spine_tables.sql`

**What it contains:**
- `condition_market_map` table (151,843 rows, perfect 1:1)
- Markets_dim and events_dim tables
- Complete data enrichment strategy

**Key section:**
```sql
CREATE TABLE IF NOT EXISTS condition_market_map (
  condition_id String,
  market_id String,
  event_id String,
  canonical_category String,
  raw_tags Array(String),
  ingested_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY (condition_id)
```

**Status:** Production ready - use this for all condition→market lookups

---

### 3. Wallet Resolution Outcomes
**File:** `/Users/scotty/Projects/Cascadian-app/migrations/clickhouse/015_create_wallet_resolution_outcomes.sql`

**What it tracks:**
- Whether wallet held winning side at resolution
- Links wallet → condition_id → resolved_outcome
- Used for conviction accuracy metrics

**Status:** Limited scope (9,107 rows), high quality

---

### 4. Polymarket Table Enhancements
**File:** `/Users/scotty/Projects/Cascadian-app/migrations/clickhouse/016_enhance_polymarket_tables.sql`

**What it creates:**
- ctf_token_map (broken - DO NOT USE)
- pm_trades (CLOB fills table)
- markets_enriched view (gamma_markets + market_resolutions_final)
- token_market_enriched view
- erc1155_transfers_enriched view
- wallet_positions_current view

**Status:** Schema designed but many views not populated

---

## Ingestion Scripts (These Populate condition_id)

### Path 1: CLOB Fills API
**File:** `/Users/scotty/Projects/Cascadian-app/scripts/ingest-clob-fills-correct.ts`

**What it does:**
- Fetches trades from `https://data-api.polymarket.com`
- Extracts conditionId field from response
- Inserts into trades_raw

**Coverage:** ~40-50% (API field not always present)

**Key interface:**
```typescript
interface ClaimTrade {
  id?: string;
  transaction_hash?: string;
  maker?: string;
  taker?: string;
  market?: string;
  price?: string | number;
  size?: string | number;
  side?: string;
  timestamp?: number;
  proxyWallet?: string;
  conditionId?: string;  // THIS FIELD IS OPTIONAL - causes sparsity
  asset?: string;
}
```

---

### Path 2: Goldsky Blockchain Load
**File:** `/Users/scotty/Projects/Cascadian-app/scripts/goldsky-parallel-ingestion.ts` (and variants)

**What it does:**
- Loads historical data from Goldsky API
- Decodes ERC-1155 token IDs to extract condition_id
- Uses 8-worker parallelism

**Coverage:** Adds ~10-15% (token decode success rate)

**Status:** Complex, partially working

---

### Path 3: Enrichment Discovery (READ-ONLY)
**File:** `/Users/scotty/Projects/Cascadian-app/scripts/backfill-market-ids.ts`

**What it does:**
- Scans trades_raw for missing condition_id/market_id
- Queries Polymarket Gamma API for lookups
- Generates `data/backfilled_market_ids.json`

**Key section:**
```typescript
async function fetchMarketIdFromExternal(conditionId: string): Promise<string | null> {
  try {
    const url = `https://gamma-api.polymarket.com/markets?condition_id=${conditionId}`
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000)
    })
    if (!response.ok) return null
    // ... extract market_id from response
  } catch (e) {
    return null
  }
}
```

**Status:** ❌ READ-ONLY - generates recommendations but **NEVER APPLIES** the UPDATE

**Issue:** This is where the gap comes from - the enrichment data exists but isn't used!

---

## P&L Calculation Scripts

### Main P&L Calculation
**File:** `/Users/scotty/Projects/Cascadian-app/scripts/realized-pnl-final-fixed.ts`

**What it creates (in order):**
1. `trades_dedup` - Deduplicate trades_raw by trade_id
2. `canonical_condition` - Normalize condition IDs
3. `trade_cashflows_v3` - Calculate USDC flows per trade
4. `outcome_positions_v2` - Net position per wallet/market/outcome
5. `realized_pnl_by_market_final` - Settlement per market
6. `wallet_realized_pnl_final` - Sum per wallet
7. `wallet_unrealized_pnl_v2` - Open positions (if exists)
8. `wallet_pnl_summary_final` - **The output** (FULL JOIN of realized + unrealized)

**Key formula (settlement):**
```sql
-- Realized P&L = Cashflow from trades + Payout at resolution
realized_pnl_usd = total_cashflow + net_shares_at_resolution
```

**Coverage:** Only trades on resolved markets (~59 conditions for targets)

---

### Diagnostic Tools

#### Gap Analysis
**File:** `/Users/scotty/Projects/Cascadian-app/scripts/diagnostic-final-gap-analysis.ts`

**What it checks:**
1. Are wallets in trades_raw with exact addresses?
2. Trade counts and market coverage
3. Can trades match to winning_index (resolutions)?
4. What does wallet_pnl_summary_final currently show?
5. Is the gap explained by unresolved trades?
6. Sample matched vs unmatched trades

**Run this first when debugging P&L issues**

---

#### Detailed P&L Debug
**File:** `/Users/scotty/Projects/Cascadian-app/scripts/debug-realized-pnl.ts`

**What it checks:**
1. Duplicate trades in trades_raw
2. Trade counts per market
3. Outcome index consistency
4. Bridge coverage gaps
5. Sample cashflow calculation
6. P&L calculation method comparison
7. NULL values in key fields
8. Top 5 profitable/loss-making markets

**Run this for deep-dive investigation**

---

## Resolution Data Sources

### Primary: market_resolutions_final
**Source:** Polymarket API (resolution endpoint)

**Fields:**
- condition_id_norm (normalized: lowercase, no 0x)
- winner (outcome label)
- winning_outcome_index (0 or 1)
- resolution_source (where it came from)
- resolved_at (DateTime)
- is_resolved (UInt8)

**Coverage:** 223,973 rows total, but only ~59-137K unique conditions

---

### Derived: winning_index (VIEW)
**File:** Derived from market_resolutions_final

**What it does:**
- Joins resolution outcomes to market_outcomes_expanded
- Maps winning outcome label to index
- Used in PnL calculations

**Key query pattern:**
```sql
LEFT JOIN winning_index wi 
  ON lower(replaceAll(t.condition_id, '0x', '')) = wi.condition_id_norm
```

---

## Supporting Reference Files

### Data Quality Report
**File:** `/Users/scotty/Projects/Cascadian-app/CLICKHOUSE_INVENTORY_REPORT.md`

**Contains:**
- Table inventory (all 48 tables)
- Row counts and data ranges
- NULL analysis per column
- Duplicate detection
- Market and wallet coverage
- Data quality summary

---

### Mapping Table Summary
**File:** `/Users/scotty/Projects/Cascadian-app/MAPPING_TABLES_FINAL_SUMMARY.md`

**Contains:**
- All tables with market_id + condition_id
- Coverage analysis
- Null rates
- Sample data
- Cardinality analysis
- Recommendations on which to use

---

### P&L Reconciliation Diagnosis
**File:** `/Users/scotty/Projects/Cascadian-app/PNL_RECONCILIATION_DIAGNOSIS.md`

**Contains:**
- Root cause analysis
- Evidence of data gaps
- Target vs calculated P&L
- Why existing views don't match
- Technical findings

---

## Configuration & Constants

### Blockchain Contract
**In scripts:** Conditional Tokens contract address auto-detected via `scripts/phase0-detect-ct.ts`

```typescript
SELECT contract as address, count() AS n
FROM erc1155_transfers
GROUP BY contract
ORDER BY n DESC
LIMIT 5
```

---

### Target Wallets (Hardcoded in diagnostic scripts)
```typescript
const wallet1 = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8';  // HolyMoses7
const wallet2 = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0';  // niggemon

const expected = {
  [wallet1]: 89975.16,
  [wallet2]: 102001.46
};
```

---

### Expected Output Format
**P&L Summary should return:**
```json
{
  "wallet": "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8",
  "realized_pnl_usd": 52090.38,
  "unrealized_pnl_usd": 6008.54,
  "total_pnl_usd": 58098.92
}
```

**Current vs Expected:**
- Expected: $89,975.16
- Actual: $58,098.92
- Gap: -$31,876.24 (-35.4%)

---

## File Dependency Chain

```
migrations/clickhouse/001_create_trades_table.sql
├── migrations/clickhouse/003_add_condition_id.sql
├── migrations/clickhouse/014_create_ingestion_spine_tables.sql
│   └── condition_market_map (THE KEY TABLE)
├── migrations/clickhouse/015_create_wallet_resolution_outcomes.sql
└── migrations/clickhouse/016_enhance_polymarket_tables.sql
    └── market_resolutions_final (required)

Data Ingestion Path:
scripts/ingest-clob-fills-correct.ts → trades_raw
scripts/goldsky-parallel-ingestion.ts → trades_raw
scripts/backfill-market-ids.ts → data/backfilled_market_ids.json (not applied!)

P&L Calculation:
scripts/realized-pnl-final-fixed.ts
├── Uses: trades_raw
├── Joins: condition_market_map
├── Joins: winning_index (derived from market_resolutions_final)
└── Creates: wallet_pnl_summary_final

Diagnostic Tools:
scripts/diagnostic-final-gap-analysis.ts → identifies gaps
scripts/debug-realized-pnl.ts → detailed analysis
```

---

## Quick Command Reference

**Check condition_market_map:**
```bash
cd /Users/scotty/Projects/Cascadian-app
# No command - this is a ClickHouse table, query directly via client
```

**Run diagnostics:**
```bash
npx tsx scripts/diagnostic-final-gap-analysis.ts
npx tsx scripts/debug-realized-pnl.ts
```

**Apply the P0 fix (via ClickHouse client):**
```bash
# See P_L_INVESTIGATION_QUICK_REFERENCE.md for SQL
```

---

Generated: November 6, 2025
Last updated: Ready for P0 implementation
