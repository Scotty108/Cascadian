# ERC1155 Backfill Investigation - Complete Index

**Generated:** November 9, 2025  
**Status:** Comprehensive analysis complete  
**Key Finding:** Data exists from Dec 2022, but June 2024-Nov 2025 only currently ingested

---

## Three Documents Created

### 1. Quick Reference (START HERE)
**File:** `/Users/scotty/Projects/Cascadian-app/ERC1155_QUICK_REFERENCE.md`

Quick lookup for:
- Which scripts write to which tables
- Current block ranges
- How to backfill all historical data
- Configuration changes needed
- Validation commands

**Read time:** 5 minutes
**Best for:** Developers who need immediate answers

---

### 2. Complete Technical Analysis (DETAILED)
**File:** `/Users/scotty/Projects/Cascadian-app/ERC1155_PIPELINE_COMPLETE_ANALYSIS.md`

Comprehensive documentation including:
- All scripts that touch ERC1155 data (23 scripts identified)
- Block ranges and historical timeline
- Data sources (RPC, Goldsky, alternatives)
- Current data state and checkpoints
- Table schemas
- Detailed modification guide for full historical coverage
- Key constants and configuration
- Dependency chain
- Cost and time estimates

**Read time:** 20-30 minutes
**Best for:** Understanding the entire architecture

---

### 3. This Index (META)
**File:** `/Users/scotty/Projects/Cascadian-app/ERC1155_BACKFILL_INDEX.md`

Navigation guide for all documentation

---

## Key Findings Summary

### What We Found

1. **23 Scripts Process ERC1155 Data**
   - 9 primary backfill scripts (write to erc1155_transfers)
   - 4 flattening scripts (write to pm_erc1155_flats)
   - 3 condition_id extraction scripts
   - 7 validation/diagnostic scripts

2. **Block Range: December 18, 2022 Onwards**
   - START_BLOCK: 37515000 (hard-coded in 8 scripts)
   - END_BLOCK: Current block (fetched dynamically)
   - Contract: 0x4d97dcd97ec945f40cf65f87097ace5ea0476045 (ConditionalTokens)

3. **Data Source: Alchemy Polygon RPC**
   - Event: TransferBatch (0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb)
   - Method: eth_getLogs with 1000-block batches
   - Primary RPC: ALCHEMY_POLYGON_RPC_URL

4. **Critical Gap Identified**
   - Data exists from: December 18, 2022
   - Data ingested: June 2024 onwards
   - Missing: December 2022 - May 2024 (~18M+ events)
   - Reason: Backfill script only runs once per deployment, not continuous

5. **Recovery Paths Available**
   - Option A: Archive RPC (Alchemy Growth ~$25/month, 2-3 hours)
   - Option B: Public RPC (free, 11-20 hours, unreliable)
   - Option C: Two-phase (fill gap first, then check pre-2022)

---

## Scripts by Category

### Fetch Phase (RPC → erc1155_transfers)
```
RECOMMENDED: phase2-full-erc1155-backfill-v2-resilient.ts (robust, 45min)
FAST:        phase2-full-erc1155-backfill-turbo.ts (2hr, 32 workers)
ALTERNATIVE: phase2-full-erc1155-backfill-http.ts (raw HTTP)
LEGACY:      phase2-full-erc1155-backfill-v2.ts
             phase2-full-erc1155-backfill-parallel.ts
PILOT:       phase2-pilot-erc1155-backfill.ts
DESIGN:      phase2-fetch-erc1155-complete.ts, phase2-fetch-erc1155.ts
             fetch-erc1155-transfers.ts
```

**Location:** `/Users/scotty/Projects/Cascadian-app/scripts/`

### Flatten Phase (erc1155_transfers → pm_erc1155_flats)
```
RECOMMENDED: flatten-erc1155-correct.ts (best decoding)
LEGACY:      flatten-erc1155.ts
ALTERNATIVE: worker-goldsky.ts (with validation)
HELPER:      decode-transfer-batch.ts
```

**Location:** `/Users/scotty/Projects/Cascadian-app/scripts/` and root

### Extract Phase (token_id → condition_id)
```
RECOMMENDED: worker-erc1155-condition-ids.ts (bit shifting)
COMPREHENSIVE: execute-erc1155-recovery.ts (full pipeline)
RECOVERY:   backfill-missing-erc1155-by-txhash.ts
```

**Location:** Root directory and `/scripts/`

### Validation Phase
```
QUICK:   check-erc1155-progress.ts (in root)
DETAILED: verify-erc1155.ts (in root)
CONNECTION: scripts/test-blockchain-connection.ts
FRESHNESS: scripts/data-freshness-check.ts
```

---

## Timeline for Full Historical Coverage

### Polymarket History
```
2020         → Polymarket launched (block unknown)
2022 Q4      → ConditionalTokens deployed (block 37515000, Dec 18)
2024 June    → Backfill started (block ~55.5M)
2025 Nov     → Current (block ~78.7M)
```

### Data Coverage
```
Period              Status
─────────────────────────────────
2020-2021           ⚠️  Unknown (pre-contract)
2021-Dec 2022       ⚠️  Unknown (pre-contract)
Dec 2022-May 2024   ❌ MISSING (not fetched)
June 2024-Nov 2025  ✅ COMPLETE
```

---

## How to Use These Documents

### For Quick Information
1. Read: `ERC1155_QUICK_REFERENCE.md`
2. Find what you need in the tables
3. Run the command or check the file location

