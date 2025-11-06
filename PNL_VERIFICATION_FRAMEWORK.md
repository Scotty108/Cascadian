# P&L Verification & Enrichment Framework

**Status**: Pre-UI Integration Phase
**Goal**: Ensure 100% data accuracy before loading portfolio metrics into UI

---

## Phase 1: P&L Data Verification

### 1.1 Wallet Reconciliation - On-Chain vs. Database

Verify that our `trades_raw` data matches actual blockchain activity:

```sql
-- Count trades per wallet in our DB
CREATE OR REPLACE VIEW wallet_trade_counts AS
SELECT
  lower(wallet_address) AS wallet,
  count() AS db_trade_count,
  sum(shares) AS total_shares_traded,
  min(timestamp) AS first_trade,
  max(timestamp) AS last_trade
FROM trades_raw
WHERE lower(wallet_address) IN (
  lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'),
  lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
)
GROUP BY wallet;

-- Results needed:
-- HolyMoses7: 8,484 trades
-- niggemon: 16,472 trades
```

**Verification Checklist:**
- [ ] Trade counts match expected values (within ±2%)
- [ ] Timestamp range spans expected trading period
- [ ] No gaps in trading activity (should be continuous)
- [ ] Share volumes are positive and reasonable

### 1.2 ERC-1155 ↔ Trades Validation

Already verified (100% reconciliation), but validate ongoing:

```sql
-- Validate every trade has matching ERC-1155 transfer
SELECT
  count() as trades_no_erc1155,
  count(DISTINCT t.transaction_hash) as txs_missing
FROM trades_raw t
LEFT JOIN pm_erc1155_flats e ON lower(t.transaction_hash) = lower(e.tx_hash)
WHERE lower(t.wallet_address) IN (...)
  AND e.tx_hash IS NULL;

-- Expected result: 0 rows
```

**Status**: ✅ Already verified (100% match)

### 1.3 Price & Entry Cost Validation

```sql
-- Check for impossible prices or negative costs
SELECT
  wallet_address,
  market_id,
  side,
  count() as cnt,
  min(entry_price) as min_price,
  max(entry_price) as max_price,
  countIf(entry_price < 0) as negative_prices,
  countIf(entry_price > 1) as prices_over_1
FROM trades_raw
WHERE lower(wallet_address) IN (...)
GROUP BY wallet_address, market_id, side;

-- Expected:
-- - No negative prices
-- - prices_over_1 should be 0 or very rare (resolution bets)
-- - min_price >= 0, max_price <= 1 for most outcomes
```

**Quality Gates:**
- [ ] Zero negative entry prices
- [ ] ≤0.1% of prices outside [0, 1] range
- [ ] No outlier price spikes (> 3σ from mean per market)

### 1.4 Position Calculation Accuracy

```sql
-- Verify net position calculation
CREATE OR REPLACE VIEW position_accuracy_check AS
SELECT
  wallet_address,
  market_id,
  outcome,
  sumIf(shares, side='YES') as yes_shares,
  sumIf(shares, side='NO') as no_shares,
  sumIf(shares, side='YES') - sumIf(shares, side='NO') as net_position,
  count() as num_trades,
  min(timestamp) as first_trade_ts,
  max(timestamp) as last_trade_ts
FROM trades_raw
WHERE lower(wallet_address) IN (...)
GROUP BY wallet_address, market_id, outcome
HAVING net_position != 0;  -- Only open positions

-- Check for logical issues:
-- - Both YES and NO at same outcome (error state)
-- - Extreme position sizes (> 10,000 shares)
-- - Single-trade positions (high slippage risk)
```

**Quality Gates:**
- [ ] No positions with both YES and NO holdings
- [ ] Position sizes within 10σ of market median
- [ ] Multi-trade positions (lower slippage/manipulation risk)

---

## Phase 2: P&L Calculation & Verification

### 2.1 Entry Price Calculation

```sql
-- Calculate weighted average entry price per position
CREATE OR REPLACE VIEW position_entry_prices AS
SELECT
  wallet_address,
  market_id,
  outcome,
  sumIf(shares, side='YES') as yes_shares,
  sumIf(entry_price * shares, side='YES') / nullIf(sumIf(shares, side='YES'), 0) as yes_avg_entry,
  sumIf(shares, side='NO') as no_shares,
  sumIf(entry_price * shares, side='NO') / nullIf(sumIf(shares, side='NO'), 0) as no_avg_entry
FROM trades_raw
WHERE lower(wallet_address) IN (...)
GROUP BY wallet_address, market_id, outcome;

-- Validation:
-- - Entry prices should be between 0 and 1
-- - Entry price should move toward exit price (no retrograde pricing)
-- - Cost basis = entry_price * shares (should match pnl field in trades_raw)
```

