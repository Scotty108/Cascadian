# Dune Analytics Polymarket Spellbook Analysis - Complete Package

**Date:** 2025-11-07
**Status:** Analysis Complete, Ready for Implementation
**Project:** Cascadian App Schema Consolidation (87 → 18 tables)
**Reference:** https://github.com/duneanalytics/spellbook

---

## What's in This Package?

You have **4 comprehensive documents** analyzing Dune Analytics' clean 15-table Polymarket architecture and how to apply it to Cascadian's schema cleanup.

| Document | Purpose | Length | Audience |
|----------|---------|--------|----------|
| **DUNE_ANALYSIS_EXECUTIVE_SUMMARY.md** | Quick overview of consolidation strategy | 3000 words | Leads, PMs, architects |
| **DUNE_POLYMARKET_SPELLBOOK_ANALYSIS.md** | Deep dive into Dune's design patterns | 7000 words | Engineers, database architects |
| **DUNE_VS_CASCADIAN_MAPPING.md** | Table-by-table consolidation roadmap | 8000 words | Implementation engineers |
| **DUNE_IMPLEMENTATION_CHECKLIST.md** | 5-phase implementation plan with tasks | 6000 words | Project managers, engineers |
| **DUNE_ANALYSIS_INDEX.md** | Navigation guide and quick reference | 4000 words | Everyone |

**Total content:** 28,000+ words of detailed analysis and planning

---

## Start Here: 3 Reading Paths

### Path 1: Decision Maker (15 minutes)
Goal: "Should we consolidate? How long? What's the benefit?"

1. Read: **DUNE_ANALYSIS_EXECUTIVE_SUMMARY.md**
   - Consolidation strategy (87 → 18 tables)
   - 5-phase timeline (6 weeks)
   - Success metrics
   - Red flags we need to fix

2. Decide: Approve 6-week project?

---

### Path 2: Architect (1 hour)
Goal: "Understand the pattern. Design the new schema."

1. Read: **DUNE_ANALYSIS_EXECUTIVE_SUMMARY.md** (15 min)
2. Study: **DUNE_POLYMARKET_SPELLBOOK_ANALYSIS.md** (45 min)
   - Core tables by tier (raw → base → staging → marts)
   - 6 design patterns (left joins, dedup once, denormalize at marts, etc.)
   - Naming conventions
   - P&L isolation strategy

3. Reference: **DUNE_VS_CASCADIAN_MAPPING.md** for table mapping decisions

---

### Path 3: Implementation Team (4 hours)
Goal: "Execute the consolidation. Phase by phase."

1. Read: **DUNE_ANALYSIS_EXECUTIVE_SUMMARY.md** (15 min)
2. Study: **DUNE_POLYMARKET_SPELLBOOK_ANALYSIS.md** (45 min)
3. Deep dive: **DUNE_VS_CASCADIAN_MAPPING.md** (1 hour)
   - Tier 1-4 mapping
   - Consolidation roadmap (5 phases)
   - Anti-patterns to avoid
   - Validation checklist

4. Execute: **DUNE_IMPLEMENTATION_CHECKLIST.md** (1+ hours)
   - Phase 1: Audit (Week 1)
   - Phase 2: Build Tier 2 (Week 2)
   - Phase 3: Consolidate Staging (Weeks 3-4)
   - Phase 4: Clean Marts (Week 4-5)
   - Phase 5: Validate (Week 5)

---

## Key Findings Summary

### Dune's Clean Architecture
- **15 tables** organized in 4 clear tiers
- **Linear data flow:** Raw → Base → Staging → Analytics (no circular deps)
- **Immutable raw:** Append-only, never update
- **One dedup:** Applied once at staging, inherited forever
- **Denormalize late:** Staging stays normalized; marts are denormalized for speed
- **P&L in app:** Not calculated in SQL (ours is more complex, so in final marts only)

### Cascadian's Current Problems
- **87 tables** (5.8x more than Dune)
- **Circular dependencies** (unclear data flow)
- **P&L scattered:** Computed in 10+ staging tables
- **Multiple raw sources:** trades_raw vs. clob_trades vs. clob_fills
- **Duplicate dedup:** Multiple layers (trades_deduped, trades_canonical)
- **No grain documentation:** Unclear what each table represents
- **Deprecated marts:** Still being rebuilt but not used (leaderboard_metrics, etc.)

### Cascadian's Target State
- **18 tables** (consolidation from 87)
- **4 clear tiers:** 5 raw, 3 base, 8 staging, 2 marts
- **Linear flow:** One-way data movement
- **P&L isolated:** Only `wallet_pnl` and `market_pnl` compute PnL
- **Single dedup:** Applied in `trades` table, inherited by all downstream
- **Documented grain:** Every table specifies its grain
- **Archived deprecated:** Old marts moved to archive/

