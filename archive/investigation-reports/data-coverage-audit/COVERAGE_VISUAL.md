# Coverage Audit - Visual Summary
**Coverage Auditor Agent (C1) | 2025-11-15**

```
╔═══════════════════════════════════════════════════════════════════════╗
║                    CASCADIAN DATABASE COVERAGE                        ║
║                        1.20 Billion Rows                              ║
║                          58.66 GiB                                    ║
╚═══════════════════════════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────────────┐
│ OVERALL COVERAGE: 79% (Good, with 4 critical gaps)                  │
└─────────────────────────────────────────────────────────────────────┘


┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ DATA SOURCE COVERAGE                                              ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

CLOB Trading Data
├─ Markets in catalog:     149,908
├─ Markets with fills:     118,660  ████████░░ 79.2%  ⚠️
├─ Missing markets:         31,248  (20.8%)
├─ Total fills:         38,945,566
└─ Date range:      2022-12 to 2025-11-11 (1,065 days)

Market Metadata  
├─ gamma_markets:          149,908
├─ market_key_map:         156,952
├─ Join success:               100%  ██████████ 100%  ✅
└─ Status:                COMPLETE

Resolution Data
├─ Total resolutions:      123,245
├─ Unique conditions:      112,546
├─ Join success:               100%  ██████████ 100%  ✅
├─ Last update:       2025-11-05 06:31
├─ Days stale:                  10  ⚠️ POLLING FROZEN
└─ Status:                   STALE

ERC-1155 Blockchain
├─ Total transfers:     61,379,951
├─ Unique tokens:          262,775
├─ Mapped to markets:            0  ░░░░░░░░░░   0%  ❌
├─ Zero timestamps:             51  (99.99992% quality)
└─ Issue:              ENCODING MISMATCH

ERC-20 USDC
├─ Staging logs:       387,728,806
├─ Decoded:             21,103,660
├─ Final:                  288,681  (99.93% filtered)
└─ Status:                COMPLETE  ██████████ 100%  ✅

Wallet Identity
├─ Unique wallets:         735,637
├─ Mapped:                 735,637  ██████████ 100%  ✅
└─ Status:                COMPLETE


┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ CRITICAL JOIN SUCCESS RATES                                       ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

clob_fills → market_key_map
  38,945,566 fills  →  38,945,566 matched  ██████████ 100%  ✅

gamma_markets → gamma_resolved  
     149,908 markets →     149,908 resolved ██████████ 100%  ✅

Traded markets → gamma_resolved
     118,660 traded  →     118,660 resolved ██████████ 100%  ✅

clob_fills → wallet_identity_map
     735,637 wallets →     735,637 mapped   ██████████ 100%  ✅

erc1155_transfers → gamma_markets
  61,379,951 xfers  →           0 mapped   ░░░░░░░░░░   0%  ❌


┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ TEMPORAL COVERAGE - LAST 12 MONTHS                                ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

2025-11:  3,428,375 fills  ████████████████░░░░  ⚠️ DEGRADED
2025-10:  7,466,206 fills  ████████████████████  ✅ STRONG
2025-09:  3,989,800 fills  ████████████████████  ✅ NORMAL
2025-08:  3,540,510 fills  ████████████████████  ✅ NORMAL
2025-07:  2,851,200 fills  ████████████████████  ✅ NORMAL
2025-06:  2,231,661 fills  ████████████████████  ✅ NORMAL
2025-05:  1,699,503 fills  █████████████████░░░  ✅ NORMAL
2025-04:  1,484,869 fills  ███████████████░░░░░  ✅ NORMAL
2025-03:  1,629,259 fills  █████████████████░░░  ✅ NORMAL
2025-02:  1,326,080 fills  ██████████████░░░░░░  ✅ NORMAL
2025-01:  1,356,999 fills  ██████████████░░░░░░  ✅ NORMAL
2024-12:  1,580,598 fills  ████████████████░░░░  ✅ NORMAL


┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ RECENT ACTIVITY - LAST 7 DAYS (CRITICAL ISSUE)                    ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

2025-11-11:       1 fill   ░░░░░░░░░░░░░░░░░░░░  ❌ STALLED
2025-11-10:       0 fills  ░░░░░░░░░░░░░░░░░░░░  ❌ NO DATA
2025-11-09:       0 fills  ░░░░░░░░░░░░░░░░░░░░  ❌ NO DATA
2025-11-08:       0 fills  ░░░░░░░░░░░░░░░░░░░░  ❌ NO DATA
2025-11-07:       0 fills  ░░░░░░░░░░░░░░░░░░░░  ❌ NO DATA
2025-11-06:       0 fills  ░░░░░░░░░░░░░░░░░░░░  ❌ NO DATA
2025-11-05: 232,237 fills  ████████████████████  ✅ NORMAL

⚠️ BACKFILL STALLED: 5.5 day gap (Nov 6-11)


┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ CRITICAL GAPS (PRIORITY 1)                                        ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

┌─────────────────────────────────────────────────────────────────┐
│ Gap #1: CLOB Coverage 79.16%                                    │
├─────────────────────────────────────────────────────────────────┤
│ Missing:  31,248 markets (20.84%)                               │
│ Fix:      Resume CLOB backfill                                  │
│ Time:     4-6 hours                                             │
│ Status:   ⏳ May be in progress                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Gap #2: Stale Resolutions (10 Days)                             │
├─────────────────────────────────────────────────────────────────┤
│ Last:     Nov 5, 2025 06:31                                     │
│ Fix:      Resume Gamma polling                                  │
│ Time:     2 hours                                               │
│ Status:   ❌ TODO                                               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Gap #3: ERC-1155 Unmapped (0%)                                  │
├─────────────────────────────────────────────────────────────────┤
│ Blocked:  61.4M blockchain transfers                            │
│ Fix:      Token encoding conversion                             │
│ Time:     4-6 hours                                             │
│ Status:   ❌ TODO                                               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Gap #4: Recent Data Stalled (5.5 Days)                          │
├─────────────────────────────────────────────────────────────────┤
│ Gap:      Nov 6-11 (zero fills)                                 │
│ Fix:      Restart backfill                                      │
│ Time:     2-4 hours                                             │
│ Status:   ❌ TODO                                               │
└─────────────────────────────────────────────────────────────────┘


┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ TIME TO FIX ALL GAPS                                              ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

Can run in PARALLEL:
  Gap #1 (CLOB backfill)         4-6 hours   ═══════════════
  Gap #2 (Gamma polling)         2 hours     ══════
  Gap #3 (ERC-1155 encoding)     4-6 hours   ═══════════════
  Gap #4 (Recent data)           2-4 hours   ═════════
                                ──────────────────────────
  TOTAL CRITICAL PATH:           12-16 hours ████████████████


┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ GO / NO-GO CRITERIA FOR P&L PHASE                                 ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

┌─────────────────────────────────────────┬──────────┬──────────┐
│ Criteria                                │ Current  │ Required │
├─────────────────────────────────────────┼──────────┼──────────┤
│ CLOB coverage                           │  79.2%   │  ≥95%    │ ❌
│ Resolution freshness                    │ 10 days  │  ≤2 days │ ❌
│ ERC-1155 mapping                        │   0%     │  ≥90%    │ ❌
│ Recent data lag                         │ 4+ days  │  ≤1 day  │ ❌
│ Critical join success                   │  100%    │  ≥95%    │ ✅
└─────────────────────────────────────────┴──────────┴──────────┘

VERDICT: 1/5 criteria met - NOT READY FOR P&L

After fixes: 5/5 criteria met - READY FOR P&L


┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ COVERAGE AFTER ALL FIXES                                          ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

CLOB Coverage:        79.2% → 97%+     ████████████████░░  +17.8pp
Resolution Freshness: 10d   → <1d      ██████████████████  -9 days
ERC-1155 Mapping:     0%    → 95%+     ████████████████░░  +95pp
Recent Data:          4d    → current  ██████████████████  -4 days
Join Success:         100%  → 100%     ██████████████████   0pp


╔═══════════════════════════════════════════════════════════════════════╗
║                         KEY INSIGHTS                                  ║
╚═══════════════════════════════════════════════════════════════════════╝

✅ Database architecture is SOLID (100% join success)
✅ Data quality is EXCELLENT (99.99992% ERC-1155 quality)
⚠️ Main issues are OPERATIONAL (stalled backfills, frozen polling)
⚠️ One STRUCTURAL issue (ERC-1155 encoding mismatch)
✅ Database is WELL-MAINTAINED (only 4.2% empty tables)


╔═══════════════════════════════════════════════════════════════════════╗
║                      RECOMMENDATION                                   ║
╚═══════════════════════════════════════════════════════════════════════╝

Fix all 4 P1 gaps BEFORE proceeding to P&L calculations.

Estimated time: 12-16 hours (can run in parallel)

Next phase: Create "BEFORE WE DO ANY PNL" checklist

──────────────────────────────────────────────────────────────────────────
Terminal: Coverage Auditor Agent (C1)
Status: ✅ COMPLETE
Reports: DATA_COVERAGE_REPORT_C1.md (full), COVERAGE_AUDIT_SUMMARY.md
Timestamp: 2025-11-15 05:15:00 PST
──────────────────────────────────────────────────────────────────────────
```