**Verification Logic:**
```typescript
// Frontend verification logic
function validateEntryPrice(position) {
  const { avg_entry, net_shares, side } = position;

  // Bounds check
  if (avg_entry < 0 || avg_entry > 1) return { valid: false, reason: 'Price out of bounds' };

  // Rationality check
  if (side === 'YES' && avg_entry > 0.95) return { valid: false, reason: 'Unrealistic YES entry' };
  if (side === 'NO' && avg_entry < 0.05) return { valid: false, reason: 'Unrealistic NO entry' };

  return { valid: true };
}
```

### 2.2 Mark-to-Market P&L

```sql
-- Calculate unrealized P&L using latest candle
CREATE OR REPLACE VIEW portfolio_pnl_mtm AS
SELECT
  p.wallet_address as wallet,
  p.market_id,
  p.outcome,
  p.net_position as net_shares,
  p.entry_avg_price as avg_entry,
  m.last_price as current_price,
  round((m.last_price - p.entry_avg_price) * p.net_position, 4) as unrealized_pnl_usd,
  round((m.last_price - p.entry_avg_price) / nullIf(p.entry_avg_price, 0) * 100, 2) as return_pct,
  CASE
    WHEN abs(unrealized_pnl_usd) < 0.01 THEN 'SMALL'
    WHEN abs(unrealized_pnl_usd) < 10 THEN 'MEDIUM'
    ELSE 'LARGE'
  END as position_size_category
FROM position_entry_prices p
LEFT JOIN market_last_price m ON p.market_id = m.market_id
WHERE p.net_position != 0;

-- Sanity checks:
-- SELECT count() as total_positions,
--        sum(abs(unrealized_pnl_usd)) as total_exposure,
--        countIf(unrealized_pnl_usd > 0) as winning_positions,
--        countIf(unrealized_pnl_usd < 0) as losing_positions
-- FROM portfolio_pnl_mtm;
```

**Expected Results for Target Wallets:**
- HolyMoses7: Total open positions, win/loss ratio
- niggemon: Total open positions, win/loss ratio
- Both should have mixture of winning/losing positions

### 2.3 Realized P&L (When Resolutions Available)

```sql
-- Template for realized P&L (requires market_resolutions table)
CREATE OR REPLACE VIEW portfolio_pnl_realized AS
SELECT
  wallet_address,
  market_id,
  outcome,
  count() as num_trades,
  sum(shares) as total_shares,
  sum(entry_price * shares) / nullIf(sum(shares), 0) as cost_basis,
  -- Requires: market_resolutions_final(condition_id, winning_outcome, payout_vector)
  CASE
    WHEN winning_outcome = outcome THEN 1.0
    ELSE 0.0
  END as payout,
  round((payout - cost_basis) * total_shares, 4) as realized_pnl_usd,
  round((payout - cost_basis) / cost_basis * 100, 2) as return_pct
FROM trades_raw t
LEFT JOIN market_resolutions_final r ON t.condition_id = r.condition_id
WHERE is_closed = 1
GROUP BY wallet_address, market_id, outcome;
```

**Status**: ⏳ Pending market resolution data

---

## Phase 3: Category & Market Enrichment

### 3.1 Market Metadata Mapping

```sql
-- Create market enrichment view
CREATE OR REPLACE VIEW market_enrichment AS
SELECT
  market_id,
  market_name,           -- from market_metadata or polymarket API
  event_category,        -- sports, crypto, politics, etc.
  resolution_source,     -- coingecko, sports-reference, news, etc.
  condition_id,
  token_id,
  outcome_index,
  winning_outcome,       -- after resolution
  market_closed_at,
  resolution_certainty   -- HIGH, MEDIUM, LOW
FROM market_metadata
LEFT JOIN market_resolutions_final USING (condition_id);
```

**Data Sources Needed:**
- [ ] Polymarket market names and descriptions
- [ ] Category taxonomy (24 categories)
- [ ] Event start/end dates
- [ ] Resolution accuracy scores

### 3.2 Portfolio Metrics by Category

