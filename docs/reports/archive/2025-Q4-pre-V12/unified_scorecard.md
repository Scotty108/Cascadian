# Unified PnL Scorecard - 2025-12-07

## Executive Summary

**Best Engine Overall:** V11

### Production Recommendation

- **Ship Cohort:** transfer_free
- **Use Engine:** V11
- **Pass Rate:** 71.0%
- **Rationale:** transfer_free achieves 71.0% pass rate with 100 wallets using V11

## Engine Comparison

### V11

**Benchmark:** Dome Realized
**Thresholds:** Large (>=$200): <=6% | Small: <=$10

**Overall:** 117/265 (44.2%)

| Cohort | Passed | Total | Rate |
|--------|--------|-------|------|
| transfer_free | 71 | 100 | 71.0% |
| large_pnl | 87 | 218 | 39.9% |

### V29

**Benchmark:** Dome Realized
**Thresholds:** Large (>=$200): <=6% | Small: <=$10

**Overall:** 82/265 (30.9%)

| Cohort | Passed | Total | Rate |
|--------|--------|-------|------|
| transfer_free | 35 | 100 | 35.0% |
| large_pnl | 52 | 218 | 23.9% |

## Cohort Definitions

See [PNL_TAXONOMY.md](./PNL_TAXONOMY.md) for full definitions.

| Cohort | Description |
|--------|-------------|
| transfer_free | No ERC1155 transfers |
| clob_only | Only CLOB trades |
| clob_only_closed | CLOB-only with all positions closed |
| trader_strict | CLOB-only + transfer-free + no splits/merges |
| clean_large_traders | trader_strict + |PnL| >= $200 |

## Validation Thresholds

| PnL Magnitude | Threshold | Type |
|---------------|-----------|------|
| |PnL| >= $200 | <= 6% | Percentage |
| |PnL| < $200 | <= $10 | Absolute |

## Configuration

```json
{
  "cohorts": [
    "transfer_free",
    "large_pnl"
  ],
  "engines": [
    "v11",
    "v29"
  ],
  "manifest_path": "tmp/pnl_cohort_manifest.json",
  "limit_per_cohort": 200
}
```

---
*Generated: 2025-12-07T09:01:52.361Z*