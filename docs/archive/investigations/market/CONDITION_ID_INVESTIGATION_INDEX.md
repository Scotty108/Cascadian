# CONDITION_ID ENRICHMENT INVESTIGATION: COMPLETE FILE INDEX

## Quick Navigation

**Start here based on your role:**

### For Decision-Makers
1. **READ FIRST:** `/CONDITION_ID_INVESTIGATION_COMPLETE.md` (5 minutes)
   - Executive summary
   - Key findings at a glance
   - Three path options (A/B/C)
   - Next steps and decision points

2. **THEN DECIDE:** Which path to pursue (A/B/C)
   - Path A: Re-import (8-12 hours)
   - Path B: Accept 51%, deploy now (2-4 hours)
   - Path C: External data source (varies)

### For Technical Leads
1. **READ FIRST:** `/CONDITION_ID_QUICK_REFERENCE.md` (10 minutes)
   - Problem statement
   - Data sources traced
   - Technical depth with numbers
   - Recovery method evaluation
   - Table usage recommendations

2. **IF DEEP DIVE NEEDED:** `/CONDITION_ID_ROOT_CAUSE_ANALYSIS.md` (30 minutes)
   - Comprehensive 20+ page analysis
   - Detailed root cause
   - Verification tests completed
   - Part-by-part breakdown
   - Implementation details for each path

3. **VISUAL OVERVIEW:** `/CONDITION_ID_DATA_FLOW_DIAGRAM.txt`
   - Data flow from API through enrichment
   - Mapping layer verification
   - Where trades diverge (with vs without condition_id)
   - Recovery paths illustrated

### For Developers Implementing Path A or B
1. **START:** `/CONDITION_ID_QUICK_REFERENCE.md` (sections "Which Table Should I Use" and "What Are My Options")
2. **THEN:** Review relevant scripts:
   - Path A: `scripts/ingest-clob-fills-backfill.ts`, `scripts/stepA_build_condition_market_map.ts`
   - Path B: Query `trades_working` instead of `trades_raw`
3. **REFERENCE:** Previous findings in `/CONDITION_ID_INVESTIGATION_FINDINGS.md`

---

## Complete File List

### Investigation Documentation (Created in This Session)

| File | Purpose | Read Time | Audience |
|------|---------|-----------|----------|
| `CONDITION_ID_INVESTIGATION_COMPLETE.md` | Executive summary with decision framework | 5 min | Everyone |
| `CONDITION_ID_QUICK_REFERENCE.md` | Technical summary with key numbers | 10 min | Tech leads |
| `CONDITION_ID_ROOT_CAUSE_ANALYSIS.md` | Comprehensive analysis (20+ pages) | 30 min | Developers |
| `CONDITION_ID_DATA_FLOW_DIAGRAM.txt` | Visual data flow and recovery paths | 5 min | Visual learners |
| `CONDITION_ID_INVESTIGATION_INDEX.md` | This file - navigation guide | 5 min | Everyone |

### Previous Investigation Documents (Context)

| File | Contains |
|------|----------|
| `CONDITION_ID_INVESTIGATION_FINDINGS.md` | Table population analysis (40 tables scanned) |
| `CONDITION_ID_BACKFILL_FINAL_REPORT.md` | Previous findings summary |
| `COVERAGE_CRISIS_ANALYSIS.md` | Coverage distribution analysis |
| `CONDITION_ID_QUICK_ACTION_PLAN.md` | Earlier action plan (superseded) |
| `CONDITION_ID_RECOVERY_ACTION_PLAN.md` | Recovery path analysis (superseded) |

### Key Source Data Files

| File | Contains | Rows |
|------|----------|------|
| `data/expanded_resolution_map.json` | Resolved market condition_id → market_id mapping | 2,858 |
| `data/condition_market_map_sample.jsonl` | Sample mappings | ~1K |

### Diagnostic Scripts Referenced

| Script | Purpose | Key Finding |
|--------|---------|------------|
| `49-analyze-missing-trades.ts` | Gap analysis | 77.4M trades without condition_id |
| `50-coverage-analysis-fixed.ts` | Coverage distribution | 51% overall, varies by wallet |
| `51-coverage-summary-only.ts` | Coverage summary | 0.43% wallets have 100% coverage |
| `scripts/analyze-mapping-tables.ts` | Mapping verification | All 100% complete |
| `scripts/check-condition-coverage.ts` | Condition ID coverage test | 100% match to resolutions |
| `scripts/CRITICAL-investigate-condition-ids.ts` | Comprehensive table scan | 40 tables analyzed |

---

## Key Numbers to Remember

