# Cascadian Schema Mapping - Documentation Index

This directory now contains a complete analysis of the 87-table ClickHouse schema, mapping wallet trade history and blockchain event data.

## Quick Navigation

### 1. **SCHEMA_MAPPING_EXECUTIVE_SUMMARY.md** (START HERE)
   - Quick answers to key questions
   - Wallet trade history reconstruction path
   - Critical blockers preventing completion
   - Recommended fix sequence

### 2. **SCHEMA_MAPPING_ANALYSIS.md** (COMPREHENSIVE)
   - Detailed analysis of all data layers
   - Complete table specifications with column details
   - Data quality issues documented
   - Join patterns for reconstruction

### 3. **SCHEMA_MAPPING_TABLE_REFERENCE.txt** (QUICK LOOKUP)
   - One-page table status reference
   - Row counts and completion status
   - Layer-by-layer organization
   - Key insights summary

## Key Findings

### The 3 Data Sources for Wallet History

1. **CLOB Fills (Order Book Trades)**
   - Primary: `pm_trades` (537 rows, incomplete)
   - Fallback: `trades_raw` (159.5M rows, complete)
   - Status: ⚠️ Needs CLOB API backfill

2. **ERC1155 Transfers (Position Changes)**
   - Source: `pm_erc1155_flats` (schema ready, 0 rows)
   - Status: ❌ Needs blockchain event ingestion

3. **ERC20 Transfers (USDC Flows)**
   - Source: `erc20_transfers` (not implemented)
   - Status: ❌ Needs implementation

### Critical Blockers

| Blocker | Table | Status | Fix Time |
|---------|-------|--------|----------|
| ERC1155 not ingested | pm_erc1155_flats | ❌ 0 rows | 1-2 hours |
| CLOB incomplete | pm_trades | ❌ 537/10M rows | 2-4 hours |
| USDC not implemented | erc20_transfers | ❌ N/A | 1-2 hours |
| Proxy mapping | pm_user_proxy_wallets | ❌ Blocked | 30 mins (after ERC1155) |

**Total Time to Complete: 8-12 hours**

### What's Ready to Use

✅ `trades_raw` - 159.5M complete trades (filter market_id != '12')
✅ `gamma_markets` - 150K market metadata
✅ `market_resolutions_final` - 223.9K resolved markets
✅ `trade_flows_v2` - Correct cashflow calculations
✅ `wallet_pnl_summary_v2` - Working P&L (-2.3% accuracy)

### What's Broken

❌ `pm_erc1155_flats` - Schema only, no data
❌ `pm_trades` - Only 537 rows (0.3% complete)
❌ `erc20_transfers` - Not implemented
❌ `realized_pnl_by_market_v2` - 36x inflation bug
❌ `pm_user_proxy_wallets` - Can't populate without ERC1155

## Implementation Sequence

```
1. Execute ERC1155 backfill
   └─> npx tsx scripts/flatten-erc1155.ts

2. Infer proxy wallets (depends on #1)
   └─> npx tsx scripts/build-approval-proxies.ts

3. Backfill CLOB trades
   └─> npx tsx scripts/ingest-clob-fills-backfill.ts

4. Implement ERC20 backfill
   └─> Create new script (template: flatten-erc1155.ts)

5. Rebuild P&L views
   └─> Use trade_flows_v2 + market_resolutions_final

6. Validation & reconciliation
```

## Data Quality Issues to Be Aware Of

1. **Side field confusion** (trades_raw)
   - Uses YES/NO (outcome label) not BUY/SELL (direction)
   - Solution: Use trade_flows_v2 pre-computed cashflows

2. **Corrupted market_id** (trades_raw)
   - 1.26M rows have market_id='12' (invalid)
   - Solution: WHERE market_id NOT IN ('12', '')

3. **Condition ID format variations**
   - Multiple formats across tables (uppercase, lowercase, 0x, no 0x)
   - Solution: Always use `lower(replaceAll(condition_id, '0x', ''))`

4. **Resolution coverage gap**
   - Only 44% of markets have resolutions
   - 56% of trades are on unresolved markets
   - Solution: Use both realized + unrealized P&L

## File Locations

- **This analysis**: `/SCHEMA_MAPPING_*.md`
- **Reference docs**: `/CLICKHOUSE_KEY_FINDINGS.md`, `/CLICKHOUSE_EXPLORATION.md`
- **Migrations**: `/migrations/clickhouse/` (001-016)
- **Backfill scripts**: `/scripts/flatten-erc1155.ts`, `/scripts/ingest-clob-fills*.ts`
- **P&L formulas**: `/scripts/trade-flows-v2.sql`, `/scripts/settlement-rules.sql`

## Related Documentation

- `CASCADIAN_DATABASE_MASTER_REFERENCE.md` - Comprehensive database guide
- `CLICKHOUSE_INVENTORY_REPORT.md` - Data counts and coverage
- `CLICKHOUSE_KEY_FINDINGS.md` - Summary of key patterns
- `POLYMARKET_TECHNICAL_ANALYSIS.md` - Polymarket-specific analysis

## Next Steps

1. Read **SCHEMA_MAPPING_EXECUTIVE_SUMMARY.md** for context
2. Review **SCHEMA_MAPPING_TABLE_REFERENCE.txt** for quick lookup
3. Execute: `npx tsx scripts/flatten-erc1155.ts` (first blocker)
4. Use **SCHEMA_MAPPING_ANALYSIS.md** as detailed reference during implementation

---

**Last Updated**: November 7, 2025
**Status**: Ready for implementation
**Estimated Completion Time**: 8-12 hours total
