# Investigation Files Index & Navigation Guide

**Last Updated:** 2025-11-08  
**Total Investigation Files:** 28+ markdown files, 50+ TypeScript/SQL scripts  
**Total Content:** ~15,000 lines of analysis and documentation  

---

## START HERE (Entry Points)

### 🎯 **1. NEXT_AGENT_START_HERE.md** ← BEGIN HERE
- **Purpose:** Quick start guide (5-minute read)
- **Contains:** Current situation, Phase 1 checklist, key decisions, troubleshooting
- **Best for:** Getting up to speed quickly before implementation
- **Read time:** 5-10 minutes

### 📊 **2. CONVERSATION_MINING_COMPLETE_SUMMARY.md**
- **Purpose:** Complete investigation timeline with all findings
- **Contains:** 88-hour investigation breakdown, 5 phases, all decisions with rationale
- **Best for:** Understanding how we got to current conclusions, context for decisions
- **Read time:** 30-45 minutes

### 🔧 **3. DATABASE_ARCHITECTURE_AUDIT_2025.md**
- **Purpose:** Complete technical audit + implementation plan
- **Contains:** Full schema analysis, P&L accuracy findings, Phase 1-6 implementation steps
- **Best for:** Implementation details, step-by-step SQL code
- **Read time:** 45-60 minutes (or jump to section 8 for Phase 1 only)
- **Size:** 1,330 lines

---

## CRITICAL ISSUE FILES

### 🔴 **MAIN_CLAUDE_READ_THIS_FIRST.md**
- **Priority:** CRITICAL
- **Contains:** 60% P&L error discovery, root cause, recommended Path A fix
- **Key finding:** Pre-calculated P&L is inverted; fix is 4-6 hours work
- **Read time:** 15 minutes

### 🔴 **DATABASE_AGENT_FINAL_REPORT.md**
- **Priority:** CRITICAL
- **Contains:** Detailed P&L accuracy analysis, error patterns, examples
- **Key finding:** 60.23% of trades have P&L errors >= $0.01
- **Evidence:** Verified across 100K sample trades

---

## DECISION DOCUMENTS

### ✅ **BACKFILL_DECISION.md**
- **Decision:** Stop blockchain ERC1155 backfill
- **Rationale:** Only 0.79% complete, would take weeks; UNION approach is faster
- **Action:** Redirect to using trades_raw valid data (16.5M more transactions)
- **Impact:** Immediate 6-8M transaction gain vs weeks of waiting

### ✅ **CONDITION_ID_QUICK_REFERENCE.md**
- **Decision:** Accept 51% condition_id coverage
- **Rationale:** Not a calculation issue, import-layer issue (Polymarket API incomplete)
- **Recovery methods tried:** 4 approaches, all failed or impractical
- **Impact:** 82M high-quality trades sufficient; no P&L impact

### ✅ **READY_FOR_UI_DEPLOYMENT.md**
- **Decision:** Deploy now with Phase 1 fixes
- **Status:** 99% data clean, all issues documented
- **Risk:** LOW with Phase 1, MEDIUM without
- **Contains:** 4 API routes ready, verification complete for 2 reference wallets

---

## ROOT CAUSE ANALYSIS FILES

### 🔍 **CONDITION_ID_INVESTIGATION_FINDINGS.md**
- **Focus:** Understanding the 51% condition_id gap
- **Contains:** Root cause traced to import layer, not mapping/calculation
- **Key finding:** Polymarket API doesn't always return condition_id
- **Action:** Can't recover; focus on data quality of what we have

### 🔍 **CONDITION_ID_ROOT_CAUSE_ANALYSIS.md**
- **Focus:** Deep dive into missing condition_ids
- **Contains:** Multiple recovery approaches analyzed and rejected
- **Blockchain analysis:** Only 0.3% of missing trades recoverable from ERC1155
- **Conclusion:** Accept 51% and ensure future imports are complete

### 🔍 **INVESTIGATION_TIMELINE_AND_DECISIONS.md**
- **Focus:** Hour-by-hour timeline of investigation
- **Contains:** 5 phases, 16 hours of analysis, decision points with outcomes
- **Time spent:** 88+ hours total (but document shows 16 hours in one thread)
- **Best for:** Understanding investigation methodology

---

## TABLE ANALYSIS FILES

### 📋 **TABLE_COMPARISON_EXECUTIVE_SUMMARY.md**
- **Focus:** Comparing trades_raw vs trades_with_direction vs trades_dedup_mat_new
- **Key finding:** trades_with_direction is "hidden gem" (82M, 100% clean)
- **Decision:** Use trades_with_direction as primary analytical source
- **Recommendation:** Consolidate to 2-3 canonical tables, archive rest

