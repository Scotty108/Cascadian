# TRADES DATA INGESTION - DOCUMENTATION INDEX

**Complete reference guide to understanding how Cascadian ingests and processes Polymarket trades**

---

## DOCUMENTS CREATED

### 1. TRADES_INGESTION_QUICK_REFERENCE.md (START HERE)
- **Length:** 3 pages
- **Time to read:** 5-10 minutes
- **Best for:** Quick lookup, answers most common questions
- **Contains:**
  - Where is the trades data?
  - Data ingestion sources overview
  - Direction assignment logic (simple version)
  - Common SQL queries
  - Critical gotchas and fixes
  - Validation checklist

### 2. TRADES_INGESTION_COMPREHENSIVE_GUIDE.md (DETAILED)
- **Length:** 15+ pages
- **Time to read:** 20-30 minutes
- **Best for:** Deep understanding, implementation details
- **Contains:**
  - Complete data flow diagram (with ASCII visualization)
  - All 5 data ingestion methods (blockchain, CLOB API, Goldsky, etc.)
  - ERC1155 → Direction → Trades complete walkthrough
  - Full direction assignment algorithm (step-by-step)
  - All table schemas with column descriptions
  - Historical backfill strategies (3 options: API, Blockchain, Hybrid)
  - Running full backfill (commands, expected runtime)
  - Critical gotchas (detailed explanations)
  - Production query template
  - Troubleshooting and validation queries
  - File reference and key metrics

---

## RELATED EXISTING DOCUMENTS (REFERENCED)

### Schema & Architecture
- **DATABASE_ARCHITECTURE_REFERENCE.md** (Nov 9, 2025)
  - Authoritative schema documentation
  - Canonical mapping layer
  - P&L stack diagram
  - Known gotchas with details

- **POLYMARKET_DATA_FLOW_DIAGRAM.md** (Nov 6, 2025)
  - Visual pipeline diagram
  - Phase-by-phase walkthrough
  - Entity-relationship model
  - Detailed data transformations

### Data Quality & Investigation
- **SMOKING_GUN_FINDINGS.md** (Nov 8, 2025)
  - Data quality analysis (82M trades with condition_ids)
  - Table comparison (trades_raw vs trades_with_direction vs trades_dedup_mat_new)
  - Recommended table usage
  - Coverage analysis (77%+)

- **BACKFILL_INVESTIGATION_FINAL_REPORT.md** (Nov 10, 2025)
  - Complete table audit (148 tables scanned)
  - Coverage findings per table
  - Why data exists/doesn't exist in each table
  - Options for missing data backfill

- **CASCADIAN_DATABASE_MASTER_REFERENCE.md** (DEPRECATED)
  - Note: Superseded by DATABASE_ARCHITECTURE_REFERENCE.md
  - Read for historical context only

### Key Implementation Files
- `/scripts/step3-streaming-backfill-parallel.ts` - 8-worker blockchain sync
- `/worker-clob-api.ts` - CLOB API market mapping
- `/scripts/flatten-erc1155.ts` - ERC1155 event decoding
- `/migrations/clickhouse/001_create_trades_table.sql` - Schema definition

### Best Practices
- **CLAUDE.md** (Project-wide guidelines)
  - Stable Pack: ID normalization, direction assignment, PnL formulas
  - ClickHouse array rules (1-indexed)
  - Atomic rebuild patterns
  - Skill labels (IDN, NDR, PNL, AR, CAR, JD, GATE, @ultrathink)

---

## QUICK LOOKUP BY QUESTION

### "Where do I find the trades data?"
**→ Start with:** TRADES_INGESTION_QUICK_REFERENCE.md § 1
**→ Then read:** TRADES_INGESTION_COMPREHENSIVE_GUIDE.md § 3

### "How are trades created?"
**→ Start with:** TRADES_INGESTION_QUICK_REFERENCE.md § 4
**→ Detailed:** TRADES_INGESTION_COMPREHENSIVE_GUIDE.md § 2.1-2.2
**→ Visual:** POLYMARKET_DATA_FLOW_DIAGRAM.md § Detailed Data Flow

### "How is direction assigned?"
**→ Quick:** TRADES_INGESTION_QUICK_REFERENCE.md § 5 (5-second version)
**→ Detailed:** TRADES_INGESTION_COMPREHENSIVE_GUIDE.md § 5
**→ Diagram:** POLYMARKET_DATA_FLOW_DIAGRAM.md § PHASE 4-5
**→ Best practices:** CLAUDE.md § Stable Pack (NDR skill)

