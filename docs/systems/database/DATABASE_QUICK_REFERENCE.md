# Database Quick Reference Card

**Quick Stats:** 159M trades | 996K wallets | 2.5 years | 60 GB data | 85% complete

---

## 🎯 Your 6 Questions - Lightning Answers

### 1. Trades Structure?
- **Main:** `trades_raw` (159M rows, 9.39 GB, 29 columns)
- **Companions:** trade_cashflows_v3, trades_with_direction, vw_trades_canonical
- **Status:** ✅ Production-ready structure, ⚠️ P&L values need rebuild

### 2. Can Calculate P&L?
- **Realized:** YES ✅ (but 60% errors - rebuild needed, 1-2 days)
- **Unrealized:** PARTIAL ⚠️ (need current prices, 2-4 hours to build)
- **Resolution coverage:** 144K markets (61.7% of traded markets)

### 3. Categorization?
- **Categorized:** 8,400 markets (5.6%)
- **Missing:** 141K markets (94.4%)
- **Fix:** Tag-based inference (2-3 hours) or API backfill (4-6 hours)

### 4. Omega Ratio?
- **Returns:** YES ✅ (from existing P&L data)
- **Volatility:** PARTIAL ⚠️ (need daily time-series, 4-6 hours)
- **Feasible:** YES 🟡 (simplified now, proper in 4-6 hours)

### 5. 1M Wallet Scale?
- **Current wallets:** 996,334 (already at scale!)
- **Performance:** 500-3000ms queries (too slow)
- **Optimizations needed:** Materialized views + Redis + denormalized tables (1-2 days)

### 6. Event Mapping?
- **USDC events:** ✅ 387M (complete)
- **ERC1155:** ⚠️ 206K (partial, need 10M+)
- **CLOB fills:** ❌ 537 (need millions)
- **To build:** Unified event_timeline table (1-2 days)

---

## 🔥 Critical Issues (Fix First)

| Issue | Impact | Effort | Priority |
|-------|--------|--------|----------|
| **P&L Error Rate (60%)** | Wrong profit/loss values | 1-2 days | 🔥 P0 |
| **Missing Unrealized P&L** | No portfolio valuation | 2-4 hours | 🔥 P0 |
| **Slow Queries (1-3s)** | Poor UX, can't scale | 1-2 days | 🔥 P0 |
| **Category Coverage (5.6%)** | Limited filtering | 4-6 hours | ⚠️ P1 |
| **No Omega Ratio** | Missing key metric | 4-6 hours | ⏳ P2 |

---

## ⚡ Quick Schema Reference

### trades_raw (Primary Table)
```
159M rows | 9.39 GB | MergeTree | Partitioned by toYYYYMM(timestamp)

Key columns:
  wallet_address          String            (996K unique)
  market_id               String            (233K unique)
  condition_id            String            (233K unique)
  timestamp               DateTime
  side                    Enum8 (YES/NO)
  shares                  Decimal(18,8)
  usd_value               Decimal(18,2)     (cost basis)
  realized_pnl_usd        Float64           ⚠️ 60% ERROR RATE
  unrealized_pnl_usd      Float64           ❌ NOT POPULATED
  is_resolved             UInt8             (2.89% are resolved)
  canonical_category      String            (from enrichment)
  transaction_hash        String            (blockchain link)
```

### market_resolutions_final (Resolution Data)
```
224K rows | 7.88 MB | ReplacingMergeTree

Key columns:
  condition_id_norm       FixedString(64)   (144K unique)
  payout_numerators       Array(UInt8)      [1,0] for binary
  payout_denominator      UInt8             Usually 1
  winning_index           UInt16            0-based index
  winning_outcome         String            "Yes"/"No"/etc
  resolved_at             DateTime
```

### wallet_metrics_complete (Wallet Stats)
```
1.00M rows | 41.5 MB | MergeTree

Key columns:
  wallet_address          String
  total_trades            UInt32
  total_volume            Float64
  total_pnl               Float64
  win_rate                Float64
  avg_win                 Float64
  avg_loss                Float64
  pnl_stddev              Float64
```

### gamma_markets (Market Metadata)
```
149.9K rows | 21.5 MB | MergeTree

Key columns:
  market_id               String
  question                String
  outcomes                Array(String)     ["Yes", "No"]
  category                String            ⚠️ 94% empty
  tags                    Array(String)
  volume                  Float64
  end_date_iso            String
```

---

## 📊 Key Queries

### Get Wallet P&L
```sql
-- Current (uses incorrect P&L)
SELECT
  wallet_address,
  SUM(realized_pnl_usd) as total_pnl,
  COUNT(*) as total_trades
FROM trades_raw
WHERE wallet_address = '0x...'
GROUP BY wallet_address;

-- Correct (rebuild needed)
SELECT
  t.wallet_address,
  SUM(
    t.shares * (
      arrayElement(r.payout_numerators, r.winning_index + 1) /
      r.payout_denominator
    ) - t.usd_value
  ) as total_pnl_corrected
FROM trades_raw t
JOIN market_resolutions_final r
  ON lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
WHERE t.wallet_address = '0x...' AND t.is_resolved = 1
GROUP BY t.wallet_address;
```