### For Understanding Architecture
1. Read: `ERC1155_PIPELINE_COMPLETE_ANALYSIS.md` Part 1 (Scripts)
2. Review: Part 2 (Block Ranges)
3. Check: Part 3 (Data Sources)

### For Implementation
1. Read: Part 5 (Modifications for Full History)
2. Follow: Part 6 (Recommended Action Plan)
3. Use: Part 7 (Key Constants)

### For Troubleshooting
1. Check: `ERC1155_QUICK_REFERENCE.md` Validation Commands
2. Review: Checkpoint files
3. Consult: Part 4 (Current Data State)

---

## File Locations (Quick Reference)

### Main Analysis Documents
- `/Users/scotty/Projects/Cascadian-app/ERC1155_QUICK_REFERENCE.md` (5 min read)
- `/Users/scotty/Projects/Cascadian-app/ERC1155_PIPELINE_COMPLETE_ANALYSIS.md` (20 min read)
- `/Users/scotty/Projects/Cascadian-app/ERC1155_BACKFILL_INDEX.md` (this file)

### Script Locations
- Backfill scripts: `/Users/scotty/Projects/Cascadian-app/scripts/phase2-*.ts`
- Flatten scripts: `/Users/scotty/Projects/Cascadian-app/scripts/flatten-*.ts`
- Extraction scripts: `/Users/scotty/Projects/Cascadian-app/worker-*.ts`
- Validation: `/Users/scotty/Projects/Cascadian-app/check-erc1155-*.ts`

### Checkpoint Files
- `/Users/scotty/Projects/Cascadian-app/blockchain-backfill-checkpoint-1.json` through checkpoint-5.json

---

## Next Steps

### Immediate Actions
1. Review `ERC1155_QUICK_REFERENCE.md` (5 min)
2. Decide: Do you need pre-June 2024 data?
3. If yes: Follow Option 1 or 2 in quick reference

### If Filling June 2024-Dec 2022 Gap
1. Get Alchemy Archive access (free growth plan)
2. Update .env.local with ALCHEMY_POLYGON_RPC_URL
3. Run: `npx tsx scripts/phase2-full-erc1155-backfill-turbo.ts`
4. Validate: `npx tsx check-erc1155-progress.ts`

### If Checking Pre-December 2022
1. Run: `npx tsx scripts/test-blockchain-connection.ts`
2. Verify contract deployment block
3. Update START_BLOCK if needed
4. Re-run backfill with adjusted parameters

### Complete Pipeline (All Stages)
1. Fetch: Run phase2-full-erc1155-backfill-turbo.ts
2. Flatten: Run flatten-erc1155-correct.ts
3. Extract: Run worker-erc1155-condition-ids.ts
4. Validate: Run check-erc1155-progress.ts

---

## Estimated Time & Cost

### To Fill June 2024-Dec 2022 Gap Only
- Time: 2-3 hours
- Cost: ~$0 (included in Alchemy Growth free tier)
- Complexity: Low (just run script)

### To Complete 2020-Nov 2025
- Time: 4-6 hours total
- Cost: ~$0 if using Alchemy Growth tier
- Complexity: Medium (verify deployment block first)

### With Public RPC (Not Recommended)
- Time: 11-20 hours
- Cost: $0
- Reliability: Low (may need restarts)

---

## Key Decisions Made

1. **Why data is missing (Dec 2022-May 2024):**
   - Backfill script only runs once per environment
   - Environment was brought online June 2024
   - Earlier transactions never fetched from RPC

2. **Why we can still get it:**
   - Contract deployed Dec 2022, still exists
   - All events permanently stored on blockchain
   - RPC providers maintain full history

3. **Why Archive RPC is recommended:**
   - Free tier (Alchemy Growth) includes archive
   - Public RPC has timeout limits (500 blocks max)
   - Archive RPC can fetch 10k blocks per request
   - 4-6x faster than public RPC

---

## Document Cross-References

### In Quick Reference
- "For detailed information, see:" → ERC1155_PIPELINE_COMPLETE_ANALYSIS.md
- "How to backfill all historical data" → Complete Analysis Part 5

### In Complete Analysis
- "Files Created" → Lists all related documents
- "Quick Start" → ERC1155_QUICK_REFERENCE.md commands
- "Recommended Action Plan" → Implementation steps

### In This Index
- Links to both detailed documents
- Overview of all findings
- Navigation guide

---

## Conclusion

**Current Status:** Data incomplete (June 2024-present only)

**Solution Available:** Yes, can recover all data from Dec 2022+

**Time to Fix:** 2-3 hours with Archive RPC

**Cost to Fix:** ~$0-25/month (Alchemy Growth tier)

**Complexity:** Low (modify one constant, run script)

---

## Questions Answered

1. **Which scripts write to erc1155_transfers?** → 9 scripts in `scripts/` directory
2. **What block ranges do they use?** → 37515000 (Dec 18, 2022) to current
3. **What data sources are they reading from?** → Alchemy Polygon RPC
4. **How to modify for full 2020-2024 coverage?** → See Part 5 in Complete Analysis

---

**Created:** November 9, 2025  
**Analysis Type:** Thorough (Very Thorough)  
**Documents:** 3 comprehensive guides  
**Scripts Analyzed:** 23 files  
**Time to Implement:** 2-3 hours  

---

**Start with:** `/Users/scotty/Projects/Cascadian-app/ERC1155_QUICK_REFERENCE.md`