---

## The 5 Design Rules (Memorize These)

1. **Raw tables are append-only.** Never update, only append new blocks since last run.
2. **Staging joins with LEFT PRESERVE.** Never lose rows; use LEFT JOIN to preserve raw data.
3. **Denormalization at marts only.** Staging stays normalized; denormalize in final analytics tables for query speed.
4. **One-direction data flow.** Raw → Base → Staging → Marts (never circular dependencies).
5. **Dedup once, inherit forever.** Apply deduplication once at staging layer; all downstream tables inherit deduplicated data.

**Apply these rules, and your schema becomes maintainable.**

---

## Critical P&L Insight

### Why Dune Keeps It Simple
```
Binary outcomes → Position snapshots → PnL = final_balance - cost_basis
```

### Why Cascadian Is More Complex
```
Multi-outcome + Payout vectors → PnL = shares × (payout_numerator / denominator) - cost_basis
```

**Solution:** Isolate payout vector logic to final marts only:
- Staging tracks: positions, costs, trade history
- Final marts compute: PnL using payout vectors
- Never mix P&L logic into staging tables

This separation keeps staging clean and final marts powerful.

---

## Implementation Timeline

```
Week 1:  Phase 1 - Audit & Document (all 87 tables)
Week 2:  Phase 2 - Build Tier 2 (3 base/mapping tables)
Weeks 3-4: Phase 3 - Consolidate Staging (40+ → 8 tables)
Week 4-5: Phase 4 - Clean Marts (20+ → 2 final)
Week 5:  Phase 5 - Validate & Deploy
──────────────────────────────────────
TOTAL:   6 weeks, fully consolidated + tested
```

---

## Success Metrics

After consolidation, you'll have:

- **87 → 18 tables** (80% reduction)
- **4 clear tiers** with documented grain
- **Zero circular dependencies** (linear data flow)
- **Single P&L source** (wallet_pnl and market_pnl)
- **Row counts match** (old vs. new ±0.5%)
- **PnL values match** (old vs. new ±2%)
- **Application tested** (dashboards work)
- **Performance same or better** (queries faster)

---

## How to Use These Documents

### During Planning
- Share **Executive Summary** with stakeholders
- Reference **Implementation Checklist** for timeline/scope

### During Design
- Use **Polymarket Spellbook Analysis** for pattern reference
- Use **Mapping** document for table consolidation decisions

### During Implementation
- Execute **Implementation Checklist** phase by phase
- Reference **Mapping** document for consolidation specifics
- Use **Index** document for quick lookups

### During Validation
- Use **Implementation Checklist** Phase 5 validation steps
- Compare old vs. new using provided SQL queries

---

## Key Files Referenced (From Dune)

These 6 SQL files demonstrate the pattern best:

1. **polymarket_polygon_market_trades_raw.sql** - Capture CLOB events from blockchain
2. **polymarket_polygon_base_ctf_tokens.sql** - Token registration mapping + dedup
3. **polymarket_polygon_market_details.sql** - On-chain + API merge with LEFT JOINs
4. **polymarket_polygon_market_trades.sql** - Enrich trades with market context
5. **polymarket_polygon_positions.sql** - Enrich positions with market context
6. **polymarket_polygon_users_capital_actions.sql** - Track deposits/withdrawals

Each <100 lines, single responsibility, clear intent.

---

## Cascadian-Specific Guidance

Unlike Dune's binary outcomes, Cascadian must handle:

1. **Multi-outcome markets** - Store outcome_index alongside outcome_name
2. **Payout vectors** - Keep in `winning_outcomes` (Tier 4), use only in final PnL marts
3. **Direction inference** - Use NDR rule from CLAUDE.md; compute once in staging
4. **Shares tracking** - Keep in staging (positions + cost_basis); use in final PnL
5. **Complex P&L** - Apply formula in final marts only; staging stays simple

**The pattern remains identical; complexity is isolated to Tier 4.**

---

## Document Interconnections

