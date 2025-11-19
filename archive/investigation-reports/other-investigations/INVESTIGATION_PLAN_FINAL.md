# Final Investigation Plan - Getting to Ground Truth

**Date**: 2025-11-12
**Status**: Ready to Execute
**Based on**: Codex's investigative framework + Claude's findings

---

## Executive Summary

We have a $52K P&L gap ($34,990 vs $87,030 Dome baseline) that isn't explained by:
- Missing CLOB data ✅ (CLOB is most complete)
- System wallets ✅ (proxy already resolved)
- Duplicate resolutions ⚠️ (helps but not enough)
- Missing markets ✅ (2 markets have $0 impact)

**Root cause**: Resolution + realized P&L logic has issues with:
1. Outcome label normalization (hard-coded binary vs actual labels)
2. Multi-outcome market handling (>2 outcomes)
3. Fee treatment differences
4. Resolution quality (missing or wrong outcomes)

---

## Phase 1: Stabilize Current State (30 min)

### 1.1 Snapshot Baseline
```bash
# Save current state for 3 benchmark wallets
npx tsx scripts/snapshot-current-pnl-baseline.ts
```

**Output**: `tmp/pnl-baseline-snapshot-{timestamp}.json`

**Wallets to snapshot**:
- `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b` (test wallet, $34,990)
- 2 additional high-volume wallets for validation

**Capture**:
- Current P&L total
- Market count
- Per-market breakdown
- View definition (DDL)

### 1.2 Verify Proxy Resolution
```sql
-- Confirm proxies are already resolved
SELECT
  count(*) as total_fills,
  count(DISTINCT proxy_wallet) as unique_proxies,
  count(DISTINCT user_eoa) as unique_eoas,
  countIf(proxy_wallet != user_eoa) as mismatches
FROM clob_fills;
```

**Expected**: mismatches = 0 (Codex confirmed this)

---

## Phase 2: Build Canonical Resolution Surfaces (1-2 hours)

### 2.1 Create gamma_resolved_latest View
```sql
CREATE OR REPLACE VIEW gamma_resolved_latest AS
SELECT
  cid,
  argMax(winning_outcome, fetched_at) AS winning_outcome,
  max(fetched_at) AS last_updated
FROM gamma_resolved
WHERE winning_outcome IS NOT NULL
  AND winning_outcome != ''
GROUP BY cid;
```

**Validation**:
- Should have 112,546 unique cids (no duplicates)
- All winning_outcome values should be non-null
- Compare count to original gamma_resolved

### 2.2 Normalize Outcome Labels

**Problem**: We hard-code `Yes/No/Up/Down` but actual labels vary

**Solution**: Create label normalization table
```sql
CREATE TABLE IF NOT EXISTS outcome_label_map (
  raw_label String,
  normalized_label String,
  outcome_index UInt8
) ENGINE = ReplacingMergeTree()
ORDER BY raw_label;

-- Seed with known mappings
INSERT INTO outcome_label_map VALUES
  ('Yes', 'yes', 0),
  ('YES', 'yes', 0),
  ('yes', 'yes', 0),
  ('No', 'no', 1),
  ('NO', 'no', 1),
  ('no', 'no', 1),
  ('Up', 'yes', 0),
  ('Down', 'no', 1),
  ('Over', 'yes', 0),
  ('Under', 'no', 1);
```

### 2.3 Audit Unmapped Labels
```bash
npx tsx scripts/find-unmapped-outcome-labels.ts
```

**Goal**: Find all `winning_outcome` values in `gamma_resolved` that don't map to our binary system

**Output**: List of labels like "Trump", "Celtics", "Underdog", etc.

---

## Phase 3: Reconstruct Realized P&L (2-3 hours)

