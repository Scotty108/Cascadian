# Next Steps: Post-WIO Implementation Plan

> **Created:** 2026-01-13
> **Context:** WIO v1.0 implementation complete with all 5 phases

---

## Current State

### WIO Tables Created
| Table | Rows | Purpose |
|-------|------|---------|
| wio_topic_bundles | 20 | Topic categories |
| wio_market_bundle_map | 190K | Market → bundle mapping |
| wio_positions_v2 | 76.8M | Position-level data |
| wio_metric_observations_v1 | 4.5M | Wallet metrics by window |
| wio_wallet_classification_v1 | 2.5M | Wallet tier classification |
| wio_open_snapshots_v1 | 950K | Current open positions |
| wio_market_snapshots_v1 | 18K | Smart/dumb money per market |
| wio_wallet_scores_v1 | 1.5M | Credibility/bot/copyability |
| wio_dot_events_v1 | 2.7K | Smart money signals |

### Key Findings
- **783 superforecaster wallets** (credibility ≥ 0.5, non-bot)
- **17,134 smart money wallets** (credibility 0.3-0.5)
- **2,723 dot events** in last 7 days (signals to follow)

---

## Priority 1: API Endpoints (High Value, Medium Effort)

Expose WIO data via REST API for frontend and external consumption.

### 1.1 Wallet Profile Endpoint
```
GET /api/wallets/[address]/profile
```
Returns:
- Wallet metrics across all windows (ALL, 90d, 30d, etc.)
- Credibility, bot likelihood, copyability scores
- Tier classification
- Open positions summary

### 1.2 Market Smart Money Endpoint
```
GET /api/markets/[condition_id]/smart-money
```
Returns:
- Current crowd odds
- Smart money odds (divergence signal)
- Smart wallet count and holdings
- Dumb money comparison
- Recent dot events for this market

### 1.3 Leaderboard Endpoint
```
GET /api/wallets/leaderboard?window=90d&tier=superforecaster&limit=100
```
Returns:
- Top wallets by credibility score
- Filterable by tier, window, min positions
- PnL, win rate, ROI metrics

### 1.4 Dot Events Feed
```
GET /api/dots?since=2026-01-13&type=SUPERFORECASTER&limit=50
```
Returns:
- Recent smart money moves
- Wallet, market, side, size, confidence
- Market context (crowd odds, entry price)

---

## Priority 2: Real-Time Dot Emission (High Value, High Effort)

Emit dots in real-time as new fills come in from credible wallets.

### 2.1 Fill Ingestion Hook
- Add post-processing step to `update-canonical-fills` cron
- For each new fill, check if wallet qualifies for dot
- Insert into wio_dot_events_v1 if criteria met

### 2.2 Criteria for Dot Emission
```typescript
interface DotCriteria {
  minCredibility: 0.3;      // Wallet must have cred >= 0.3
  maxBotLikelihood: 0.5;    // Must not be bot-like
  minPositionUsd: 100;      // Minimum $100 position
  actions: ['ENTER', 'ADD', 'EXIT', 'FLIP'];
}
```

### 2.3 Notification Integration
- Discord webhook for high-confidence dots
- Real-time WebSocket feed for frontend

---

## Priority 3: CLV Anchor Prices (Medium Value, Medium Effort)

Add Closing Line Value (CLV) for measuring edge vs market.

### 3.1 Price History Table
Create `wio_market_price_history` with hourly prices:
- Backfill from existing trade data (last trade per hour)
- Forward capture via hourly cron

### 3.2 Anchor Price Capture
For each position, capture market price at:
- ts_open + 4 hours
- ts_open + 24 hours
- ts_open + 72 hours

### 3.3 CLV Computation
```sql
clv_24h = p_anchor_24h - p_entry
-- Positive CLV = entered before market moved in your favor
```

Update wio_metric_observations_v1 with CLV metrics:
- clv_4h_cost_weighted
- clv_24h_cost_weighted
- clv_72h_cost_weighted
- clv_24h_win_rate

---

## Priority 4: Frontend Integration (High Value, High Effort)

Display WIO data in the Cascadian dashboard.

### 4.1 Wallet Profile Page
- Full metrics display across windows
- Score breakdown (credibility components)
- Position history and PnL chart
- Tier badge and style tags

### 4.2 Market Smart Money Widget
- Show smart vs crowd divergence
- List recent superforecaster moves
- Confidence indicator

### 4.3 Leaderboard Page
- Filterable table of top wallets
- Sort by credibility, PnL, win rate
- Click through to wallet profile

### 4.4 Dot Events Feed
- Real-time feed of smart money moves
- Filter by type, market, wallet
- Alert subscription

---

## Priority 5: Cron Maintenance Jobs (Medium Value, Low Effort)

Schedule WIO data refresh.

### 5.1 Hourly Jobs
- `populate-wio-snapshots.ts` → Update open positions and market snapshots

### 5.2 Daily Jobs (3 AM UTC)
- `compute-wio-metrics-v1.ts` → Recompute all metrics
- `compute-wio-scores.ts` → Recompute scores and dots

### 5.3 Weekly Jobs
- `rebuild-wio-positions-v2.ts` → Full position rebuild (only if needed)

---

## Priority 6: Additional Scores (Low Priority)

### 6.1 InsiderLikelihood Score
Requires bundle-level metrics (compute metrics at BUNDLE scope).
Signals:
- Long-horizon CLV dominance
- Topic concentration
- Anomalous sizing
- New wallet with immediate success

### 6.2 Calibration Scoring
Requires crowd_odds at entry time:
- brier_vs_crowd = brier_score - crowd_brier_score
- calibration_gap = binned prediction vs actual outcome

---

## Recommended Order of Implementation

| # | Task | Effort | Value | Dependency |
|---|------|--------|-------|------------|
| 1 | Wallet Profile API | 2h | High | None |
| 2 | Market Smart Money API | 2h | High | None |
| 3 | Leaderboard API | 1h | High | None |
| 4 | Dot Events API | 1h | High | None |
| 5 | Hourly Snapshot Cron | 30m | Medium | None |
| 6 | Daily Metrics Cron | 30m | Medium | None |
| 7 | Frontend Wallet Profile | 4h | High | API #1 |
| 8 | Frontend Market Widget | 3h | High | API #2 |
| 9 | Real-Time Dot Emission | 4h | High | API #4 |
| 10 | CLV Price History | 3h | Medium | None |
| 11 | CLV Anchor Capture | 2h | Medium | #10 |

---

## Quick Wins (Can Do Now)

1. **Push WIO commit to remote** - Share the implementation
2. **Add snapshot cron to vercel.json** - Automate hourly updates
3. **Create simple API route** - `/api/wallets/[address]` returning basic profile

---

## Files to Reference

| File | Purpose |
|------|---------|
| `scripts/rebuild-wio-positions-v2.ts` | Position rebuild logic |
| `scripts/compute-wio-metrics-v1.ts` | Metrics computation |
| `scripts/populate-wio-snapshots.ts` | Snapshot population |
| `scripts/compute-wio-scores.ts` | Score computation |
| `docs/plans/WALLET_INTELLIGENCE_ONTOLOGY_IMPLEMENTATION.md` | Full WIO spec |
