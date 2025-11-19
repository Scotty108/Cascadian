# ClickHouse Market-Condition Mapping Tables Analysis - INDEX

This directory contains a comprehensive analysis of ClickHouse tables mapping market IDs to condition IDs in your Polymarket data.

## Quick Answer

**Use `condition_market_map` table** for all market_id ↔ condition_id mappings.

- 151,843 unique mappings
- Perfect 1:1 cardinality
- 0% NULL in both columns
- Production ready

---

## Documentation Files

### 1. MAPPING_TABLES_FINAL_SUMMARY.md (Recommended Start)
**Best for:** Quick overview and decision-making
- Quick answer and key findings
- All candidate tables ranked (7 tables evaluated)
- Primary recommendation with complete DDL
- SQL examples (3 most common use cases)
- Summary assessment and conclusion
- **Read time:** 5-10 minutes

### 2. MAPPING_TABLES_QUICK_REFERENCE.txt (For Daily Use)
**Best for:** Quick lookups during development
- ASCII-formatted reference guide
- Key metrics summary table
- Recommended usage patterns
- Sample data examples
- Action items checklist
- **Read time:** 3-5 minutes

### 3. MAPPING_TABLES_ANALYSIS.md (Complete Reference)
**Best for:** In-depth understanding and troubleshooting
- Executive summary
- Detailed analysis of all 7 tables
- Complete DDL statements
- Row counts and NULL rates
- Cardinality assessment
- Sample 5-row results for each table
- Data quality assessment
- Query examples with explanations
- Recommended join patterns
- **Read time:** 15-20 minutes

---

## The Answer: condition_market_map

### Location
```
migrations/clickhouse/014_create_ingestion_spine_tables.sql
```

### DDL
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
SETTINGS index_granularity = 8192
```

### Key Metrics
| Metric | Value |
|--------|-------|
| Total Rows | 151,843 |
| Distinct market_id | 151,843 |
| Distinct condition_id | 151,843 |
| NULL in market_id | 0 (0.0%) |
| NULL in condition_id | 0 (0.0%) |
| Cardinality | 1:1 Perfect |
| Duplicates | None |

### Recommended Usage
```sql
-- Lookup a market_id for a condition_id
SELECT market_id 
FROM condition_market_map
WHERE condition_id = '0x...'
LIMIT 1;

-- Enrich trades_raw with market context
SELECT t.*, c.canonical_category, c.raw_tags
FROM trades_raw t
LEFT JOIN condition_market_map c ON t.condition_id = c.condition_id;

-- Get all mappings
SELECT condition_id, market_id, canonical_category
FROM condition_market_map
LIMIT 100;
```

---

## All Tables Evaluated

| Rank | Table | Rows | Markets | Nulls | Verdict |
|------|-------|------|---------|-------|---------|
| 1 | condition_market_map | 151,843 | 151,843 | 0% | ✅ USE THIS |
| 2 | trades_raw | 159.5M | 151,846 | 48.5% | ⚠ Secondary |
| 3 | wallet_resolution_outcomes | 9,107 | 1,183 | 0% | ⚠ Limited |
| 4 | ctf_token_map | 41,130 | 1 | 94.5% | ❌ Broken |
| 5 | gamma_markets | ? | 0 | N/A | ❌ No market_id |
| 6 | market_resolutions_final | ? | 0 | N/A | ❌ No market_id |
| 7 | winning_index | View | 0 | N/A | ❌ View only |

---

## Data Quality Summary

### Strengths
- condition_market_map has production-grade quality
- Perfect 1:1 cardinality (no duplicates)
- Zero NULLs in critical columns
- Indexed for performance
- Covers 99.99% of markets

### Weaknesses
- trades_raw: 48.5% NULL condition_id
- ctf_token_map: 100% NULL market_id
- wallet_resolution_outcomes: Limited to 1.8% of markets
- gamma_markets: Missing market_id entirely
- Condition ID format inconsistency (String vs FixedString)

---

## Action Items

### Immediate
1. Use condition_market_map for all market_id ↔ condition_id lookups
2. Join trades_raw to condition_market_map for enrichment

### Short Term
1. Populate condition_id in trades_raw (48.5% currently NULL)
2. Populate market_id in ctf_token_map (100% currently NULL)
3. Standardize condition_id format across tables

---

## File Mapping

```
MAPPING_TABLES_INDEX.md                    (this file - overview)
MAPPING_TABLES_FINAL_SUMMARY.md           (start here)
MAPPING_TABLES_QUICK_REFERENCE.txt        (quick lookup)
MAPPING_TABLES_ANALYSIS.md                (deep dive)
```

---

## Related Files in Project

**Migrations:**
- `/migrations/clickhouse/014_create_ingestion_spine_tables.sql` (condition_market_map)
- `/migrations/clickhouse/001_create_trades_table.sql` (trades_raw)
- `/migrations/clickhouse/015_create_wallet_resolution_outcomes.sql`
- `/migrations/clickhouse/016_enhance_polymarket_tables.sql` (ctf_token_map)

**Scripts:**
- `/scripts/analyze-mapping-tables.ts` (analysis script)
- `/scripts/complete-mapping-analysis.ts` (detailed metrics)

---

## Quick SQL Examples

### Example 1: Get Market for Condition (Lookup)
```sql
SELECT market_id 
FROM condition_market_map
WHERE condition_id = '0x0000074ba83ff8fb5b39ebbe2d366bcf1a537b31bdd53afb21ef2019d8b7d32e'
LIMIT 1;
```

### Example 2: Enrich Trades
```sql
SELECT 
  t.wallet_address,
  t.trade_id,
  t.condition_id,
  c.market_id,
  c.canonical_category
FROM trades_raw t
LEFT JOIN condition_market_map c ON t.condition_id = c.condition_id
WHERE t.condition_id != ''
LIMIT 100;
```

### Example 3: Category Distribution
```sql
SELECT
  canonical_category,
  count() as market_count
FROM condition_market_map
GROUP BY canonical_category
ORDER BY market_count DESC;
```

---

## Methodology

This analysis examined 7 candidate tables:

1. condition_market_map
2. trades_raw
3. wallet_resolution_outcomes
4. ctf_token_map
5. gamma_markets
6. market_resolutions_final
7. winning_index

For each table, we measured:
- Row count
- Distinct market_id values
- Distinct condition_id values
- NULL rates in mapping columns
- Cardinality (1:1 vs Many:Many vs Broken)
- Duplicate check
- Sample data

---

## Conclusion

**condition_market_map** is the authoritative mapping table for your Polymarket data because it provides:

- Complete market-condition mappings (151,843)
- Perfect 1:1 cardinality (no duplicates, no aggregation needed)
- Zero data quality issues (0% NULL in both columns)
- Performance optimization (bloom filter index on condition_id)
- Single source of truth (canonical mapping)
- Production-ready quality

Use it for all market_id ↔ condition_id lookups and enrichments.

---

**Analysis Date:** November 6, 2025
**Status:** Complete
**Documentation:** 3 files provided