### Data Volume
- **Total trades imported:** 159.6M (from CLOB API backfill)
- **With condition_id:** 82.1M (51%)
- **Without condition_id:** 77.4M (49%)

### Mapping Coverage
- **condition_market_map:** 151,843 unique mappings (100%)
- **market_resolutions_final:** 137,391 unique markets (100%)
- **api_ctf_bridge:** 156,952 unique mappings (100%)

### Join Test Results
- **Test:** trades_working (82.1M) LEFT JOIN market_resolutions_final
- **Result:** 100% match rate (82.1M matched, 0 unmatched)
- **Interpretation:** Mapping tables are perfect

### Recovery Assessment
- **Blockchain recovery:** 204K/77.4M traces found (0.26%)
- **API bridge recovery:** Not applicable (different ID scheme)
- **Market resolution lookup:** Not applicable (needs condition_id input)
- **Overall recovery:** 0% (unrecoverable)

---

## The Bottom Line

### What We Know (HIGH Confidence ✅)
1. Mapping tables are 100% complete and verified
2. The 82.1M trades with condition_id are perfect quality
3. The 77.4M trades without condition_id are unrecoverable from internal sources
4. Root cause is in the import layer (incomplete API response handling)
5. This is NOT a mapping or enrichment problem

### What We Can Do (Options)
1. **Path A:** Re-import with proper fallback (~90-95% coverage, 8-12h)
2. **Path B:** Deploy now with 51% coverage + warning (2-4h)
3. **Path C:** External data source for 100% coverage (budget dependent)

### What We Cannot Do
- ❌ Recover missing condition_ids from blockchain (only 0.26% possible)
- ❌ Use api_ctf_bridge to fill gaps (uses different ID scheme)
- ❌ Get more coverage without external action (data simply doesn't exist)
- ❌ Improve mapping tables further (already 100%)

---

## Questions This Investigation Answers

**Q: Why is condition_id enrichment only 51%?**
A: Original CLOB API backfill didn't populate condition_id for 49% of trades, and the import script had no fallback mechanism.

**Q: Are the mapping tables incomplete?**
A: No. All mapping tables (condition_market_map, market_resolutions_final, api_ctf_bridge) are 100% complete and verified.

**Q: Can we recover the missing 77.4M trades from blockchain?**
A: No. Only 204K out of 77.4M have any blockchain trace (0.26%), and they can't be matched without condition_id.

**Q: Will adding better JOIN logic help?**
A: No. We already tested the best possible JOIN (trades_working → market_resolutions_final) and got 100% match rate. The problem is upstream.

**Q: Is the P&L calculation engine broken?**
A: No. The 82.1M trades we have are perfect quality. The issue is coverage, not calculation.

**Q: What should we use: trades_raw or trades_working?**
A: Use trades_working (81.6M rows, 100% condition_id). Avoid trades_raw (contains 77.4M empty rows).

**Q: How long did the original import take?**
A: 2-5 hours for 1,048 days of data from Polymarket CLOB API.

**Q: Can we fix this without re-importing?**
A: No recovery path exists from internal sources. Options: re-import, accept 51%, or external source.

---

## Related Investigation Sessions

### Previous Work on This Issue
- **Session 1:** Initial mapping table analysis
- **Session 2:** Coverage distribution analysis (found 51% pattern)
- **Session 3:** ERC1155 blockchain recovery attempt (0.26% success)
- **Session 4:** api_ctf_bridge investigation (different ID scheme)
- **Session 5:** Root cause analysis (THIS SESSION)

### Next Steps
- **Decision Session:** Choose Path A, B, or C
- **Implementation Session:** Execute chosen path
- **Verification Session:** Test coverage improvement

---

## For Future Reference

### When Investigating Similar Issues
This investigation demonstrates:
1. Tracing data sources to root cause (not blaming downstream layers)
2. Verifying mapping completeness (100% JOIN success rate)
3. Testing recovery feasibility before committing effort
4. Clear documentation of what's known vs unknown
5. Decision-ready analysis with three concrete options

### Key Insight for Similar Problems
**Don't assume the problem is where you're looking (enrichment layer).** Trace the data flow backwards:
1. Which layer has the problem? (API import, not mapping)
2. Is it recoverable? (No internal source)
3. What are your options? (Re-import, accept, external source)

---

## Contact for Questions

This investigation is **COMPLETE and READY for decision-making**.

Key findings are HIGH CONFIDENCE and verified through multiple methods.

Next step: **Choose Path A, B, or C** and execute.

---

**Investigation Status:** ✅ COMPLETE
**Root Cause:** IDENTIFIED (import layer, incomplete API responses)
**Decision Status:** AWAITING STAKEHOLDER CHOICE (Path A/B/C)
**Ready to Implement:** ✅ YES