### 3.1 Build Enhanced Cashflows View
```sql
CREATE OR REPLACE VIEW trade_cashflows_enhanced AS
WITH clob_aggregated AS (
  SELECT
    lower(cf.proxy_wallet) AS wallet,
    lower(replaceAll(cf.condition_id, '0x', '')) AS condition_id_norm,
    cf.asset_id,
    ctm.outcome_index AS outcome_idx,
    sum(if(cf.side = 'BUY', -1, 1) * cf.price * cf.size / 1000000.0) AS cashflow,
    sum(if(cf.side = 'BUY', 1, -1) * cf.size / 1000000.0) AS net_shares,
    sum(cf.size * cf.fee_rate_bps / 10000000.0) AS total_fees  -- Include fees
  FROM clob_fills cf
  INNER JOIN ctf_token_map ctm ON cf.asset_id = ctm.token_id
  GROUP BY wallet, condition_id_norm, asset_id, outcome_idx
)
SELECT
  ca.*,
  ctl.outcome_label  -- Get actual outcome label from token
FROM clob_aggregated ca
LEFT JOIN ctf_token_labels ctl ON ca.asset_id = ctl.token_id;
```

### 3.2 Rebuild P&L with Label Matching
```sql
CREATE OR REPLACE VIEW realized_pnl_by_market_v2 AS
SELECT
  tc.wallet,
  tc.condition_id_norm,
  tc.outcome_idx,
  tc.outcome_label,
  tc.net_shares,
  tc.cashflow,
  tc.total_fees,
  gr.winning_outcome,
  -- Use label equality instead of hard-coded binary
  if(
    lower(trim(tc.outcome_label)) = lower(trim(gr.winning_outcome)),
    1,
    0
  ) AS is_winning_outcome,
  -- Calculate realized P&L
  tc.cashflow + if(
    lower(trim(tc.outcome_label)) = lower(trim(gr.winning_outcome)),
    tc.net_shares,
    0
  ) - tc.total_fees AS realized_pnl_usd
FROM trade_cashflows_enhanced tc
INNER JOIN gamma_resolved_latest gr
  ON tc.condition_id_norm = gr.cid
WHERE gr.winning_outcome IS NOT NULL;
```

### 3.3 Validate Reconstruction
```bash
npx tsx scripts/validate-pnl-reconstruction.ts
```

**Checks**:
- All 45 markets appear for test wallet
- Total P&L makes sense (>$0, <$200K)
- No NULL winning_outcome values
- Fee deductions are reasonable

---

## Phase 4: Close Coverage Gap (1 hour)

### 4.1 Find Missing Markets
```sql
-- Markets in CLOB but not in P&L view
SELECT
  lower(replaceAll(cf.condition_id, '0x', '')) as condition_id_norm,
  count(*) as fill_count,
  sum(cf.size / 1000000.0) as total_shares
FROM clob_fills cf
WHERE lower(cf.proxy_wallet) = lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b')
  AND lower(replaceAll(cf.condition_id, '0x', '')) NOT IN (
    SELECT DISTINCT condition_id_norm
    FROM realized_pnl_by_market_v2
    WHERE lower(wallet) = lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b')
  )
GROUP BY condition_id_norm;
```

### 4.2 Diagnose Why Markets Drop
For each missing market:
1. Check if it exists in `gamma_resolved_latest`
2. Check if outcome labels match between `ctf_token_labels` and `gamma_resolved`
3. Check if cashflows exist in `trade_cashflows_enhanced`

### 4.3 Fix Missing Resolutions
```bash
# Backfill missing resolution data from Polymarket API
npx tsx scripts/backfill-missing-resolutions.ts --markets <list>
```

---

## Phase 5: Reconcile with Dome (Critical!)

### 5.1 Get Dome API Breakdown
```bash
# Fetch actual Dome response for test wallet
curl "https://clob.polymarket.com/pnl?wallet=0xcce2b7c71f21e358b8e5e797e586cbc03160d58b" \
  > tmp/dome-api-response.json
```

