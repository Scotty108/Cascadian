# Canonical Table Usage Audit Report

> **Generated:** 2025-12-10T00:41:22.836Z
> **Total violations:** 373
> **Files affected:** 142

---

## Summary

| Category | Count |
|----------|-------|
| Deprecated tables | 42 |
| Hardcoded canonicals | 15 |

---

## Violations by File

### lib/pnl/walletClassifier.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 98 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 107 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 332 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### lib/pnl/v23cBatchLoaders.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 19 | `'pm_unified_ledger_v8_tbl'` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### lib/pnl/uiPnlEngineV13.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 31 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 157 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### lib/pnl/uiPnlEngineV12.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 16 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 69 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### lib/pnl/uiActivityEngineV9.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 120 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### lib/pnl/uiActivityEngineV8.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 177 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### lib/pnl/uiActivityEngineV6.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 199 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 276 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 292 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### lib/pnl/uiActivityEngineV5.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 159 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 356 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### lib/pnl/uiActivityEngineV4.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 151 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### lib/pnl/uiActivityEngineV3WithFPMM.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 146 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### lib/pnl/uiActivityEngineV3.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 179 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### lib/pnl/uiActivityEngineV22.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 8 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 106 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 245 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### lib/pnl/uiActivityEngineV21.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 70 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 184 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 213 | `pm_token_to_condition_map_v4` | CANONICAL_TABLES.TOKEN_MAP |

### lib/pnl/uiActivityEngineV20b.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 66 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 75 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 90 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 191 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 205 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 226 | `pm_token_to_condition_map_v4` | CANONICAL_TABLES.TOKEN_MAP |

### lib/pnl/uiActivityEngineV20a.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 74 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 174 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 192 | `pm_token_to_condition_map_v4` | CANONICAL_TABLES.TOKEN_MAP |

### lib/pnl/uiActivityEngineV20.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 8 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 76 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 176 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 8 | `pm_token_to_condition_map_v4` | CANONICAL_TABLES.TOKEN_MAP |
| 194 | `pm_token_to_condition_map_v4` | CANONICAL_TABLES.TOKEN_MAP |

### lib/pnl/uiActivityEngineV19.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 6 | `pm_unified_ledger_v6` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 9 | `pm_unified_ledger_v6` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 38 | `pm_unified_ledger_v6` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 101 | `pm_unified_ledger_v6` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 115 | `pm_unified_ledger_v6` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 126 | `pm_unified_ledger_v6` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 212 | `pm_unified_ledger_v6` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 378 | `pm_unified_ledger_v6` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 44 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 115 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 144 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### lib/pnl/uiActivityEngineV18.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 163 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### lib/pnl/uiActivityEngineV17UiMode.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 99 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### lib/pnl/uiActivityEngineV17.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 42 | `pm_cascadian_pnl_v1` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 143 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### lib/pnl/uiActivityEngineV16.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 308 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 940 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### lib/pnl/uiActivityEngineV15.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 229 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### lib/pnl/uiActivityEngineV14.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 263 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### lib/pnl/uiActivityEngineV13.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 42 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 196 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 249 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 392 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### lib/pnl/uiActivityEngineV12.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 159 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 565 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 577 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### lib/pnl/uiActivityEngineV10.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 168 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### lib/pnl/staticPositionAnalysis.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 51 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 79 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 98 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### lib/pnl/shadowLedgerV23d.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 680 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### lib/pnl/shadowLedgerV23c.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 97 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 152 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 184 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 234 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### lib/pnl/shadowLedgerV23b.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 71 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 113 | `pm_token_to_condition_map_v4` | CANONICAL_TABLES.TOKEN_MAP |

### lib/pnl/shadowLedgerV23.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 496 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 498 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 507 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 569 | `pm_token_to_condition_map_v4` | CANONICAL_TABLES.TOKEN_MAP |