### Get Unrealized P&L (AFTER BUILDING market_current_price)
```sql
SELECT
  t.wallet_address,
  SUM(t.shares * p.current_price - t.usd_value) as unrealized_pnl
FROM trades_raw t
JOIN market_current_price p ON t.market_id = p.market_id
WHERE t.wallet_address = '0x...' AND t.is_resolved = 0
GROUP BY t.wallet_address;
```

### Get Wallet by Category (AFTER BACKFILL)
```sql
SELECT
  canonical_category,
  SUM(realized_pnl_usd) as category_pnl,
  COUNT(*) as trades
FROM trades_raw
WHERE wallet_address = '0x...'
  AND canonical_category != ''
GROUP BY canonical_category
ORDER BY category_pnl DESC;
```

---

## 🚀 4-Week Roadmap

### Week 1: Fix P&L 🔥
- [ ] Rebuild `trades_raw.realized_pnl_usd` (1 day)
- [ ] Build `market_current_price` table (4 hours)
- [ ] Add `trades_raw.unrealized_pnl_usd` (4 hours)
- [ ] Validate against known wallets (4 hours)

### Week 2: Enrich Data 📊
- [ ] Backfill market categories (4 hours)
- [ ] Rebuild `wallet_metrics_by_category` (2 hours)
- [ ] Backfill CLOB fills (8 hours)
- [ ] Clean up backup tables (2 hours)

### Week 3: Advanced Metrics 📈
- [ ] Build `wallet_daily_pnl` (4 hours)
- [ ] Calculate volatility metrics (2 hours)
- [ ] Build `wallet_omega_ratio` (4 hours)
- [ ] Create leaderboards (4 hours)

### Week 4: Optimize 🚀
- [ ] Add materialized views (4 hours)
- [ ] Deploy Redis cache (6 hours)
- [ ] Build dashboard cache tables (6 hours)
- [ ] Load test (4 hours)

**Total:** 3-4 weeks to production-ready

---

## 💾 Tables by Priority

### Must Use (Production)
1. `trades_raw` - All trades
2. `wallet_metrics_complete` - Wallet stats
3. `market_resolutions_final` - Resolved outcomes
4. `gamma_markets` - Market metadata
5. `market_candles_5m` - Price charts

### Important (Analytics)
6. `trade_cashflows_v3` - Cashflow attribution
7. `realized_pnl_by_market_final` - Market-level P&L
8. `outcome_positions_v2` - Position tracking
9. `wallet_pnl_summary_final` - Wallet P&L summary

### Nice to Have (Enrichment)
10. `condition_market_map` - ID mappings
11. `ctf_token_map` - Token mappings
12. `erc20_transfers_staging` - Blockchain events

### Archive/Delete (Cleanup)
- `trades_raw_*` (6 backup copies) - Save 50 GB

---

## 🎯 Performance Targets

| Query Type | Current | Target | How |
|------------|---------|--------|-----|
| Wallet trades | 500-2000ms | <100ms | Projection index |
| Wallet P&L | 1000-3000ms | <50ms | Denormalized cache |
| Market candles | 200-500ms | <50ms | Already good ✅ |
| Dashboard (10 calls) | 5-10s | <1s | Redis cache |
| Category aggregation | 5-10s | <500ms | Pre-aggregate |

---

## 📞 Who to Ask

**For implementation details:**
- See `DATABASE_ARCHITECTURE_AUDIT_2025.md` (full 200-page report)

**For P&L formulas:**
- See `DATABASE_AGENT_FINAL_REPORT.md` (error analysis)
- See Section 8.1 in full audit (rebuild SQL)

**For UI integration:**
- See `READY_FOR_UI_DEPLOYMENT.md` (API routes)

**For data pipeline:**
- See `POLYMARKET_TECHNICAL_ANALYSIS.md` (backfill scripts)

---

## ⚠️ Known Issues Log

| Issue | Severity | Discovered | Status | ETA |
|-------|----------|------------|--------|-----|
| P&L 60% error rate | 🔥 CRITICAL | 2025-11-07 | Diagnosed | 1-2 days |
| Missing unrealized P&L | 🔥 CRITICAL | 2025-11-08 | Scoped | 2-4 hours |
| Category coverage 5.6% | ⚠️ HIGH | 2025-11-08 | Scoped | 4-6 hours |
| CLOB fills incomplete | ⚠️ MEDIUM | 2025-11-08 | Scoped | 8-12 hours |
| Query performance slow | ⚠️ MEDIUM | 2025-11-08 | Scoped | 1-2 days |
| ERC1155 partial | ⏳ LOW | 2025-11-08 | Deferred | TBD |

---

## 🎓 Glossary

**condition_id** - Blockchain identifier for market outcome (64-char hex)
**market_id** - Polymarket's internal market identifier
**payout vector** - Array defining winning outcome (e.g., [1,0] = first outcome wins)
**realized P&L** - Profit/loss on resolved (closed) trades
**unrealized P&L** - Current value of open positions vs cost basis
**Omega ratio** - Risk-adjusted return metric (upside/downside)
**materialized view** - Pre-computed query result for fast access
**ReplacingMergeTree** - ClickHouse engine for idempotent updates
**projection index** - Sorted subset of columns for faster queries

---

**Last Updated:** 2025-11-08
**Database Version:** ClickHouse 23.x (Cloud)
**Status:** B+ (85% complete, production-ready with optimizations)
