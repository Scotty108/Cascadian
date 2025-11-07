# Dune Polymarket Spellbook Analysis - Complete Index

**Date:** 2025-11-07
**Analysis Scope:** Dune Analytics Polymarket 15-table architecture as reference for Cascadian 87-table cleanup
**Repository:** https://github.com/duneanalytics/spellbook/tree/main/dbt_subprojects/daily_spellbook/models/_projects/polymarket/polygon

---

## Documents in This Analysis

### 1. DUNE_ANALYSIS_EXECUTIVE_SUMMARY.md (START HERE)
**Length:** 3000 words | **Time:** 10-15 min | **Audience:** Decision makers, product managers

Quick facts and key takeaways:
- Dune's 15-table architecture at a glance
- Consolidation strategy (87 → 18 tables)
- 5 critical design rules to adopt
- 7 red flags in Cascadian's current schema
- 5-phase implementation plan with timelines

**When to read:** Before diving into details; answers "what should we build?"

---

### 2. DUNE_POLYMARKET_SPELLBOOK_ANALYSIS.md (DEEP DIVE)
**Length:** 7000 words | **Time:** 30-45 min | **Audience:** Database architects, engineers

Comprehensive analysis of Dune's design:
- Core tables by tier (raw → base → staging → marts)
- Complete data lineage flow diagram
- P&L calculation architecture (why Dune's approach differs)
- 6 schema design patterns with examples
- Naming conventions (tier prefixes, field names, etc.)
- Source of truth vs. derived tables
- Key contrasts with Cascadian
- Recommended clean schema (18-table target)
- Implementation checklist

**When to read:** Deep understanding of Dune's architecture; answers "how did they build it?"

---

### 3. DUNE_VS_CASCADIAN_MAPPING.md (IMPLEMENTATION GUIDE)
**Length:** 8000 words | **Time:** 45-60 min | **Audience:** Engineers building the new schema

Table-by-table consolidation roadmap:
- Architecture comparison diagram (Dune 15 vs. Cascadian 87)
- Detailed TIER 1 mapping (raw tables)
- Detailed TIER 2 mapping (base/mapping tables)
- Detailed TIER 3 mapping (staging tables)
- Detailed TIER 4 mapping (analytics marts)
- Critical differences in P&L, dedup, direction, outcomes
- Consolidation roadmap (Phase 1-5 with checklists)
- Table consolidation decision tree
- Naming convention fixes
- Validation checklist (post-consolidation)

**When to read:** Building the new schema; answers "which tables do we consolidate and how?"

---

## Quick Navigation by Question

| Question | Document | Section |
|----------|----------|---------|
| **What should we do with 87 tables?** | Executive Summary | Consolidation Strategy |
| **What's Dune's architecture?** | Analysis | Core Tables by Tier |
| **How does their P&L calculation work?** | Analysis | P&L Calculation Architecture |
| **Which design patterns should we copy?** | Analysis | Schema Design Patterns |
| **How do we map our tables to Dune's?** | Mapping | Detailed TIER 1-4 Mapping |
| **What are the red flags we need to fix?** | Executive Summary | Red Flags in Cascadian |
| **Give me the step-by-step plan** | Executive Summary + Mapping | Implementation Plan + Roadmap |
| **How do we name tables?** | Analysis + Mapping | Naming Conventions + Fixes |
| **How do we validate the new schema?** | Mapping | Validation Checklist |
| **Which tables do we keep vs. deprecate?** | Mapping | What to Keep + What to Remove |

---

## Key Insights Summary

### The Dune Pattern (Copy This)

```
Raw (4)         Base (2)        Staging (6)            Analytics (5)
────────────────────────────────────────────────────────────────────
trades_raw  ──→ ctf_tokens  ──→ market_trades    ──→ markets
positions_raw   conditions  ──→ positions        ──→ prices_daily
conditions_raw              ──→ market_details   ──→ prices_hourly
tokens_raw                  ──→ capital_actions  ──→ prices_latest
                             ──→ market_outcomes ──→ users
                             ──→ market_prices_*
```

**Design Principles:**
1. Linear data flow (one direction only)
2. Each table has clear grain
3. Staging intentionally denormalized
4. All tables incremental-safe
5. P&L computed in application, not SQL

---

### Cascadian's Target Architecture

```
Raw (5)              Base (3)            Staging (8)          Marts (2-3)
──────────────────────────────────────────────────────────────────────
trades_raw       ──→ base_ctf       ──→ trades         ──→ wallet_pnl
positions_raw        base_conditions ──→ positions     ──→ market_pnl
transfers_raw        base_outcome    ──→ market_details ──→ markets
conditions_raw                        ──→ capital_flows ──→ prices_*
resolutions_raw                       ──→ users_proxies (separate)
                                      ──→ prices_daily
                                      ──→ prices_hourly
                                      ──→ winning_outcomes
```

**Key Differences:**
- Add `winning_outcomes` for payout vectors (Cascadian-specific)
- Keep proxy tables separate (Dune pattern)
- Move all P&L to final marts only (not staging)

---

## Critical P&L Insight

### Dune (Simple)
```
Binary outcomes → Position snapshots → PnL = final_balance - cost_basis
```

### Cascadian (Complex)
```
Multi-outcome + Payout vectors → PnL = shares × (payout_numerator / denominator) - cost_basis
```

**Solution:** Isolate payout vector logic to final marts; staging tracks positions + costs only.

---

## Implementation Timeline

| Phase | Duration | Output | Dependency |
|-------|----------|--------|-----------|
| **Phase 1: Audit** | 1 week | Inventory of 87 tables, raw sources identified | None |
| **Phase 2: Build Tier 2** | 1 week | 3 base/mapping tables (ctf, condition, outcome) | Phase 1 |
| **Phase 3: Consolidate Staging** | 2 weeks | 8 staging tables (trades, positions, prices, flows, proxies) | Phase 2 |
| **Phase 4: Clean Marts** | 1 week | 2-3 final marts (wallet_pnl, market_pnl, markets) | Phase 3 |
| **Phase 5: Validate** | 1 week | Full backfill, row count verification, PnL validation | Phase 4 |
| **TOTAL** | **6 weeks** | Clean 18-table schema, validated, documented | |

---

## Key Files Referenced from Dune Spellbook

| File | Purpose | Insight |
|------|---------|---------|
| `market_trades_raw.sql` | Capture CLOB events | Union two sources, dedup on (condition_id, tx_hash) |
| `base_ctf_tokens.sql` | Token registration mapping | Dedup with ROW_NUMBER, keep first occurrence |
| `market_details.sql` | On-chain + API merge | LEFT JOINs to preserve API rows, null filter at end |
| `market_trades.sql` | Enrich trades with context | Simple LEFT JOIN, preserve raw event structure |
| `positions.sql` | Enrich positions with market | INNER JOIN market_details (intentional filtering) |
| `users_capital_actions.sql` | Deposits/withdrawals tracking | Filter by proxy types, UNION different flows |
| `_schema.yml` | Table documentation | Shows grain, unique constraints, descriptions |

---

## Dune vs. Cascadian: Feature Comparison

| Feature | Dune | Cascadian (Now) | Cascadian (Target) |
|---------|------|-----------------|-------------------|
| **Outcome Types** | Binary only | Multi-outcome | Multi-outcome |
| **Payout Handling** | Implicit in market | Payout vectors scattered | Isolated to winning_outcomes |
| **Direction Inference** | Implicit in event | Multiple `direction` fields | Computed once in trades |
| **Raw Table Count** | 4 | ? (ambiguous) | 5 (clear) |
| **Base/Mapping Tables** | 0 | 15-20 (scattered) | 3 (consolidated) |
| **Staging Table Count** | 6 | 40+ (duplicative) | 8 (consolidated) |
| **Final Marts** | 5 | 20+ (many deprecated) | 2-3 (lean) |
| **P&L in SQL** | No (dashboards) | Yes (10+ tables) | Yes (final marts only) |
| **Dedup Layers** | 1 | Multiple (unclear) | 1 (staging only) |

---

## Anti-Patterns to Avoid (From Cascadian's Current State)

1. ✗ **Multiple raw sources without hierarchy**
   → Create single authoritative raw source, deprecate others

2. ✗ **P&L computation in staging tables**
   → Move all PnL logic to final marts

3. ✗ **Deduplication across multiple tables**
   → Dedup once in staging, reuse everywhere

4. ✗ **Direction/side fields in multiple tables**
   → Compute direction in staging, inherit in marts

5. ✗ **Scattered mapping tables (outcome, token, condition)**
   → Consolidate to 3 base tables

6. ✗ **Unclear table grain**
   → Document grain for every table

7. ✗ **Circular dependencies**
   → Ensure strictly linear data flow

8. ✗ **Deprecated marts still being rebuilt**
   → Archive unused marts, keep only core analytics

---

## Success Criteria

After consolidation, verify:

- [ ] **Table count:** 87 → 18 (exactly 4 tiers)
- [ ] **Data flow:** Linear (no circular deps)
- [ ] **Grain documented:** Every table has grain in schema
- [ ] **Raw preservation:** All raw tables append-only
- [ ] **Staging left-joins:** No data loss at staging layer
- [ ] **P&L isolated:** Only wallet_pnl and market_pnl compute PnL
- [ ] **Row counts match:** Old vs. new schema (±0.5%)
- [ ] **PnL values match:** Old vs. new schema (±2%)
- [ ] **Application tested:** Dashboards work with new marts
- [ ] **Documentation complete:** All 18 tables documented

---

## How to Use This Analysis

### For Architects/Leads
1. Read: **Executive Summary** (15 min)
2. Review: Consolidation strategy and timeline
3. Approve: 5-phase implementation plan

### For Engineers
1. Read: **Executive Summary** (15 min) + **Analysis** (45 min)
2. Study: Schema design patterns (6 key patterns)
3. Reference: **Mapping** document during implementation
4. Execute: 5-phase plan with checklists

### For Database Specialists
1. Deep dive: **Analysis** (full document)
2. Reference: Design patterns and naming conventions
3. Implement: Tier 2 base/mapping tables first
4. Validate: Use validation checklist post-consolidation

---

## Quick Reference: 5 Design Rules

**Copy these to CLAUDE.md or your style guide:**

1. **Raw tables are append-only.** Never update, only append new blocks since last run.
2. **Staging joins with LEFT PRESERVE.** Never lose rows; use LEFT JOIN to preserve raw data.
3. **Denormalization at marts only.** Staging stays normalized; denormalize in final analytics tables for query speed.
4. **One-direction data flow.** Raw → Base → Staging → Marts (never circular dependencies).
5. **Dedup once, inherit forever.** Apply deduplication once at staging layer; all downstream tables inherit deduplicated data.

---

## Related Documentation

- **CLAUDE.md** - Project reference guide (includes Stable Pack with IDN, NDR, PNL, AR, CAR, JD skills)
- **CLAUDE_FINAL_CHECKLIST.md** - Final deployment checklist
- **ARCHITECTURE_OVERVIEW.md** - Cascadian system architecture
- **POLYMARKET_TECHNICAL_ANALYSIS.md** - Technical deep dive on Polymarket data

---

## Questions & Answers

### Q: Should we keep the complex payout vector logic?
**A:** Yes, but isolate it to final marts only. Staging should track positions and costs; payout vectors belong in `winning_outcomes` table (Tier 4) used only by final PnL marts.

### Q: Why does Dune not have base/mapping tables?
**A:** Dune's raw tables already include token registration + market conditions events. Cascadian needs explicit base tables because data comes from multiple sources (blockchain + API).

### Q: Can we keep deprecated marts like leaderboard_metrics?
**A:** No. Either archive them (document why deprecated) or rebuild them dynamically from core marts. Static marts create maintenance burden and version skew.

### Q: How strict is the 18-table target?
**A:** 17-19 is acceptable. The goal is to reduce from 87 and create clear tiers. Exact number less important than structure (raw → base → staging → marts).

### Q: Can we do this without downtime?
**A:** Yes, if you build new tables alongside old ones, then swap at final validation step. See DUNE_VS_CASCADIAN_MAPPING.md Phase 4 for atomic swap pattern.

### Q: How do we handle the multi-outcome complexity?
**A:** Create `winning_outcomes` table (Tier 4) with condition_id → outcome_index, payout_numerators, payout_denominator. Use only in final PnL marts. Staging stays simple.

---

## Document Versions

| Document | Version | Last Updated | Status |
|----------|---------|--------------|--------|
| DUNE_ANALYSIS_EXECUTIVE_SUMMARY.md | 1.0 | 2025-11-07 | Final |
| DUNE_POLYMARKET_SPELLBOOK_ANALYSIS.md | 1.0 | 2025-11-07 | Final |
| DUNE_VS_CASCADIAN_MAPPING.md | 1.0 | 2025-11-07 | Final |
| DUNE_ANALYSIS_INDEX.md | 1.0 | 2025-11-07 | Final |

---

## How to Contribute

When updating this analysis:
1. Update version number and "Last Updated" date
2. Link new documents to INDEX.md
3. Keep Executive Summary as entry point
4. Maintain "Quick Navigation" section
5. Use same table structure for consistency

---

## External Resources

- **Dune Spellbook:** https://github.com/duneanalytics/spellbook
- **Polymarket API Docs:** https://docs.polymarket.com/
- **ClickHouse Docs:** https://clickhouse.com/docs/

---

**Analysis prepared:** 2025-11-07
**For project:** Cascadian App (schema cleanup & consolidation)
**Estimated implementation:** 6 weeks (5 phases)
**Contact:** See CLAUDE.md for memory system and agent delegation patterns