### 📋 **FINAL_TABLE_COMPARISON.md**
- **Focus:** Updated comparison with latest findings
- **Status:** vw_trades_canonical confirmed as 157.5M complete view
- **Warning:** Multiple pre-calculated P&L tables have 60% error rate

### 📋 **TABLE_DEPENDENCY_DIAGRAM.md**
- **Focus:** Visual mapping of table relationships
- **Contains:** Data flow from import → enrichment → analytics
- **Best for:** Understanding how tables relate

---

## DATA QUALITY & VALIDATION FILES

### ✔️ **INVESTIGATION_COMPLETE_FINAL_TRUTH.md**
- **Status:** Validation complete - system is working correctly
- **Finding:** Data exists, system is operational, no "empty tables"
- **Clarity:** wallet_pnl_summary_v2 is the real data (not the _final variant)
- **Confidence:** 99% (verified 3 ways)

### ✔️ **INVESTIGATION_COMPLETE_NEXT_STEPS.md**
- **Status:** What comes after investigation validation
- **Contains:** Production approval, known limitations, next actions
- **Timeline:** Ready for UI deployment

### ✔️ **INVESTIGATION_SUMMARY_FOR_USER.md**
- **Audience:** Non-technical stakeholders
- **Contains:** Plain language summary of findings
- **Key message:** System is working, no major crises

---

## STRATEGY & PLANNING FILES

### 📈 **PNL_COVERAGE_QUICK_START.md**
- **Focus:** P&L calculation strategy
- **Status:** 51% coverage on resolved trades; 97% need unrealized P&L
- **Solution:** Phase 1 (fix formula) + Phase 2 (build unrealized)
- **Timeline:** 4-6 hours critical, 2-3 hours optional

### 📈 **BLOCKCHAIN_BACKFILL_NECESSITY_REPORT.md**
- **Focus:** Do we need blockchain recovery?
- **Answer:** No - UNION approach is faster, better ROI
- **Cost-benefit:** Weeks of backfill vs 2-3 hours implementation

---

## ARCHIVE CANDIDATES (Can Be Deleted/Moved)

These files contain investigation process, not final decisions. Safe to archive:

```
INVESTIGATION_SUMMARY.md (superseded by CONVERSATION_MINING)
CONDITION_ID_RECOVERY_ACTION_PLAN.md (outdated, next version made)
CONDITION_ID_MISMATCH_ROOT_CAUSE_REPORT.md (covered elsewhere)
CONDITION_ID_INVESTIGATION_COMPLETE.md (historical)
CONDITION_ID_INVESTIGATION_INDEX.md (navigation, covered by this file)
CONDITION_ID_JOIN_PATHS.md (technical exploration, not decision)
CONDITION_ID_SCHEMA_MAPPING.md (technical, covered in audit)
SMOKING_GUN_*.md (historical findings)
UPDATED_SMOKING_GUN_*.md (historical)
CRITICAL_REALIZATION.md (process, not conclusion)
BREAKTHROUGH_*.md (historical)
THIRD_PARTY_VERIFICATION_REPORT.md (validation, conclusions captured elsewhere)
DUNE_*.md (alternative analysis, not chosen path)
SUBSTREAMS_*.md (alternative analysis, not chosen path)
CLOB_BACKFILL_*.md (alternative path, not chosen)
ERC1155_RECOVERY_*.md (alternative path, not chosen)
DATABASE_QUICK_REFERENCE.md (superseded by audit)
DATABASE_INCIDENT_REPORT.md (historical)
DATABASE_EXPLORATION_*.md (process)
All "START_HERE_" variants except this one
```

---

## FILES BY PURPOSE

### For Understanding Issues
1. MAIN_CLAUDE_READ_THIS_FIRST.md
2. CONVERSATION_MINING_COMPLETE_SUMMARY.md (sections on issues)
3. DATABASE_ARCHITECTURE_AUDIT_2025.md (critical gaps section)

### For Understanding Decisions
1. CONVERSATION_MINING_COMPLETE_SUMMARY.md (decisions section)
2. BACKFILL_DECISION.md
3. CONDITION_ID_QUICK_REFERENCE.md
4. READY_FOR_UI_DEPLOYMENT.md