**Parse response** to get:
- Per-market P&L
- Total realized P&L
- Time window
- Any filters applied

### 5.2 Market-by-Market Comparison
```bash
npx tsx scripts/compare-dome-market-by-market.ts
```

**Output table**:
```
| Market (condition_id) | Dome P&L | Our P&L | Diff | Notes |
|-----------------------|----------|---------|------|-------|
| abc123...             | $1,234   | $1,200  | -$34 | Fee? |
| def456...             | $5,678   | $0      | -$5K | Missing! |
```

### 5.3 Identify Discrepancy Patterns
- **Missing markets**: Markets Dome has but we don't
- **Wrong outcomes**: Different winning_outcome values
- **Fee differences**: Dome includes/excludes fees differently
- **Rounding**: Price precision differences

---

## Phase 6: Regression & Safety Net (1 hour)

### 6.1 Create Verification Script
```bash
npx tsx scripts/verify-pnl-correctness.ts
```

**Tests**:
1. ✅ Proxy vs EOA equality (should be 0 mismatches)
2. ✅ gamma_resolved_latest has no duplicates
3. ✅ All 45 markets appear for test wallet
4. ✅ Variance vs Dome <2% (after fixes)
5. ✅ No NULL winning_outcomes in final view
6. ✅ Total fees are reasonable (<5% of cashflow)

### 6.2 Add to CI Pipeline
```yaml
# .github/workflows/verify-pnl.yml
name: Verify P&L Calculation
on: [push]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - run: npx tsx scripts/verify-pnl-correctness.ts
```

---

## Expected Outcomes

### After Phase 2 (Resolution Surfaces)
- gamma_resolved deduplicated: 112,546 unique markets
- All outcome labels normalized
- Clear mapping from labels to indices

### After Phase 3 (P&L Reconstruction)
- New view with proper label matching
- Fees included in calculation
- Multi-outcome markets handled correctly
- **Expected P&L**: $60K-$90K (closer to Dome)

### After Phase 4 (Coverage Gap)
- All 45 markets appear in final view
- No markets dropped due to resolution issues
- **Expected P&L**: $75K-$90K

### After Phase 5 (Dome Reconciliation)
- Market-by-market comparison shows <2% variance
- Remaining differences explained (fees, rounding, timing)
- **Final P&L**: $85K-$87K (within 2% of Dome)

---

## Risk Mitigation

### If P&L Goes DOWN
- Revert to snapshot
- Review fee calculation (might be double-counting)
- Check for label mismatch (winning shares not credited)

### If P&L Still Doesn't Match Dome
- Get Dome's exact methodology documentation
- Contact Dome support for breakdown
- Consider that Dome might be wrong (verify with blockchain)

### If Markets Disappear
- Check gamma_resolved_latest for those markets
- Verify outcome labels match exactly
- Backfill missing resolution data

---

## Timeline

- **Phase 1**: 30 minutes (snapshot current state)
- **Phase 2**: 1-2 hours (build resolution surfaces)
- **Phase 3**: 2-3 hours (reconstruct P&L)
- **Phase 4**: 1 hour (close coverage gap)
- **Phase 5**: 2-3 hours (Dome reconciliation)
- **Phase 6**: 1 hour (regression tests)

**Total**: 7-10 hours for complete resolution

---

## Success Criteria

1. ✅ All 45 markets appear in final P&L view
2. ✅ No duplicates in gamma_resolved
3. ✅ Outcome labels properly normalized
4. ✅ Multi-outcome markets handled correctly
5. ✅ Fees included in calculation
6. ✅ P&L within 2% of Dome baseline
7. ✅ Market-by-market comparison available
8. ✅ Regression tests passing

---

**Next Step**: Start with Phase 1 - snapshot current state and verify proxy resolution.

Then proceed systematically through each phase.

---

**Terminal**: Claude 1 (PST)
**Plan Author**: Codex + Claude
**Ready to Execute**: Yes