### "How do I write a query that joins trades and resolutions?"
**→ Start with:** TRADES_INGESTION_QUICK_REFERENCE.md § 7 (Common Queries)
**→ Template:** TRADES_INGESTION_COMPREHENSIVE_GUIDE.md § 7 (Production Query)
**→ Gotchas:** TRADES_INGESTION_COMPREHENSIVE_GUIDE.md § 6
**→ Best practices:** CLAUDE.md § Stable Pack (IDN, CAR skills)

### "Why is my join returning 0 rows?"
**→ Fast answer:** TRADES_INGESTION_QUICK_REFERENCE.md § 9 (Gotchas table)
**→ Detailed:** TRADES_INGESTION_COMPREHENSIVE_GUIDE.md § 6.1-6.5 (Gotchas)
**→ Debugging:** TRADES_INGESTION_COMPREHENSIVE_GUIDE.md § 8.2 (Troubleshooting)

### "How do I run a full historical backfill?"
**→ Commands:** TRADES_INGESTION_QUICK_REFERENCE.md § 8
**→ Detailed:** TRADES_INGESTION_COMPREHENSIVE_GUIDE.md § 4 (Backfill Strategy)
**→ 3 options:** TRADES_INGESTION_COMPREHENSIVE_GUIDE.md § 4.2

### "What's the difference between trades_with_direction and vw_trades_canonical?"
**→ Compare:** TRADES_INGESTION_COMPREHENSIVE_GUIDE.md § 3.1 vs § 3.2
**→ Or:** SMOKING_GUN_FINDINGS.md (full analysis)

### "What's the current data coverage?"
**→ Quick:** TRADES_INGESTION_QUICK_REFERENCE.md § 1 & § 11
**→ Detailed:** TRADES_INGESTION_COMPREHENSIVE_GUIDE.md § 10 (Key Metrics)
**→ Analysis:** SMOKING_GUN_FINDINGS.md (comprehensive audit)

### "I need to backfill a specific wallet from 2024"
**→ Best method:** TRADES_INGESTION_COMPREHENSIVE_GUIDE.md § 4.2 (Option A: API)
**→ Implementation:** BACKFILL_INVESTIGATION_FINAL_REPORT.md § Recommended Next Steps

### "How do I calculate PnL correctly?"
**→ Formula:** TRADES_INGESTION_COMPREHENSIVE_GUIDE.md § 7 (Production Query)
**→ Array indexing:** TRADES_INGESTION_QUICK_REFERENCE.md § 9 (Gotchas)
**→ Best practices:** CLAUDE.md § Stable Pack (PNL, CAR skills)

---

## DOCUMENT HIERARCHY

```
START HERE (5 min read)
    ↓
TRADES_INGESTION_QUICK_REFERENCE.md
    ├─→ Need more detail?
    │   ↓
    │   TRADES_INGESTION_COMPREHENSIVE_GUIDE.md
    │
    ├─→ Want visuals?
    │   ↓
    │   POLYMARKET_DATA_FLOW_DIAGRAM.md
    │
    └─→ Need to understand schema?
        ↓
        DATABASE_ARCHITECTURE_REFERENCE.md

        ↓ (Deep dives)
        
SMOKING_GUN_FINDINGS.md (data quality analysis)
BACKFILL_INVESTIGATION_FINAL_REPORT.md (table audit)
CLAUDE.md § Stable Pack (SQL best practices)
```

---

## KEY NUMBERS TO REMEMBER

| Metric | Value | Source |
|--------|-------|--------|
| **Primary trade table** | 82.1M rows | trades_with_direction |
| **Enriched view** | 157M rows | vw_trades_canonical |
| **Unique wallets** | 936K+ | Current coverage |
| **Unique markets** | 150K+ | Condition IDs |
| **Data span** | 1,048 days | Dec 2022 - Oct 2025 |
| **Direction coverage** | 77% (63M) | HIGH confidence trades |
| **Resolved markets** | 224K | 25% of all markets |
| **Backfill time (single)** | 2-5 hours | Full 1,048 days |
| **Backfill time (parallel)** | 20-40 min | 8 workers |
| **API rate limit** | 100 req/s | CLOB API |
| **RPC block chunk** | 2,000 blocks | Polygon standard |

---

## CRITICAL RULES (MEMORIZE THESE)

