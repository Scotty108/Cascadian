# Schema Consolidation: Executive Summary
**One-Page Overview for Decision Makers**

---

## The Problem in 3 Numbers

| Metric | Current | Target | Impact |
|--------|---------|--------|--------|
| **Tables** | 87 | 18 | 79% reduction |
| **P&L Error** | 99.9% wrong | ±2% | Fix root cause |
| **Scripts** | 439 | ~50 | 89% cleanup |

---

## Why This Matters

### 1. P&L is Broken (Business Critical)
- niggemon wallet: Shows $1.9M instead of $102K (16,267x error)
- Root cause: 10+ competing P&L calculations across tables
- Impact: Cannot trust any financial metrics in dashboard

### 2. Schema is Unmaintainable (Technical Debt)
- 87 tables vs Dune's 15 for same data
- Unclear lineage: Which table is source of truth?
- Developer confusion: 7+ variants of same table

### 3. Performance at Risk (Scaling)
- Redundant computations across 40+ staging tables
- Cartesian joins causing 18.7x data inflation
- Query times unpredictable

---

## The Solution: Clean 4-Tier Architecture

```
BEFORE (87 TABLES)                    AFTER (18 TABLES)

Raw: 15+ variants                     Tier 0: 5 raw tables
├─ trades_raw                         ├─ trades_raw
├─ trades_raw_backup                  ├─ erc1155_transfers
├─ trades_raw_old                     ├─ erc20_transfers
├─ trades_raw_broken                  ├─ market_resolutions_final
└─ 11+ more...                        └─ gamma_markets

Mapping: 20+ fragments                Tier 1: 3 base tables
├─ ctf_token_map                      ├─ base_ctf_tokens
├─ condition_market_map               ├─ base_market_conditions
├─ id_bridge                          └─ base_outcome_resolver
└─ 17+ more...

Staging: 40+ enrichments              Tier 2: 6 staging tables
├─ trades_enriched                    ├─ trades
├─ trades_canonical                   ├─ positions
├─ trades_deduped                     ├─ capital_flows
├─ trades_with_fees                   ├─ market_details
└─ 36+ more...                        ├─ prices_hourly
                                      └─ prices_daily

Marts: 20+ analytics                  Tier 3: 4 marts
├─ wallet_pnl_correct                 ├─ markets
├─ wallet_pnl_summary_final           ├─ users
├─ wallet_realized_pnl_v2             ├─ wallet_pnl (SINGLE SOURCE)
└─ 17+ more...                        └─ prices_latest
```

---

## P&L Fix: Single Source of Truth

### Current State (10+ Competing Formulas)

| Table | niggemon P&L | Error | Issue |
|-------|-------------|-------|-------|
| trades_raw.realized_pnl_usd | $117 | 99.9% | Missing data |
| wallet_realized_pnl_v2 | $1,907,531 | 16,267x | Join fanout |
| trade_cashflows_v3 | (inflated) | 18.7x | Cartesian join |
| Polymarket (truth) | $102,001 | 0% | External source |

### New Architecture (1 Formula)

```
wallet_pnl
├─ Source: trades (single enriched staging)
├─ Formula: cost_basis + settlement - fees
├─ Validation: Tested against 10+ Polymarket profiles
└─ Expected: niggemon = $99,691 - $102,001 (±2%)
```

**Key Fix:**
- Consolidate 10+ P&L tables → 1 mart table
- Single formula: `SUM(cashflows) + SUM(winning_shares × payout)`
- Correct index offset: `outcome_index + 1` for ClickHouse arrays
- No intermediate tables: Compute directly from staging

---

## Timeline: 5 Weeks

| Week | Phase | Deliverable | Risk |
|------|-------|-------------|------|
| 0 | Pre-flight | Schema freeze, audit, backups | Low |
| 1 | Clean Raw | 5 core raw tables (15 → 5) | Low |
| 2 | Build Base | 3 mapping tables (20 → 3) | Medium |
| 3-4 | Consolidate Staging | 6 enriched tables (40 → 6) | Medium |
| 4-5 | Fix P&L & Build Marts | 4 final marts + validation | High |

**Total Effort:** 40 person-days (1 architect + 1 engineer)