### lib/pnl/pnlDisplayLayer.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 71 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 145 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 161 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 212 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### lib/pnl/getWalletPnl.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 19 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### lib/pnl/getWalletConfidence.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 68 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 79 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### lib/pnl/ctfSidecarEngine.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 11 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 83 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### lib/pnl/computeUiPnlFromLedger.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 4 | `pm_unified_ledger_v5` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 62 | `pm_unified_ledger_v5` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### lib/pnl/computeUiPnlEstimate.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 72 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### lib/pnl/archive/engines_pre_v12/inventoryEngineV28.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 351 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 365 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 405 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### lib/pnl/archive/engines_pre_v12/inventoryEngineV27b.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 355 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 369 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 409 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 470 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### lib/pnl/archive/engines_pre_v12/inventoryEngineV27.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 363 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 377 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 420 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 471 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### lib/pnl/archive/engines_pre_v12/hybridEngineV25.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 6 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 9 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 14 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 118 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 144 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 155 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 207 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 219 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 307 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 319 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### lib/pnl/archive/engines_pre_v12/goldenEngineV26.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 9 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 14 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 87 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 119 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 241 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/verify-theo-pnl-formula.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 26 | `pm_token_to_condition_map_v4` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/verify-negrisk-clob-double-count.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 31 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 89 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 112 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/v8-validation-simple.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 84 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/v6_partial_pnl.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 134 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/v19-maker-only-benchmark.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 57 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 173 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/v19-deduped-benchmark.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 4 | `pm_unified_ledger_v5` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 40 | `pm_unified_ledger_v5` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/ui-parity-benchmarks.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 135 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 175 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/ui-activity-pnl-simulator.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 118 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 251 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/ui-activity-pnl-simulator-v3.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 128 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 372 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/ui-activity-pnl-simulator-v2.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 121 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 324 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/token-mapping-coverage.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 118 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 123 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 137 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 142 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/test-v29-benchmark.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 181 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/test-v19-engine.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 33 | `pm_unified_ledger_v6` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/test-v17-all-wallets.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 5 | `pm_cascadian_pnl_v1` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 35 | `pm_cascadian_pnl_v1` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/test-trader-filter.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 44 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/test-rounding-hypothesis.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 62 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/test-ledger-benchmark.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 4 | `pm_unified_ledger_v5` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 26 | `pm_unified_ledger_v5` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/test-clob-only.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 35 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/test-clob-only-v2.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 42 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/test-bypass-mapping.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 4 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/resolve-unmapped-tokens.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 420 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 292 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 304 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 311 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 8 | `pm_token_to_condition_map_v4` | CANONICAL_TABLES.TOKEN_MAP |
| 275 | `pm_token_to_condition_map_v4` | CANONICAL_TABLES.TOKEN_MAP |
| 279 | `pm_token_to_condition_map_v4` | CANONICAL_TABLES.TOKEN_MAP |
| 285 | `pm_token_to_condition_map_v4` | CANONICAL_TABLES.TOKEN_MAP |
| 313 | `pm_token_to_condition_map_v4` | CANONICAL_TABLES.TOKEN_MAP |
| 419 | `pm_token_to_condition_map_v4` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/resolution-coverage-audit.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 48 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 49 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 131 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 134 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 47 | `'pm_condition_resolutions'` | CANONICAL_TABLES.RESOLUTIONS |

### scripts/pnl/reconcile-smart-money-1.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 71 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/recompute-unmapped-tokens-v4.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 23 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 5 | `pm_token_to_condition_map_v4` | CANONICAL_TABLES.TOKEN_MAP |
| 25 | `pm_token_to_condition_map_v4` | CANONICAL_TABLES.TOKEN_MAP |
| 60 | `pm_token_to_condition_map_v4` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/rebuild-cascadian-pnl-v2.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 74 | `pm_cascadian_pnl_v2` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 77 | `pm_cascadian_pnl_v2` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 81 | `pm_cascadian_pnl_v2` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 149 | `pm_cascadian_pnl_v2` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 324 | `pm_cascadian_pnl_v2` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 327 | `pm_cascadian_pnl_v2` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 333 | `pm_cascadian_pnl_v2` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 333 | `pm_cascadian_pnl_v2` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 336 | `pm_cascadian_pnl_v2` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 336 | `pm_cascadian_pnl_v2` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 338 | `pm_cascadian_pnl_v2` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 338 | `pm_cascadian_pnl_v2` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 353 | `pm_cascadian_pnl_v2` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 374 | `pm_cascadian_pnl_v2` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 178 | `pm_token_to_condition_map_v4` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/rebuild-cascadian-pnl-full.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 59 | `pm_cascadian_pnl_v1` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 62 | `pm_cascadian_pnl_v1` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 66 | `pm_cascadian_pnl_v1` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 126 | `pm_cascadian_pnl_v1` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 266 | `pm_cascadian_pnl_v1` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 269 | `pm_cascadian_pnl_v1` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 275 | `pm_cascadian_pnl_v1` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 275 | `pm_cascadian_pnl_v1` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 278 | `pm_cascadian_pnl_v1` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 278 | `pm_cascadian_pnl_v1` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 280 | `pm_cascadian_pnl_v1` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 280 | `pm_cascadian_pnl_v1` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 293 | `pm_cascadian_pnl_v1` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 156 | `pm_token_to_condition_map_v4` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/omega-spotcheck-step1.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 11 | `pm_cascadian_pnl_v2` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 21 | `pm_cascadian_pnl_v2` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 40 | `pm_cascadian_pnl_v2` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 45 | `pm_cascadian_pnl_v2` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/materialize-v8-ledger.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 31 | `'pm_unified_ledger_v8_tbl'` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/market-sanity-report.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 86 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 112 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 165 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 229 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 285 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/log-block-coverage.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 161 | `'pm_trader_events_v2'` | CANONICAL_TABLES.TRADER_EVENTS |
| 316 | `'pm_trader_events_v2'` | CANONICAL_TABLES.TRADER_EVENTS |

