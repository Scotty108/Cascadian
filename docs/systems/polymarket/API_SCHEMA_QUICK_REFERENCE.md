# API Schema Quick Reference

**Last Updated:** 2025-11-09

Quick lookup guide for Polymarket API integration schema.

---

## Files

| File | Purpose |
|------|---------|
| `migrations/001-create-api-staging-tables.sql` | Staging tables for API data |
| `migrations/002-update-resolution-views.sql` | Resolution views (UNION multiple sources) |
| `migrations/003-create-leaderboard-tables.sql` | Leaderboard tables |
| `migrations/004-create-coverage-metrics.sql` | Coverage & quality tracking |
| `migrations/ROLLBACK.sql` | Rollback procedures |
| `API_SCHEMA_DESIGN.md` | Complete documentation |
| `API_SCHEMA_VERIFICATION.sql` | Validation queries |

---

## Tables at a Glance

### Staging (default)
| Table | Engine | Rows | Purpose |
|-------|--------|------|---------|
| `wallet_positions_api` | ReplacingMergeTree | 50K-500K | Wallet positions from Polymarket API |
| `resolutions_external_ingest` | ReplacingMergeTree | 200K-300K | Payout vectors from Goldsky |
| `wallet_metadata_api` | ReplacingMergeTree | 10K-50K | Wallet metadata (future) |
| `wallet_api_backfill_log` | MergeTree | 10K-100K | Ingestion audit log |

### Analytics (cascadian_clean)
| Table/View | Type | Rows | Purpose |
|------------|------|------|---------|
| `vw_resolutions_truth` | VIEW | 200K-300K | Unified resolutions (UNION) |
| `vw_pnl_reconciliation` | VIEW | 50K-500K | API vs calculated P&L |
| `vw_wallet_positions_api_format` | VIEW | 50K-500K | API-compatible format |
| `wallet_market_returns` | TABLE | 50K-200K | Base P&L per wallet+market |
| `wallet_omega_daily` | TABLE | 3M-18M | Daily Omega ratios |
| `leaderboard_whales` | TABLE | 1K-5K | Top wallets by settled P&L |
| `leaderboard_omega` | TABLE | 1K-5K | Top wallets by Omega ratio |
| `wallet_coverage_metrics` | TABLE | 10K-50K | Data quality per wallet |
| `market_coverage_metrics` | TABLE | 50K-200K | Data quality per market |
| `mv_data_quality_summary` | MAT VIEW | 365 | System-wide quality metrics |
| `data_sync_status` | TABLE | 100K-1M | Sync tracking |

---

## Key Queries

### 1. Get Wallet P&L
```sql
SELECT
    wallet_address,
    api_total_pnl,
    calculated_total_pnl,
    all_gates_pass
FROM cascadian_clean.wallet_coverage_metrics
WHERE wallet_address = '0x...';
```

### 2. Get Top 100 Leaderboard
```sql
SELECT rank, wallet_address, total_settled_pnl_usd, win_rate
FROM cascadian_clean.leaderboard_whales
ORDER BY rank LIMIT 100;
```

### 3. Get Wallet Positions
```sql
SELECT market_title, outcome, cashPnl, redeemable
FROM cascadian_clean.vw_wallet_positions_api_format
WHERE wallet_address = '0x...'
ORDER BY abs(cashPnl) DESC;
```

### 4. System Health
```sql
SELECT * FROM cascadian_clean.mv_data_quality_summary
ORDER BY calculation_date DESC LIMIT 1;
```

### 5. Find Stale Wallets
```sql
SELECT wallet_address, data_freshness_hours
FROM cascadian_clean.wallet_coverage_metrics
WHERE data_freshness_hours > 24
ORDER BY total_volume_usd DESC;
```

---

## Coverage Gates

**Leaderboard Eligibility:**
- price_coverage_pct >= 95%
- payout_coverage_pct >= 95%
- total_trades >= 10
- markets_traded >= 3
- total_volume_usd >= 1000