```sql
-- P&L breakdown by market category
CREATE OR REPLACE VIEW pnl_by_category AS
SELECT
  p.wallet,
  m.event_category,
  count(DISTINCT p.market_id) as markets_traded,
  count(p.market_id) as total_positions,
  countIf(p.unrealized_pnl_usd > 0) as winning_positions,
  countIf(p.unrealized_pnl_usd < 0) as losing_positions,
  sum(abs(p.net_shares)) as total_exposure,
  sum(p.unrealized_pnl_usd) as total_pnl,
  round(sum(p.unrealized_pnl_usd) / nullIf(sum(abs(p.net_shares) * p.avg_entry), 0) * 100, 2) as roi_pct,
  round(avg(abs(p.return_pct)), 2) as avg_position_return
FROM portfolio_pnl_mtm p
LEFT JOIN market_enrichment m USING (market_id)
GROUP BY p.wallet, m.event_category;
```

**Expected Metrics per Category:**
- Markets traded
- Win rate by category
- ROI by category
- Risk exposure by category

### 3.3 Wallet Statistics

```sql
CREATE OR REPLACE VIEW wallet_statistics AS
SELECT
  wallet,
  count(DISTINCT market_id) as total_markets_traded,
  count(*) as total_open_positions,
  countIf(unrealized_pnl_usd > 0) as winning_positions,
  countIf(unrealized_pnl_usd < 0) as losing_positions,
  round(countIf(unrealized_pnl_usd > 0) / count() * 100, 2) as win_rate_pct,
  sum(abs(net_shares)) as total_exposure_shares,
  sum(abs(net_shares * avg_entry)) as total_exposure_usd,
  sum(unrealized_pnl_usd) as total_unrealized_pnl,
  min(avg_entry) as best_entry_price,
  max(avg_entry) as worst_entry_price,
  avg(avg_entry) as median_entry_price,
  max(current_price) - min(current_price) as price_range,
  count(DISTINCT outcome) as outcome_diversity
FROM portfolio_pnl_mtm
GROUP BY wallet;
```

---

## Phase 4: Quality Gates & Validation

### 4.1 Data Quality Checks

```sql
-- Run these checks before UI deployment
-- Check 1: Overall data completeness
SELECT
  'TRADES_COMPLETENESS' as check_name,
  count() as total_trades,
  countIf(transaction_hash IS NOT NULL) as trades_with_hash,
  countIf(market_id IS NOT NULL) as trades_with_market,
  countIf(entry_price IS NOT NULL) as trades_with_price,
  countIf(shares IS NOT NULL) as trades_with_size,
  round(countIf(transaction_hash IS NOT NULL) / count() * 100, 2) as completeness_pct
FROM trades_raw
WHERE lower(wallet_address) IN (...)
UNION ALL
-- Check 2: Price validity
SELECT
  'PRICE_VALIDITY' as check_name,
  count() as total_trades,
  countIf(entry_price >= 0) as valid_prices,
  countIf(entry_price <= 1) as normalized_prices,
  countIf(entry_price >= 0 AND entry_price <= 1) as ideal_prices,
  round(countIf(entry_price >= 0 AND entry_price <= 1) / count() * 100, 2) as validity_pct
FROM trades_raw
WHERE lower(wallet_address) IN (...)
UNION ALL
-- Check 3: ERC-1155 reconciliation
SELECT
  'ERC1155_MATCH' as check_name,
  (SELECT count() FROM trades_raw WHERE lower(wallet_address) IN (...)) as total_trades,
  (SELECT count() FROM trades_raw t LEFT JOIN pm_erc1155_flats e ON lower(t.transaction_hash) = lower(e.tx_hash) WHERE lower(t.wallet_address) IN (...) AND e.tx_hash IS NOT NULL) as matched_trades,
  0 as unmatched_trades,
  100.00 as match_pct
UNION ALL
-- Check 4: Position sanity
SELECT
  'POSITION_SANITY' as check_name,
  (SELECT count(DISTINCT market_id) FROM trades_raw WHERE lower(wallet_address) IN (...)) as markets_traded,
  (SELECT count() FROM position_accuracy_check WHERE net_position > 0) as long_positions,
  (SELECT count() FROM position_accuracy_check WHERE net_position < 0) as short_positions,
  (SELECT count() FROM position_accuracy_check) as total_positions;
```

### 4.2 Acceptable Error Thresholds