### For Implementation
1. DATABASE_ARCHITECTURE_AUDIT_2025.md (sections 8.1-8.6)
2. NEXT_AGENT_START_HERE.md (Phase 1 checklist)
3. Scripts in /scripts/ (referenced in audit)

### For Troubleshooting
1. NEXT_AGENT_START_HERE.md (troubleshooting section)
2. CONDITION_ID_QUICK_REFERENCE.md
3. DATABASE_ARCHITECTURE_AUDIT_2025.md (common issues section)

### For Context/Learning
1. INVESTIGATION_TIMELINE_AND_DECISIONS.md
2. CONVERSATION_MINING_COMPLETE_SUMMARY.md
3. TABLE_COMPARISON_EXECUTIVE_SUMMARY.md

---

## Quick Navigation by Question

### "How do I fix the P&L?"
→ DATABASE_ARCHITECTURE_AUDIT_2025.md section 8.1

### "What's the current database state?"
→ DATABASE_ARCHITECTURE_AUDIT_2025.md (full audit) OR CONVERSATION_MINING_COMPLETE_SUMMARY.md (quick overview)

### "Why are there so many tables?"
→ TABLE_COMPARISON_EXECUTIVE_SUMMARY.md

### "Should we do the blockchain backfill?"
→ BACKFILL_DECISION.md

### "Can we improve condition_id coverage?"
→ CONDITION_ID_QUICK_REFERENCE.md

### "Is the system production-ready?"
→ READY_FOR_UI_DEPLOYMENT.md

### "What decisions have been made?"
→ CONVERSATION_MINING_COMPLETE_SUMMARY.md (decisions section)

### "What was the investigation process?"
→ INVESTIGATION_TIMELINE_AND_DECISIONS.md

### "What are the immediate next steps?"
→ NEXT_AGENT_START_HERE.md

---

## Recommended Reading Order

### For Quick Start (15 min)
1. NEXT_AGENT_START_HERE.md
2. MAIN_CLAUDE_READ_THIS_FIRST.md

### For Complete Understanding (90 min)
1. NEXT_AGENT_START_HERE.md (5 min)
2. CONVERSATION_MINING_COMPLETE_SUMMARY.md (40 min)
3. DATABASE_ARCHITECTURE_AUDIT_2025.md section 8 (30 min)
4. Skim remaining reference files as needed (15 min)

### For Implementation (4-6 hours)
1. DATABASE_ARCHITECTURE_AUDIT_2025.md sections 8.1-8.2
2. Reference CONDITION_ID_QUICK_REFERENCE.md and BACKFILL_DECISION.md as needed
3. Use NEXT_AGENT_START_HERE.md troubleshooting section if stuck

---

## Statistics

| Category | Count |
|----------|-------|
| Total markdown files created | 28+ |
| Total lines of documentation | ~15,000 |
| TypeScript/SQL scripts created | 50+ |
| Investigation hours | 88+ |
| Major decisions documented | 5 |
| Critical bugs identified | 1 |
| Known issues documented | 6 |
| Effort estimates provided | 15+ |
| Reference wallets validated | 2 |
| Tables audited | 77 |
| Data quality issues found | 3 major, 4 minor |

---

## Maintenance Notes

### Files to Keep
- NEXT_AGENT_START_HERE.md (entry point)
- CONVERSATION_MINING_COMPLETE_SUMMARY.md (context)
- DATABASE_ARCHITECTURE_AUDIT_2025.md (implementation guide)
- MAIN_CLAUDE_READ_THIS_FIRST.md (critical issues)
- Decision files (BACKFILL_*, CONDITION_ID_QUICK_*, READY_FOR_UI_*)

### Files to Archive (to /docs/archive/investigation-history/)
- All INVESTIGATION_* files (except COMPLETE ones)
- All SMOKING_GUN_* files
- All BREAKTHROUGH_* files
- Alternative analysis files (DUNE_*, SUBSTREAMS_*, etc.)
- All "START_HERE_" variants (except NEXT_AGENT_START_HERE.md)
- Historical exploration files
- Process documentation files

### Cleanup Actions
1. Delete backup table definitions (save ~30GB)
2. Archive 20+ redundant investigation files
3. Consolidate documentation into 5-10 canonical files
4. Update this index monthly as new files are created

---

**Navigation:**
- **Quick Start:** NEXT_AGENT_START_HERE.md
- **Full Context:** CONVERSATION_MINING_COMPLETE_SUMMARY.md
- **Implementation:** DATABASE_ARCHITECTURE_AUDIT_2025.md
- **Critical Issues:** MAIN_CLAUDE_READ_THIS_FIRST.md