1. **ID NORMALIZATION (IDN):** `lower(replaceAll(condition_id, '0x', ''))`
2. **DIRECTION (NDR):** BUY if `token_net > 0 AND usdc_net > 0`; SELL if opposite
3. **PNL FORMULA (PNL):** `shares * (arrayElement(payouts, winning_idx + 1) / denom) - cost`
4. **ARRAY INDEXING (CAR):** ClickHouse is 1-indexed, so use `+1` on outcome index
5. **FIXEDSTRING CAST:** Always `toString(FixedString_column)` before comparing

---

## DATA PIPELINE STAGES

```
Stage 1: Raw Ingestion
  - ERC1155 events from blockchain
  - USDC transfers from ERC20 logs
  - Market metadata from CLOB API
  Tables: erc1155_transfers, erc20_transfers_decoded, clob_market_mapping

Stage 2: Decoding & Flattening
  - Extract addresses, amounts, token IDs from event logs
  - Decompose batch transfers into individual rows
  - Identify proxy wallets from ApprovalForAll events
  Tables: pm_erc1155_flats, pm_user_proxy_wallets, ctf_token_map

Stage 3: Direction Assignment
  - Calculate net flows for each transaction
  - Infer BUY/SELL from token and USDC flows
  - Assign confidence levels
  Output: direction_from_transfers column populated

Stage 4: Canonical Tables
  - Normalize all condition_ids to standard format
  - Enrich with market metadata and user info
  - Create normalized, production-ready tables
  Tables: trades_with_direction, vw_trades_canonical

Stage 5: Resolution Joins
  - Join trades with market_resolutions_final
  - Assign payout vectors and winning indices
  - Calculate realized P&L
  Tables: vw_wallet_pnl_closed, vw_wallet_pnl_all, vw_wallet_pnl_settled
```

---

## NEXT STEPS FOR COMMON TASKS

### Want to run a query?
1. Read TRADES_INGESTION_QUICK_REFERENCE.md § 7
2. Apply gotchas from § 9
3. Validate results with § 14 checklist

### Want to backfill missing data?
1. Read TRADES_INGESTION_COMPREHENSIVE_GUIDE.md § 4.2 (3 options)
2. Choose Option A (API) for speed or Option C (Hybrid) for verification
3. Follow § 4.3 for exact commands and environment setup

### Want to understand why a query is wrong?
1. Check TRADES_INGESTION_QUICK_REFERENCE.md § 9 (Gotchas)
2. Read TRADES_INGESTION_COMPREHENSIVE_GUIDE.md § 6 (Details)
3. Try TRADES_INGESTION_COMPREHENSIVE_GUIDE.md § 8.2 (Troubleshooting)

### Want to optimize query performance?
1. Read TRADES_INGESTION_QUICK_REFERENCE.md § 10 (Performance Tips)
2. Apply in your where/having clauses
3. Test with TRADES_INGESTION_COMPREHENSIVE_GUIDE.md § 8.1 (Validation Queries)

---

## DOCUMENT MAINTENANCE

- **Last Updated:** November 9, 2025
- **Maintained By:** Cascadian Data Platform Team
- **Review Cycle:** Monthly (or when schema changes)
- **Status:** CURRENT & AUTHORITATIVE

---

## QUICK NAVIGATION

| Need | Document | Section |
|------|----------|---------|
| **5-min overview** | TRADES_INGESTION_QUICK_REFERENCE.md | § 1-2 |
| **Direction logic** | TRADES_INGESTION_COMPREHENSIVE_GUIDE.md | § 5 |
| **Common queries** | TRADES_INGESTION_QUICK_REFERENCE.md | § 7 |
| **Backfill commands** | TRADES_INGESTION_QUICK_REFERENCE.md | § 8 |
| **Gotchas** | TRADES_INGESTION_QUICK_REFERENCE.md | § 9 |
| **Production template** | TRADES_INGESTION_COMPREHENSIVE_GUIDE.md | § 7 |
| **Data flow diagram** | POLYMARKET_DATA_FLOW_DIAGRAM.md | Complete |
| **Schema details** | DATABASE_ARCHITECTURE_REFERENCE.md | § 2-3 |
| **Data quality** | SMOKING_GUN_FINDINGS.md | Complete |
| **Best practices** | CLAUDE.md | Stable Pack section |

---

**Index Version:** 1.0
**Last Generated:** November 9, 2025
**Estimated Completeness:** 100% (all major topics covered)