---

## Success Metrics

| Metric | Before | After | How to Measure |
|--------|--------|-------|----------------|
| P&L accuracy | 99.9% error | ±2% | Compare to Polymarket |
| Table count | 87 | 18 | `SELECT count() FROM system.tables` |
| Query latency (p95) | Unknown | < 500ms | Monitor slow query log |
| Developer onboarding | Days | Hours | Time to understand schema |

---

## Risk Mitigation

### High Risks

1. **Data loss during migration**
   - Mitigation: Full backups, shadow schema testing, rollback plan

2. **P&L still wrong after fix**
   - Mitigation: Test 10+ wallets, compare to Polymarket API, manual verification

3. **Application queries break**
   - Mitigation: Inventory queries first, parallel testing, gradual cutover

### Rollback Strategy

Each phase can be rolled back independently:
- Archive tables remain accessible in `archive/` schema
- Shadow schema allows parallel testing
- Full database backups before each phase

---

## Comparison to Industry Standard (Dune)

| Aspect | Dune | Cascadian Before | Cascadian After |
|--------|------|------------------|-----------------|
| Total tables | 15 | 87 | 18 |
| Tier structure | 3 tiers | No structure | 4 tiers (+ base) |
| P&L location | Application | 10+ tables | 1 mart |
| Dedup strategy | Once at base | Multiple layers | Once in staging |
| Maintainability | High | Low | High |

**Why 18 vs Dune's 15?**
- +1 for high-frequency trading (prices_5m)
- +1 for capital flows (not in Dune)
- +1 for base layer (outcome resolver)

---

## Alternatives Considered

### Option A: Incremental Cleanup (Rejected)
- Approach: Fix tables one at a time over 6 months
- Pros: Lower short-term risk
- Cons: P&L remains broken, confusion persists, technical debt compounds

### Option B: Complete Rewrite (Rejected)
- Approach: Start from scratch, rebuild everything
- Pros: Perfect architecture
- Cons: 3-6 months, high risk, business downtime

### Option C: Consolidation (RECOMMENDED)
- Approach: Systematic 5-week consolidation with parallel testing
- Pros: Fixes P&L, clean architecture, reversible, 5-week timeline
- Cons: Requires focus, temporary dual-schema complexity

---

## Recommendation

**APPROVE AND EXECUTE**

**Rationale:**
1. P&L bug is business-critical and blocks product launch
2. Current 87-table architecture is unsustainable
3. 5-week timeline is reasonable for impact
4. Risk is manageable with proper backups and testing
5. Result matches industry best practice (Dune)

**Blocking Issues if NOT Done:**
- Cannot trust financial metrics in production
- Developer velocity slows due to schema confusion
- Performance degrades as data grows
- Technical debt compounds monthly

**Next Steps:**
1. Review and approve master plan
2. Tag current schema: `git tag schema-v1-before-consolidation`
3. Begin Phase 0: Pre-flight checks (3 days)
4. Execute 5-week roadmap starting Week of Nov 11

---

## Questions & Answers

**Q: What if P&L is still wrong after consolidation?**
A: We test against 10+ Polymarket profiles in Phase 4. If variance > 5%, we investigate before final deployment. Worst case: rollback to current state.

**Q: Can we do this in production without downtime?**
A: Yes. Shadow schema testing allows parallel operation. Cutover is atomic (RENAME operation).

**Q: What about the 439 TypeScript scripts?**
A: Most are one-off debug scripts. After consolidation, we archive old scripts and maintain ~50 core scripts (backfill, validation, utilities).

**Q: How do we prevent this from happening again?**
A: Document tier structure, enforce naming conventions, require approval for new tables, quarterly schema audits.

**Q: What's the estimated cost savings?**
A: Storage: -20% (remove duplicates), Compute: -30% (fewer redundant queries), Developer time: -50% (less confusion), Query performance: +40% (cleaner indexes).

---

**Document Status:** Ready for executive review
**Full Plan:** See `SCHEMA_CONSOLIDATION_MASTER_PLAN.md` (22 pages)
**Contact:** Database Architect for questions

**Decision Needed By:** November 8, 2025
**Execution Start:** November 11, 2025 (if approved)