### scripts/pnl/investigate-w3.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 29 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/investigate-user-positions.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 86 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 90 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 96 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/investigate-theo4-gap.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 72 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/investigate-theo-losses.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 29 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 71 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/investigate-phantom-positions.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 72 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 93 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/investigate-open-positions.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 64 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/find-wallet-in-trump.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 17 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/find-high-error-wallets.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 11 | `pm_cascadian_pnl_v1` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/find-and-fix-unmapped-tokens.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 448 | `pm_unified_ledger_v6` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 6 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 59 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 284 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 297 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 306 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 9 | `pm_token_to_condition_map_v4` | CANONICAL_TABLES.TOKEN_MAP |
| 261 | `pm_token_to_condition_map_v4` | CANONICAL_TABLES.TOKEN_MAP |
| 266 | `pm_token_to_condition_map_v4` | CANONICAL_TABLES.TOKEN_MAP |
| 276 | `pm_token_to_condition_map_v4` | CANONICAL_TABLES.TOKEN_MAP |
| 302 | `pm_token_to_condition_map_v4` | CANONICAL_TABLES.TOKEN_MAP |
| 310 | `pm_token_to_condition_map_v4` | CANONICAL_TABLES.TOKEN_MAP |
| 420 | `pm_token_to_condition_map_v4` | CANONICAL_TABLES.TOKEN_MAP |
| 448 | `pm_token_to_condition_map_v4` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/experiment-v19-vs-ui-v6.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 60 | `pm_unified_ledger_v6` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 11 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/drilldown-unknowns.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 110 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/drilldown-fail-both.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 91 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 168 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 189 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/dossier-outliers.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 78 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 198 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/diagnose-v23.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 116 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 123 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 137 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 173 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 181 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 190 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 420 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/diagnose-engine-failures.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 74 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 79 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 100 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/derive-backfill-plan.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 103 | `'pm_trader_events_v2'` | CANONICAL_TABLES.TRADER_EVENTS |
| 106 | `'pm_trader_events_v2'` | CANONICAL_TABLES.TRADER_EVENTS |

### scripts/pnl/decompose-v20-error.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 138 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 165 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 183 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/debug-wallet-pnl.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 40 | `pm_cascadian_pnl_v1` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 73 | `pm_cascadian_pnl_v1` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/debug-w2-activity.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 49 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/debug-v10-per-position.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 109 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/debug-unified-ledger-wallet.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 24 | `pm_unified_ledger_v5` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 54 | `pm_unified_ledger_v5` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 114 | `pm_unified_ledger_v5` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 139 | `pm_unified_ledger_v5` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/debug-trump-position.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 32 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/debug-negrisk-vs-clob-overlap.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 34 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 54 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 77 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 108 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/data-gap-analysis.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 236 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 262 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 299 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/data-gap-analysis-simple.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 68 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/data-coverage-audit.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 6 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 112 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 134 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 340 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 381 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/ctf-evolution-debugger.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 46 | `pm_unified_ledger_v6` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/create-v9-unified-ledger.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 150 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/create-v7-view-with-txhash-dedup.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 98 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/create-unified-ledger-v6.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 155 | `pm_unified_ledger_v5` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 2 | `pm_unified_ledger_v6` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 14 | `pm_unified_ledger_v6` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 17 | `pm_unified_ledger_v6` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 128 | `pm_unified_ledger_v6` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 68 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/create-unified-ledger-v5.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 2 | `pm_unified_ledger_v5` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 12 | `pm_unified_ledger_v5` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 15 | `pm_unified_ledger_v5` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 124 | `pm_unified_ledger_v5` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 64 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/create-retail-wallet-view.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 55 | `pm_unified_ledger_v5` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/compare-wallet-activity-vs-ui.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 104 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 185 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/compare-v16-vs-cascadian.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 2 | `pm_cascadian_pnl_v1` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 50 | `pm_cascadian_pnl_v1` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 93 | `pm_cascadian_pnl_v1` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/compare-pnl-formulas.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 28 | `pm_token_to_condition_map_v4` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/classify-wallet-data-sources.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 275 | `pm_unified_ledger_v5` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/classify-market-makers.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 386 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/check-w2-unredeemed.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 18 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/check-unified-vs-v18-clob-only.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 4 | `pm_unified_ledger_v6` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 9 | `pm_unified_ledger_v6` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 62 | `pm_unified_ledger_v6` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 149 | `pm_unified_ledger_v6` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 38 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/check-negrisk-coverage.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 66 | `'pm_trader_events_v2'` | CANONICAL_TABLES.TRADER_EVENTS |

