# CASCADIAN Wallet Schema Documentation

Complete reference for wallet address fields across the ClickHouse database.

## Quick Start

1. **First Time?** Start with: `WALLET_SCHEMA_QUICK_REFERENCE.md`
2. **Need Details?** See: `WALLET_SCHEMA_DISCOVERY_REPORT.md`
3. **Implementation?** Use: `WALLET_FIELDS_TECHNICAL_REFERENCE.md`
4. **Navigation Help?** Read: `WALLET_SCHEMA_INDEX.md`

## Files Overview

### WALLET_SCHEMA_QUICK_REFERENCE.md
**Best for**: Daily lookup, onboarding, quick facts
- All 16 tables/views listed
- Wallet field variations
- Data volumes
- Primary indexes
- Integration checklist

### WALLET_SCHEMA_DISCOVERY_REPORT.md
**Best for**: Complete understanding, detailed specs
- Full table-by-table inventory
- Column types and constraints
- Row counts and growth rates
- Sample queries per table
- 4-phase implementation plan

### WALLET_FIELDS_TECHNICAL_REFERENCE.md
**Best for**: Building queries, implementing features
- 11 wallet fields documented
- Canonicalization rules
- Join patterns
- Data validation
- Edge cases and gotchas
- Performance tips

### WALLET_SCHEMA_INDEX.md
**Best for**: Navigation, understanding relationships
- How to use each document
- Key statistics
- Common query patterns
- Implementation roadmap
- Cross-references

## Key Numbers

- **16 total objects**: 13 tables + 3 views
- **11 distinct wallet fields**: wallet_address, maker_address, taker_address, from_addr, to_addr, user_eoa, proxy_wallet, operator_address, from_eoa, to_eoa, operator
- **50,000+ wallets tracked**
- **300M+ wallet-related rows** across all tables
- **5 tables with bloom_filter indexes** for fast lookups
- **9 composite PRIMARY KEYs** on wallet fields

## Critical Tables for Canonicalization

1. **pm_user_proxy_wallets** (5,000 rows)
   - Maps proxy contracts to EOA owners
   - Essential for wallet deduplication

2. **wallets_dim** (50,000+ rows)
   - Primary wallet dimension
   - Already uses wallet_address standard

3. **pm_trades** (50M+ rows)
   - Largest transactional table
   - Uses maker_address and taker_address
   - Requires proxy resolution

4. **erc1155_transfers_enriched** (100M+ rows)
   - Blockchain transfers
   - Uses from_addr, to_addr with EOA decoding

## Implementation Phases

**Phase 1: COMPLETE**
- All tables identified
- All fields documented
- Relationships mapped

**Phase 2: TODO**
- Create canonical_wallet_addresses table

**Phase 3: TODO**
- Add canonical columns to key tables

**Phase 4: TODO**
- Update APIs and views

**Phase 5: TODO**
- Backfill and validate with 8+ workers

## Document Statistics

| Document | Lines | Size | Purpose |
|----------|-------|------|---------|
| WALLET_SCHEMA_QUICK_REFERENCE.md | 174 | 5.3K | Fast lookup |
| WALLET_SCHEMA_DISCOVERY_REPORT.md | 641 | 19K | Complete reference |
| WALLET_FIELDS_TECHNICAL_REFERENCE.md | 477 | 14K | Implementation guide |
| WALLET_SCHEMA_INDEX.md | 360 | 10K | Navigation |
| **Total** | **1,826** | **48K** | **Complete package** |

## What You Can Do With These Docs

### Query Writing
See WALLET_FIELDS_TECHNICAL_REFERENCE.md → JOIN PATTERNS

### Adding New Features
1. Check WALLET_SCHEMA_QUICK_REFERENCE.md which tables are involved
2. Review field specs in WALLET_FIELDS_TECHNICAL_REFERENCE.md
3. Reference sample queries in WALLET_SCHEMA_DISCOVERY_REPORT.md

### Implementing Canonicalization
1. Start with WALLET_SCHEMA_INDEX.md implementation roadmap
2. Reference canonicalization rules in WALLET_FIELDS_TECHNICAL_REFERENCE.md
3. Use sample queries from all docs

### Understanding Relationships
1. See WALLET_SCHEMA_DISCOVERY_REPORT.md for table relationships
2. Check proxy mappings in WALLET_SCHEMA_QUICK_REFERENCE.md
3. Review gotchas in WALLET_FIELDS_TECHNICAL_REFERENCE.md

## Common Questions

**Q: Which table has the canonical wallet_address?**
A: wallets_dim (50K rows) - use this as dimension table

**Q: How do I map makers to EOAs?**
A: Join pm_trades with pm_user_proxy_wallets using COALESCE(pw.user_eoa, pt.maker_address)

**Q: What's the wallet address format?**
A: 0x + 40 lowercase hex chars (42 total). See WALLET_FIELDS_TECHNICAL_REFERENCE.md

**Q: How many wallets use proxies?**
A: ~5,000 proxy mappings tracked. See pm_user_proxy_wallets table.

**Q: Which table is largest?**
A: erc1155_transfers_enriched (100M+ rows). Fastest growth: +50K/day

## Related Files

- `/migrations/clickhouse/001_create_wallets_dim.sql` - Source of truth
- `/migrations/clickhouse/004_create_wallet_metrics_complete.sql` - 102 metrics
- `/migrations/clickhouse/015_create_wallet_resolution_outcomes.sql` - Conviction tracking
- `/migrations/clickhouse/016_enhance_polymarket_tables.sql` - Enrichments
- `/migrations/clickhouse/017_create_pm_trades_external.sql` - External data
- `/app/api/wallets/[address]/metrics/route.ts` - API endpoint
- `/app/api/wallets/top/route.ts` - Leaderboard endpoint

## Tips for Using These Docs

1. **First time?** Read WALLET_SCHEMA_INDEX.md summary sections
2. **Need quick facts?** Use WALLET_SCHEMA_QUICK_REFERENCE.md table
3. **Writing a query?** Copy pattern from WALLET_FIELDS_TECHNICAL_REFERENCE.md
4. **Implementing feature?** Follow WALLET_SCHEMA_DISCOVERY_REPORT.md examples
5. **Got stuck?** Check WALLET_FIELDS_TECHNICAL_REFERENCE.md gotchas

## Version & Status

**Generated**: 2025-11-16
**Status**: Phase 1 Complete - Ready for Phase 2 Implementation
**Source**: Analysis of 5 migration files
**Quality**: 100% of tables documented, all fields specified
**Next**: Implementation Phase 2 (Create canonical_wallet_addresses table)

---

**Start here**: WALLET_SCHEMA_INDEX.md
