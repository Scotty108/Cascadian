# DATABASE AUDIT - QUICK REFERENCE

**Goal:** "Build the entire database so we can view all markets, all wallets, all wallet trades, calculate P&L by category, omega ratio by category, all events mapped to all markets for all 1M wallets"

**Current Status:** 75% COMPLETE | 51-83 hours remaining

---

## TRAFFIC LIGHT SUMMARY

```
🟢 COMPLETE (100%)
├─ All 996K wallets tracked
├─ All USDC transfers captured (388M+)
├─ Payout vectors for resolved markets (100%)
└─ Historical price data (8M+ candles)

🟡 PARTIAL (51-99%)
├─ Trade coverage: 51.5% (82M / 159M have condition_id)
├─ Market resolutions: 61.7% (144K / 233K resolved)
├─ Market categories: 85% (127K / 150K categorized)
└─ Proxy wallet mappings: 85.3% (850K / 996K mapped)

🔴 CRITICAL GAPS (0-50%)
├─ P&L calculation: 2.89% realized, 0% unrealized
├─ P&L by category: 15% (blocked by missing categories)
├─ Omega ratio: 0% (blocked by missing time-series)
└─ Pre-calc P&L accuracy: 39.77% (60% has errors)
```

---

## THE 5 CRITICAL BLOCKERS

### 1. 77.4M Trades Missing condition_id (48.5% gap)
**Impact:** Cannot calculate P&L for half the trades
**Solution:** HYBRID recovery (Dune + CLOB + Blockchain)
**Effort:** 13-22 hours
**Priority:** 🔴 P0 (MUST FIX FIRST)

### 2. Zero Unrealized P&L (97% gap)
**Impact:** Cannot show current portfolio value
**Solution:** Real-time price feed + mark-to-market calc
**Effort:** 6-10 hours
**Priority:** 🔴 P0 (MUST FIX FIRST)

### 3. Pre-Calculated P&L 60% Wrong
**Impact:** Cannot trust existing realized_pnl_usd
**Solution:** Rebuild using correct payout formula
**Effort:** 4-6 hours
**Priority:** 🔴 P0 (MUST FIX FIRST)

### 4. 15% Markets Missing Categories
**Impact:** Cannot group markets for "P&L by category"
**Solution:** Fetch from Polymarket API
**Effort:** 2-4 hours
**Priority:** 🟡 P1 (NEEDED FOR ANALYTICS)

### 5. No Daily P&L Time-Series
**Impact:** Cannot calculate omega ratio
**Solution:** Build materialized view for daily snapshots
**Effort:** 6-10 hours
**Priority:** 🟡 P1 (NEEDED FOR ANALYTICS)

---

## DATA COVERAGE BY GOAL

| User Goal | Coverage | Status | What's Missing |
|-----------|----------|--------|----------------|
| **View all markets** | 85% | 🟡 | 15% missing categories |
| **View all wallets** | 100% | ✅ | None (996K wallets) |
| **View all wallet trades** | 51% | 🔴 | 48.5% missing condition_id |
| **Calculate P&L** | 3-25% | 🔴 | 97% need unrealized, 60% pre-calc wrong |
| **P&L by category** | 15% | 🔴 | Missing categories + missing P&L |
| **Omega ratio by category** | 0% | 🔴 | No daily P&L time-series |
| **All events → markets** | 51% | 🔴 | Same as trade coverage gap |
| **Scale to 1M wallets** | 100% | ✅ | None (ready for scale) |

---

## RECOMMENDED EXECUTION ORDER

### Week 1: Critical Blockers (23-38 hours)
```
Day 1-3: Recover missing condition_ids (13-22 hrs)
  ├─ Use HYBRID approach (Dune + CLOB + Blockchain)
  └─ Target: 95%+ coverage (151M / 159M trades)

Day 4: Rebuild realized P&L (4-6 hrs)
  ├─ Fix payout calculation bugs
  └─ Validate against known wallets

Day 5: Build unrealized P&L (6-10 hrs)
  ├─ Ingest real-time market prices
  └─ Calculate mark-to-market P&L

✅ Checkpoint: 95%+ trades with P&L
```

### Week 2: Analytics Enablement (18-30 hours)
```
Day 6: Backfill categories (2-4 hrs)
  └─ Fetch from Polymarket API for 15% gap

Day 7-8: Build daily P&L time-series (6-10 hrs)
  └─ Enable omega ratio calculations

Day 9: Build category aggregations (4-6 hrs)
  └─ Create views for P&L by category

Day 10: Fetch wallet metadata (6-10 hrs)
  ├─ Polymarket profiles for top 10K
  └─ Smart money scores for all

✅ Checkpoint: Full analytics working
```

### Week 3: Polish (10-15 hours)
```
- Complete ERC1155 recovery
- Build performance indexes
- Optimize for 1M wallet scale
```

---

## QUICK STATS

### Current Database State
```
Total Tables: 40+
Total Rows: 700M+
Database Size: Unknown (ClickHouse Cloud)

Core Tables:
├─ trades_raw: 159.6M rows
├─ erc20_transfers: 388M+ rows
├─ market_candles_5m: 8.1M rows
├─ market_resolutions_final: 224K rows
└─ gamma_markets: 149.9K rows

Key Gaps:
├─ 77.4M trades missing condition_id
├─ 154.9M trades missing unrealized P&L
├─ 22.4K markets missing categories
└─ 0 rows in daily P&L time-series
```