### scripts/pnl/check-negrisk-clob-exclusive.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 35 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 56 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 76 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/check-fills-completeness.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 117 | `pm_token_to_condition_map_v4` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/check-ctf-and-unified.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 21 | `pm_unified_ledger_v5` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 37 | `pm_unified_ledger_v5` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/canonical-pnl-v6.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 40 | `pm_unified_ledger_v6` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/canonical-pnl-engine.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 134 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/calculate-complete-pnl.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 75 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/build-wallet-feature-table.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 151 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/build-trader-strict-sample-v2.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 152 | `'pm_unified_ledger_v8_tbl'` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/backfill-ctf-flows-inferred.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 94 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 143 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/audit-metrics-capability.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 63 | `pm_token_to_condition_map_v4` | CANONICAL_TABLES.TOKEN_MAP |
| 61 | `'pm_trader_events_v2'` | CANONICAL_TABLES.TRADER_EVENTS |
| 153 | `'pm_trader_events_v2'` | CANONICAL_TABLES.TRADER_EVENTS |
| 201 | `'pm_trader_events_v2'` | CANONICAL_TABLES.TRADER_EVENTS |
| 208 | `'pm_trader_events_v2'` | CANONICAL_TABLES.TRADER_EVENTS |
| 209 | `'pm_trader_events_v2'` | CANONICAL_TABLES.TRADER_EVENTS |

### scripts/pnl/audit-ledger-vs-raw.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 5 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 65 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/audit-data-pipeline.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 198 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 203 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 214 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 227 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 245 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 403 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 418 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 429 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 445 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |
| 504 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/analyze-w3-positions.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 47 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/analyze-w3-detailed.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 132 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/analyze-unified-source-types.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 4 | `pm_unified_ledger_v5` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 43 | `pm_unified_ledger_v5` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 84 | `pm_unified_ledger_v5` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 135 | `pm_unified_ledger_v5` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/analyze-theo4-netted.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 41 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/analyze-theo4-detailed.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 38 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/analyze-fills-pnl.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 81 | `pm_token_to_condition_map_v4` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/analyze-benchmark-wallets-sources.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 32 | `pm_unified_ledger_v5` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 52 | `pm_unified_ledger_v5` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/tests/clob-engine-validation.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 136 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/lib/blockCoverage.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 306 | `'pm_trader_events_v2'` | CANONICAL_TABLES.TRADER_EVENTS |

### scripts/pnl/archive/pre_v12/validate-v7-with-txhash-dedup.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 150 | `pm_token_to_condition_map_v3` | CANONICAL_TABLES.TOKEN_MAP |

### scripts/pnl/archive/pre_v12/benchmark-v28-condition-level.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 90 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/archive/pre_v12/benchmark-v27b-inventory.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 95 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/archive/pre_v12/benchmark-v27-inventory.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 92 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/archive/pre_v12/benchmark-v26-golden.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 7 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 90 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/archive/pre_v12/benchmark-v25-hybrid.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 5 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 36 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 65 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 83 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/archive/pre_v12/benchmark-v23-shadow-ledger.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 58 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/archive/pre_v12/benchmark-v2-pnl.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 17 | `pm_cascadian_pnl_v2` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 71 | `pm_cascadian_pnl_v2` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

### scripts/pnl/archive/pre_v12/benchmark-v19-v20.ts

| Line | Pattern | Fix |
|------|---------|-----|
| 5 | `pm_unified_ledger_v6` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 33 | `pm_unified_ledger_v6` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 6 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |
| 34 | `pm_unified_ledger_v7` | CANONICAL_TABLES.UNIFIED_LEDGER_FULL |

---

## How to Fix

1. Add import at top of file:
```typescript
import { CANONICAL_TABLES } from '@/lib/pnl/canonicalTables';
```

2. Replace hardcoded table names with constants:
```typescript
// Before
const query = `SELECT * FROM pm_unified_ledger_v8_tbl ...`;

// After
const query = `SELECT * FROM ${CANONICAL_TABLES.UNIFIED_LEDGER_FULL} ...`;
```

---

*Generated by scripts/pnl/audit-canonical-usage.ts*