```
                    START HERE
                        ↓
            DUNE_ANALYSIS_EXECUTIVE_SUMMARY.md
                        ↓
                ┌───────┴───────┐
                ↓               ↓
         For Decision      For Detailed
         Makers/Leads      Understanding
                │               │
                └───────┬───────┘
                        ↓
        DUNE_POLYMARKET_SPELLBOOK_ANALYSIS.md
        (Deep dive into 6 design patterns)
                        ↓
                ┌───────┴───────┐
                ↓               ↓
         For Design        For Implementation
         Decisions         Planning
                │               │
                └───────┬───────┘
                        ↓
        DUNE_VS_CASCADIAN_MAPPING.md
        (Table-by-table consolidation)
                        ↓
        DUNE_IMPLEMENTATION_CHECKLIST.md
        (Execute 5-phase plan)
                        ↓
        DUNE_ANALYSIS_INDEX.md
        (Quick reference & Q&A)
```

---

## Quick Navigation

| Question | Document | Section |
|----------|----------|---------|
| What's the consolidation strategy? | Executive Summary | Consolidation Strategy (87→18) |
| What are the 5 design rules? | Executive Summary | Quick Reference: 5 Design Rules |
| How does Dune structure tables? | Spellbook Analysis | Core Tables by Tier |
| What's the P&L calculation approach? | Spellbook Analysis | P&L Calculation Architecture |
| Which design patterns should we copy? | Spellbook Analysis | Schema Design Patterns (6 total) |
| Which tables consolidate together? | Mapping | Detailed TIER 1-4 Mapping |
| What are the red flags? | Executive Summary | Red Flags in Cascadian |
| What's the step-by-step plan? | Implementation Checklist | Phase 1-5 with tasks |
| How do we validate the new schema? | Implementation Checklist | Phase 5: Validation |
| How should we name tables? | Spellbook Analysis + Mapping | Naming Conventions |
| What's the timeline? | Executive Summary + Checklist | Implementation Timeline |

---

## Estimated Reading Time

| Role | Documents | Time |
|------|-----------|------|
| **Executive/PM** | Executive Summary | 15 min |
| **Architect** | Executive Summary + Spellbook Analysis | 1 hour |
| **Implementation Lead** | All 4 docs + Checklist | 2-3 hours |
| **Database Engineer** | All docs + references | 4-5 hours |
| **Full Team** | All docs (in parallel) | 1-2 hours |

---

## Next Steps

1. **Read** appropriate documents for your role (above)
2. **Approve** 6-week timeline (if decision maker)
3. **Plan** using Implementation Checklist (if lead)
4. **Execute** Phase 1 (audit all 87 tables)
5. **Reference** Mapping document (during implementation)
6. **Validate** using Phase 5 checklist

---

## Questions?

Refer to:
- **How does Dune do X?** → DUNE_POLYMARKET_SPELLBOOK_ANALYSIS.md
- **Which of our tables maps to Dune's?** → DUNE_VS_CASCADIAN_MAPPING.md
- **What's the step-by-step plan?** → DUNE_IMPLEMENTATION_CHECKLIST.md
- **Quick lookup?** → DUNE_ANALYSIS_INDEX.md

---

## Files in This Package

- `DUNE_ANALYSIS_README.md` - This file
- `DUNE_ANALYSIS_EXECUTIVE_SUMMARY.md` - 3000 words (start here)
- `DUNE_POLYMARKET_SPELLBOOK_ANALYSIS.md` - 7000 words (deep dive)
- `DUNE_VS_CASCADIAN_MAPPING.md` - 8000 words (consolidation roadmap)
- `DUNE_IMPLEMENTATION_CHECKLIST.md` - 6000 words (5-phase plan)
- `DUNE_ANALYSIS_INDEX.md` - 4000 words (quick reference)

**Total: 28,000+ words of detailed analysis**

---

## Document Status

All documents are **FINAL and READY for implementation**.

- ✓ Analyzed Dune Spellbook (15 tables, 17 SQL files)
- ✓ Designed target schema (18 tables, 4 tiers)
- ✓ Mapped consolidation opportunities (87 → 18)
- ✓ Created 5-phase implementation plan (6 weeks)
- ✓ Documented design patterns (6 key patterns)
- ✓ Created validation checklist (comprehensive)

**Ready to execute immediately.**

---

## Related Cascadian Documentation

- **CLAUDE.md** - Project reference (includes Stable Pack, memory systems)
- **CLAUDE_FINAL_CHECKLIST.md** - Deployment checklist
- **ARCHITECTURE_OVERVIEW.md** - System architecture
- **POLYMARKET_TECHNICAL_ANALYSIS.md** - Polymarket data deep dive

---

**Analysis completed:** 2025-11-07
**For:** Cascadian App Schema Consolidation
**Based on:** Dune Analytics Polymarket Spellbook
**Timeline:** 6 weeks (5 phases)
**Status:** Ready to implement

**Start with: DUNE_ANALYSIS_EXECUTIVE_SUMMARY.md**