### Coverage by Data Type
```
PAYOUT DATA:           100% ✅ (for resolved markets)
MARKET METADATA:       85%  🟡 (missing categories)
WALLET DATA:           100% ✅ (addresses)
WALLET METADATA:       0%   🔴 (profiles/scores)
PRICE DATA:
  ├─ Historical:       100% ✅ (5-min candles)
  └─ Real-time:        0%   🔴 (no current prices)
EVENT DATA:
  ├─ USDC:            100% ✅ (388M+ transfers)
  ├─ ERC1155:         Unknown ⚠️
  └─ CLOB:            51.5% 🔴 (condition_id gap)
RESOLUTION DATA:       61.7% 🟡 (38% still active)
CATEGORY DATA:         85%  🟡 (15% gap)
TIME-SERIES DATA:      0%   🔴 (daily P&L missing)
```

---

## RECOVERY OPTIONS COMPARISON

### Option 1: HYBRID (Recommended) ✅
- **Coverage:** 95%+ trades
- **Effort:** 13-22 hours
- **Cost:** $0-500 (Dune export)
- **Risk:** LOW
- **Pros:** Fast, reliable, multi-source validation
- **Cons:** May need Dune paid tier

### Option 2: CLOB API Only ⚠️
- **Coverage:** 60-80% trades
- **Effort:** 6-10 hours
- **Cost:** $0
- **Risk:** MEDIUM
- **Pros:** Free, official Polymarket data
- **Cons:** API may lack full historical depth

### Option 3: Blockchain Only ❌
- **Coverage:** 70-85% trades
- **Effort:** 12-18 hours
- **Cost:** $0
- **Risk:** HIGH
- **Pros:** Fully on-chain, no dependencies
- **Cons:** Complex, uncertain ERC1155 availability

---

## SUCCESS CRITERIA

### Phase 1 Complete (MVP)
- ✅ 95%+ trades have condition_id
- ✅ 95%+ trades have P&L (realized + unrealized)
- ✅ P&L accuracy >95%
- ✅ All 996K wallets can calculate total P&L

### Phase 2 Complete (Full Analytics)
- ✅ 100% markets categorized
- ✅ Daily P&L time-series for all wallets
- ✅ P&L by category working
- ✅ Omega ratio by category working
- ✅ Top 10K wallets have metadata

### Phase 3 Complete (Production Ready)
- ✅ 98%+ trade coverage
- ✅ Sub-second query performance
- ✅ All views materialized and indexed

---

## FILES TO READ

### Must Read (Start Here)
1. `DATABASE_COMPREHENSIVE_AUDIT_REPORT.md` - Full audit details
2. `PNL_COVERAGE_QUICK_START.md` - Recovery decision guide
3. `PNL_COVERAGE_STRATEGIC_DECISION.md` - Complete recovery strategy

### Reference Documentation
- `CLICKHOUSE_SCHEMA_REFERENCE.md` - Table schemas
- `MARKET_RESOLUTIONS_FINAL_VERIFICATION_REPORT.md` - Resolution audit
- `DATABASE_AGENT_FINAL_REPORT.md` - P&L bug investigation
- `COVERAGE_CRISIS_ANALYSIS.md` - Gap analysis

### Implementation Scripts
- `scripts/validate-recovery-options.ts` - Test recovery approaches
- `scripts/flatten-erc1155.ts` - ERC1155 processing
- `scripts/enrich-token-map.ts` - Market metadata

---

## KEY FORMULAS (from CLAUDE.md)

### Correct P&L Formula (PNL skill)
```sql
-- Realized P&L
pnl_usd = shares * (arrayElement(payout_numerators, winning_index + 1) / payout_denominator) - cost_basis

-- Unrealized P&L
unrealized_pnl_usd = shares * current_market_price - cost_basis
```

### Direction Inference (NDR skill)
```sql
-- BUY: usdc_net > 0 AND token_net > 0 (spent USDC, received tokens)
-- SELL: usdc_net < 0 AND token_net < 0 (received USDC, spent tokens)
-- Where:
usdc_net = usdc_out - usdc_in
token_net = tokens_in - tokens_out
```

### ID Normalization (IDN skill)
```sql
-- Always normalize condition_id before joining
condition_id_norm = lower(replaceAll(condition_id, '0x', ''))
-- Assert: length = 64 chars
-- Type: String (avoid FixedString casts)
```

### Omega Ratio
```sql
-- After daily P&L time-series is built
omega_ratio = upside_deviation / downside_deviation
-- Where:
upside_deviation = stddev(daily_pnl WHERE daily_pnl > threshold)
downside_deviation = stddev(daily_pnl WHERE daily_pnl < threshold)
```

---

## DECISION POINTS

### Before Starting Phase 1
- [ ] Review full audit report
- [ ] Choose recovery approach (Hybrid vs CLOB vs Blockchain)
- [ ] Set up Dune Analytics account (if choosing Hybrid)
- [ ] Confirm timeline and resource allocation

### Before Starting Phase 2
- [ ] Verify Phase 1 success (95%+ coverage)
- [ ] Validate P&L calculations on known wallets
- [ ] Confirm category requirements

### Before Starting Phase 3
- [ ] Verify Phase 2 success (full analytics working)
- [ ] Test query performance at scale
- [ ] Plan production deployment

---

**Report Generated:** 2025-11-08
**Total Effort Estimate:** 51-83 hours (8.5-14 days at 6h/day)
**Priority:** 🔴 P0 - Critical for 1M wallet goal
**Status:** READY FOR EXECUTION

**Full Details:** See `DATABASE_COMPREHENSIVE_AUDIT_REPORT.md`
