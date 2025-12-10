# Copy-Trading Metrics Gate Specification

**Date:** 2025-12-09
**Terminal:** Terminal 2 (Scaling & Hardening)
**Status:** Production-Ready

---

## Executive Summary

The Copy-Trading Metrics Gate defines which wallets can be reliably scored and ranked for copy-trading leaderboards. The classifier partitions the ~1.7M Polymarket wallets into three tiers based on trading behavior complexity.

### Tier Distribution (as of 2025-12-09)

| Tier | Count | Description |
|------|-------|-------------|
| **A** | 120,347 | CLOB-dominant, safe for metrics |
| **B** | 753,358 | Some complexity, mostly CLOB |
| **X** | 795,673 | Excluded - complex mechanics |

---

## Tier A: Safe for Copy-Trading Metrics

### Definition

Tier A wallets are "safe" for realized PnL and other trading metrics because they:
- Trade exclusively via CLOB (no AMM)
- Have no CTF split/merge operations
- Have minimal external transfers
- Have mostly resolved positions
- Are not market makers

### Criteria

```sql
tier = 'A' WHEN:
  amm_event_count = 0
  AND split_count = 0
  AND merge_count = 0
  AND transfer_dominance_pct < 5%
  AND unresolved_pct < 20%
  AND clob_event_count >= 50
  AND mm_likelihood_flag = 0
```

### Rationale

| Criterion | Why |
|-----------|-----|
| `amm_event_count = 0` | AMM trades use different pricing model |
| `split_count = 0` | Splits create phantom inventory |
| `merge_count = 0` | Merges compress position history |
| `transfer_dominance < 5%` | High transfers indicate external activity |
| `unresolved < 20%` | Ensures most PnL is realized and comparable |
| `clob_event_count >= 50` | Minimum activity threshold |
| `mm_likelihood = 0` | MMs have different risk profile |

---

## Tier B: May Be Usable Later

### Definition

Tier B wallets have some complexity but are mostly CLOB-based. They could be included in future versions with additional normalization.

### Criteria

```sql
tier = 'B' WHEN:
  NOT tier_a_criteria
  AND amm_dominance_pct < 10%
  AND ctf_dominance_pct < 10%
  AND clob_event_count >= 20
```

### Use Cases

- Extended leaderboards with complexity disclaimers
- Research cohorts for testing new metrics
- Fallback when Tier A is too restrictive

---

## Tier X: Excluded

### Definition

Tier X wallets have trading patterns that cannot be reliably scored:
- Heavy AMM usage
- Significant CTF mechanics (splits/merges)
- High external transfer activity
- Potential bots or MMs

### Examples

| Pattern | Count | Description |
|---------|-------|-------------|
| AMM-heavy | ~590K | >10% AMM volume |
| Split-heavy | ~48M events | CTF mechanics |
| Transfer-heavy | Variable | External movements |
| Market makers | ~189 flagged | High-volume makers |

---

## ClickHouse View: `trader_strict_classifier_v1`

### Schema

```sql
CREATE VIEW trader_strict_classifier_v1 AS
SELECT
  wallet_address,
  clob_event_count,
  clob_usdc_volume,
  clob_unresolved_count,
  split_count,
  merge_count,
  redemption_count,
  amm_event_count,
  amm_usdc_volume,
  maker_count,
  taker_count,
  unique_clob_events,
  transfer_count,
  unresolved_pct,
  maker_share_pct,
  amm_dominance_pct,
  transfer_dominance_pct,
  mm_likelihood_flag,
  tier
FROM ...
```

### Query Example

```sql
-- Get Tier A wallets ordered by volume
SELECT wallet_address, clob_usdc_volume, unresolved_pct
FROM trader_strict_classifier_v1
WHERE tier = 'A'
ORDER BY clob_usdc_volume DESC
LIMIT 100
```

---

## Cohort Files

Generated files are stored in `tmp/`:

| File | Contents |
|------|----------|
| `trader_strict_tierA_YYYY_MM_DD.json` | Top 10K Tier A by volume |
| `trader_strict_tierB_YYYY_MM_DD.json` | Top 5K Tier B by volume |
| `trader_strict_excluded_YYYY_MM_DD.json` | Sample of 1K Excluded |

### File Format

```json
{
  "metadata": {
    "generated_at": "2025-12-09T...",
    "tier": "A",
    "description": "...",
    "criteria": { ... },
    "total_count": 10000
  },
  "wallets": [
    {
      "wallet_address": "0x...",
      "clob_event_count": 80055,
      "clob_usdc_volume": 101258258.20,
      "unresolved_pct": 0,
      "maker_share_pct": 90.54,
      "amm_event_count": 0,
      "split_count": 0,
      "merge_count": 0,
      "transfer_count": 1121,
      "mm_likelihood_flag": 0
    }
  ]
}
```

---

## Benchmark Results

### V12 Tier A Benchmark (500 wallets)

| Metric | Value |
|--------|-------|
| Total wallets | 500 |
| Computation success | 100% |
| Wallets >50% unresolved | ~3-5% (benchmark filter) |
| Median unresolved | ~5% |