**Quality Categories:**
- MATCH: < $1 difference
- MINOR_DIFF: < 5% difference
- MODERATE_DIFF: 5-20% difference
- MAJOR_DIFF: > 20% difference

---

## Refresh Schedule

| Task | Frequency | Command |
|------|-----------|---------|
| API backfill (top wallets) | Daily | `npx tsx backfill-wallet-pnl-from-api.ts --top-wallets 1000` |
| Rebuild leaderboards | Daily | `INSERT INTO leaderboard_whales SELECT ...` |
| Update coverage metrics | Hourly | `INSERT INTO wallet_coverage_metrics SELECT ...` |
| Backfill payouts | Weekly | `npx tsx backfill-payout-vectors.ts` |
| OPTIMIZE tables | Daily | `OPTIMIZE TABLE ... FINAL` |

---

## Common Issues

| Issue | Solution |
|-------|----------|
| Leaderboard empty | Check coverage gates (all_gates_pass) |
| P&L mismatch | Query vw_pnl_reconciliation |
| Slow queries | Verify ORDER BY usage |
| Stale data | Check data_sync_status table |
| Duplicates | Run OPTIMIZE TABLE FINAL |

---

## Migration Commands

**Apply:**
```bash
clickhouse-client --multiquery < migrations/001-create-api-staging-tables.sql
clickhouse-client --multiquery < migrations/002-update-resolution-views.sql
clickhouse-client --multiquery < migrations/003-create-leaderboard-tables.sql
clickhouse-client --multiquery < migrations/004-create-coverage-metrics.sql
```

**Verify:**
```bash
clickhouse-client --multiquery < API_SCHEMA_VERIFICATION.sql
```

**Rollback:**
```bash
clickhouse-client --multiquery < migrations/ROLLBACK.sql
```

---

## Index Strategy

**Good (uses index):**
```sql
WHERE wallet_address = '0x...' AND condition_id = '...'
WHERE rank <= 100
```

**Bad (full scan):**
```sql
WHERE condition_id = '...'  -- Skips wallet_address
WHERE total_pnl_usd > 10000  -- Skips rank
```

**Rule:** Always filter by leftmost ORDER BY column first

---

## Data Flow

```
API Fetch → wallet_positions_api
           ↓
Goldsky → resolutions_external_ingest
           ↓
     vw_resolutions_truth (UNION)
           ↓
   wallet_market_returns (JOIN)
           ↓
   wallet_coverage_metrics (AGGREGATE)
           ↓
   leaderboard_whales (FILTER)
```

---

## Formulas

**Omega Ratio:**
```
Omega(0) = total_gains / total_losses
```

**ROI:**
```
ROI = (total_pnl / cost_basis) * 100
```

**Win Rate:**
```
Win Rate = markets_won / markets_resolved
```

**Coverage:**
```
price_coverage_pct = (positions_with_prices / total_positions) * 100
payout_coverage_pct = (positions_with_payouts / closed_positions) * 100
```

---

## Performance Tips

1. **Use OPTIMIZE FINAL** after bulk inserts
2. **Filter by ORDER BY columns** for fast queries
3. **Use LowCardinality** for repeated strings
4. **Materialize views** for complex aggregations
5. **Monitor query_log** for slow queries

---

## Next Steps After Migration

1. Apply migrations (001-004)
2. Run verification queries
3. Backfill API data (test wallet first)
4. Build analytics tables
5. Verify leaderboards
6. Schedule refresh jobs
7. Monitor data quality

---

## Quick Reference Links

- Full docs: `API_SCHEMA_DESIGN.md`
- Architecture: `DATABASE_ARCHITECTURE_REFERENCE.md`
- Implementation: `API_IMPLEMENTATION_GUIDE.md`
- Verification: `API_SCHEMA_VERIFICATION.sql`
- Rollback: `migrations/ROLLBACK.sql`