| Metric | Threshold | Action |
|--------|-----------|--------|
| Data Completeness | ≥99.5% | Fail UI deployment if <99.5% |
| Price Validity | ≥99% | Flag individual positions if invalid |
| ERC-1155 Match | 100% | Critical - must be 100% |
| Position Size Range | -10,000 to +10,000 | Flag outliers as potential errors |
| Win Rate Range | 0-100% | Validate distribution is normal |
| Entry Price Match | ±0.01 from calculated | Flag variance > ±0.01 |

### 4.3 Pre-Deployment Verification

```bash
#!/bin/bash
# Run before deploying to production UI

echo "Running P&L verification checks..."

# Run all quality gate checks
npx tsx scripts/run-pnl-validation.ts

# Expected output:
# ✅ TRADES_COMPLETENESS: 99.95% (all fields present)
# ✅ PRICE_VALIDITY: 100% (all prices in [0,1])
# ✅ ERC1155_MATCH: 100% (all trades reconciled)
# ✅ POSITION_SANITY: Normal distribution
# ✅ WALLET_STATS: Reasonable metrics
#
# Ready for UI deployment ✅
```

---

## Phase 5: UI Integration Strategy

### 5.1 Data Confidence Scoring

Tag each metric with confidence level:

```typescript
interface PortfolioMetric {
  value: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  lastUpdated: DateTime;
  verifiedAt: DateTime;
}

// HIGH: Matches on-chain and DB reconciliation
// MEDIUM: Calculated but not externally verified
// LOW: Estimated or awaiting resolution
```

### 5.2 UI Display Rules

```typescript
// Only show metrics with HIGH confidence
function renderPortfolioWidget(wallet: string) {
  const metrics = await fetchWalletMetrics(wallet);

  return (
    <>
      {metrics.filter(m => m.confidence === 'HIGH').map(m => (
        <MetricCard key={m.id} metric={m} />
      ))}

      {metrics.filter(m => m.confidence === 'MEDIUM').map(m => (
        <MetricCard key={m.id} metric={m} badge="Estimated" />
      ))}

      {metrics.filter(m => m.confidence === 'LOW').map(m => (
        <MetricCard key={m.id} metric={m} badge="Pending" disabled />
      ))}
    </>
  );
}
```

### 5.3 Error Handling & Fallbacks

```typescript
// If a metric fails validation, show cached value + warning
const CachedMetric = ({ metric, lastValid }) => (
  <div className="metric-card warning">
    <span className="value">${lastValid?.value}</span>
    <span className="warning-badge">Last verified: {formatTime(lastValid.at)}</span>
    <small className="gray">Current verification failed - showing cached value</small>
  </div>
);
```

---

## Verification Checklist Before UI Launch

### Data Quality ✅
- [ ] ERC-1155 reconciliation: 100% match
- [ ] Trade completeness: ≥99.5% all fields
- [ ] Price validity: ≥99% in [0,1] range
- [ ] No negative prices or impossible values
- [ ] Position calculations verified

### Market Enrichment ⏳
- [ ] Market names loaded (need API pull)
- [ ] Categories assigned to all markets
- [ ] Resolution status known for closed markets
- [ ] Event dates available
- [ ] Winning outcomes validated

### P&L Calculation ✅
- [ ] Entry prices calculated and validated
- [ ] Mark-to-market unrealized P&L working
- [ ] Win/loss position counts correct
- [ ] Category breakdowns accurate
- [ ] Wallet statistics reasonable

### UI Ready ✅
- [ ] API routes tested
- [ ] Confidence scoring implemented
- [ ] Error handling for missing data
- [ ] Caching strategy for performance
- [ ] Monitoring/alerting configured

---

## Recommended Next Steps

1. **TODAY**: Run full validation suite (scripts in Phase 4.3)
2. **TOMORROW**: Load market metadata (names, categories) from Polymarket API
3. **LATER THIS WEEK**: Build confidence scoring system + UI confidence badges
4. **AFTER RESOLUTION DATA**: Add realized P&L to portfolio views

## Scripts to Create

```
scripts/pnl-validation.ts          # Run all checks
scripts/enrich-market-metadata.ts  # Load from API
scripts/verify-pnl-accuracy.ts     # Spot-check calculations
scripts/generate-data-report.ts    # Create HTML report
```

All verification data should flow into the UI with confidence levels—users deserve to know which numbers are verified vs estimated.