**Note:** The benchmark's unresolved % calculation differs slightly from the classifier's due to source table differences (pm_condition_resolutions_norm vs pm_unified_ledger_v8_tbl.payout_norm).

---

## Data Sources

### Primary Tables

| Table | Use |
|-------|-----|
| `pm_unified_ledger_v8_tbl` | CLOB events, payout_norm |
| `pm_fpmm_trades` | AMM trades |
| `pm_erc1155_transfers` | External transfers |
| `pm_trader_events_v2` | Maker/taker breakdown |

### Resolution Data

| Table | Use |
|-------|-----|
| `pm_condition_resolutions_norm` | Market resolution prices |
| `pm_token_to_condition_map_v5` | Token to condition mapping |

---

## Integration Notes

### For Copy-Trading Leaderboards

1. **Source wallets from Tier A** for ranking
2. **Use V11/V12 formula** for realized PnL
3. **Exclude wallets with >50% unresolved** for fairness
4. **Refresh cohort weekly** to capture new wallets

### For Metrics API

```typescript
// Example: Get top traders
async function getTopTierATraders(limit: number) {
  const query = `
    SELECT wallet_address, clob_usdc_volume
    FROM trader_strict_classifier_v1
    WHERE tier = 'A'
    ORDER BY clob_usdc_volume DESC
    LIMIT ${limit}
  `;
  return await clickhouse.query(query);
}
```

---

## Future Improvements

1. **Tighten unresolved filter**: Consider 10% instead of 20%
2. **Add win rate metric**: Requires counting winning vs losing trades
3. **Add Sharpe ratio**: Requires daily PnL time series
4. **Create Tier A+**: Ultra-clean wallets (<5% unresolved)

---

## Appendix: MM Detection Heuristic

```sql
mm_likelihood_flag = IF(
  clob_event_count > 100000
  AND maker_share_pct > 70,
  1, 0
)
```

This flags wallets with:
- >100K CLOB events (high activity)
- >70% maker share (liquidity provision behavior)

---

## Product Rules (MANDATORY)

### ⚠️ Copy-Trading Metrics Gate

**These rules are mandatory for all copy-trading features:**

1. **Leaderboards, smart money signals, and copy-trade recommendations are Tier A-only.**
   - Only wallets from `tier = 'A'` may appear in rankings
   - Use `trader_strict_classifier_v1_tbl` as the source

2. **Tier B is research-only.**
   - May be used for internal analysis
   - Never shown to users as "recommended" traders
   - Requires disclaimer if displayed anywhere

3. **Tier X is excluded until new engines handle complex mechanics.**
   - No metrics computed
   - No visibility in any user-facing features
   - Future: specialized AMM/CTF engines may unlock some wallets

4. **Additional filters for comparable metrics:**
   - Exclude wallets with >50% unresolved events from live rankings
   - Use `unresolved_pct_benchmark_compatible` for accurate filtering
   - Refresh weekly to capture new resolutions

### Implementation Checklist

```typescript
// Before showing any wallet in copy-trading UI:
async function isEligibleForCopyTrading(wallet: string): Promise<boolean> {
  // Use the view (trader_strict_classifier_v1) or table (_tbl) if materialized
  const result = await clickhouse.query(`
    SELECT tier, unresolved_pct
    FROM trader_strict_classifier_v1
    WHERE wallet_address = {wallet:String}
  `);
  const row = result[0];
  return row?.tier === 'A' && row?.unresolved_pct < 50;
}

// For batch operations - get all eligible wallets:
async function getEligibleCopyTradingWallets(limit: number = 10000): Promise<string[]> {
  const result = await clickhouse.query(`
    SELECT wallet_address
    FROM trader_strict_classifier_v1
    WHERE tier = 'A' AND unresolved_pct < 50
    ORDER BY clob_usdc_volume DESC
    LIMIT {limit:UInt32}
  `);
  return result.map(r => r.wallet_address);
}
```

---

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/pnl/create-trader-strict-classifier.ts` | Create view + generate cohorts |
| `scripts/pnl/promote-trader-strict-classifier-v1.ts` | Promote to materialized table |
| `scripts/pnl/benchmark-v12-realized-large.ts` | Benchmark harness |
| `scripts/pnl/benchmark-v12-2000-wallets.ts` | 2000-wallet benchmark |
| `scripts/pnl/regression-check-gold-set.ts` | CI regression checks |
| `scripts/pnl/fetch-dome-realized-for-wallet-file.ts` | Fetch Dome truth |

---

## Regression Testing

### Gold Set

A pinned set of 100 Tier A wallets with <10% unresolved serves as the regression test baseline.

**File:** `tmp/gold_pinned_tierA_regression_v1_2025_12_09.json`

### CI Check

```bash
# Run before deploying engine changes
npx tsx scripts/pnl/regression-check-gold-set.ts --tolerance=5

# Exit code 0 = pass, 1 = failures detected
```

This recomputes V12 for all 100 gold wallets and asserts 5% tolerance vs stored expected values.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| v1 | 2025-12-09 | Initial release with view |
| v1.1 | 2025-12-09 | Materialized table with benchmark-compatible unresolved |
