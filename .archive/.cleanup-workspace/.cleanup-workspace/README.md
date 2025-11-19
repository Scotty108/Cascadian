# Pod 5: Application Source Code Analysis

**Completed:** 2025-11-18  
**Agent:** Claude Code Pod 5 Specialist  
**Status:** READY FOR IMPLEMENTATION PLANNING

---

## Quick Start

### Start Here
1. **POD5_EXECUTIVE_SUMMARY.txt** - Read first (5 min read)
   - Key findings
   - Refactoring scope
   - Timeline & effort estimates
   - Action items

2. **POD5_REPORT.md** - Detailed technical analysis (15 min read)
   - Complete architecture map
   - All integration points
   - Risk assessment
   - Testing strategy
   - Preservation checklist

---

## Key Findings Summary

**Application:** Next.js 15 + React 19 + ClickHouse → Goldsky migration

**Size:**
- Source code: 8.5MB (without scripts)
- Total analyzed: 1,200+ files
- 92 API routes
- 572 React components
- 115 library modules

**ClickHouse Integration:** WIDE & EMBEDDED
- 1,190 files import ClickHouse
- 12 critical API routes need refactoring
- 27 library modules with direct queries
- NOT isolated in single data layer

**Refactoring Scope:**
- **Effort:** 167-253 hours
- **Timeline:** 4-6 weeks (1 developer)
- **Risk:** MEDIUM
- **Status:** Partially ready (Goldsky client integrated)

---

## Critical Integration Points

### API Routes (12 files - Must Refactor)
```
/api/wallets/top
/api/leaderboard/omega
/api/leaderboard/roi
/api/leaderboard/whale
/api/omega/leaderboard
/api/wallets/[address]/orphans
/api/wallets/[address]/category-breakdown
/api/signals/tsi/[marketId]
/api/trading/track-wallet
/api/markets/[id]/owrr
/api/leaderboard/wallet/[address]
/api/admin/pipeline-status
```

### Library Modules (27 files - Must Refactor)
- **Metrics:** austin-methodology.ts, directional-conviction.ts, omega.ts, owrr.ts, tsi-calculator.ts, etc.
- **Strategy Builder:** clickhouse-connector.ts (PRIMARY), execution-engine.ts
- **Trading:** wallet-monitor.ts, decision-engine.ts, owrr-calculator.ts
- **Analytics:** wallet-category-breakdown.ts, wallet-resolution-accuracy.ts
- **Workflow:** node-executors.ts

---

## Files to Preserve

### KEEP (No Changes)
- [x] All React components (572 files, 5.8MB) - Data-agnostic
- [x] Dashboard layouts & pages
- [x] Authentication
- [x] lib/polymarket/ (external API)
- [x] lib/supabase.ts (authentication)
- [x] lib/goldsky/ (already correct)
- [x] lib/cache/, lib/types/, lib/utils/

### KEEP & REFACTOR
- [ ] API routes (92 files) - Update queries
- [ ] Metrics modules (10 files) - Change data source
- [ ] Strategy builder (3 files) - Replace connector
- [ ] Trading operations (5 files) - Update queries
- [ ] Analytics (4 files) - Rewrite queries
- [ ] Workflow engine (4 files) - Update data layer

### DELETE (After Migration)
- [ ] scripts/ (343MB) - Investigation files
- [ ] lib/clickhouse/ (after transition)
- [ ] All diagnostic scripts (800+ files)

---

## Effort Breakdown

| Component | Files | Hours | Days |
|-----------|-------|-------|------|
| API Routes | 12 | 24-36 | 3-4 |
| Metrics | 10 | 40-60 | 5-8 |
| Strategy Builder | 3 | 20-30 | 3-4 |
| Trading Ops | 5 | 15-20 | 2-3 |
| Analytics | 4 | 10-15 | 1-2 |
| Workflow | 4 | 8-12 | 1-2 |
| Testing | - | 40-60 | 5-8 |
| Integration | - | 10-20 | 1-3 |
| **TOTAL** | **38** | **167-253** | **21-34** |

---

## Risk Assessment

### HIGH RISK
- **Metric calculation drift** - ClickHouse vs Goldsky may differ
  - Mitigation: Parallel run + validation period
- **Performance regression** - ClickHouse highly optimized
  - Mitigation: Load testing, caching strategy
- **API contract breaking** - Frontend depends on exact shapes
  - Mitigation: Schema validation tests

### MEDIUM RISK
- Query complexity variations
- Data completeness gaps
- Real-time latency requirements

### LOW RISK
- Component changes (none needed)
- Authentication changes (separate layer)

---

## Recommended Approach

**Phase 1:** Data Layer Abstraction (2-3 days)
- Create WalletDataProvider interface
- Implement ClickHouseProvider & GoldskyProvider
- Add feature flags

**Phase 2:** API Route Migration (1 week)
- Migrate leaderboard routes
- Migrate wallet analytics routes
- Migrate market data routes

**Phase 3:** Metrics Refactoring (1.5 weeks)
- Update austin-methodology.ts
- Update directional-conviction.ts
- Validate calculations

**Phase 4:** Strategy Builder (1 week)
- Implement goldsky-connector.ts
- Replace clickhouse-connector.ts
- Integration testing

**Phase 5:** Testing & Validation (1 week)
- End-to-end testing
- Performance validation
- Load testing

**Phase 6:** Cleanup (2-3 days)
- Remove ClickHouse provider
- Delete scripts/
- Final documentation

---

## Next Steps

1. **Review** POD5_EXECUTIVE_SUMMARY.txt (5 min)
2. **Read** POD5_REPORT.md (15 min)
3. **Validate** findings with team
4. **Create** data abstraction layer
5. **Begin** systematic API migration
6. **Test** continuously throughout

---

## Document Map

```
.cleanup-workspace/
├── README.md                    (This file)
├── POD5_EXECUTIVE_SUMMARY.txt   (Quick reference - 417 lines)
└── POD5_REPORT.md              (Complete analysis - 955 lines)
```

**Total Analysis:**
- 1,372 lines of documentation
- 47KB of comprehensive findings
- Ready for implementation planning

---

## Questions?

Refer to specific sections in POD5_REPORT.md:

- **Architecture:** Section 1-3
- **ClickHouse Integration:** Section 4
- **Preservation:** Section 6-7
- **Refactoring:** Section 8-10
- **Risk & Testing:** Section 11-12

---

**Generated by:** Claude Code Pod 5 Specialist  
**Date:** 2025-11-18  
**Time Zone:** PST  
**Analysis Level:** Medium Thoroughness

