# Critical Technical Decisions for Future Implementation

**Purpose:** Document major architectural decisions that must be carefully designed before implementation.

**Status:** Planning Phase - DO NOT IMPLEMENT YET
**Date:** 2025-10-20

---

## 1. Database Architecture: ClickHouse + Supabase Strategy

### Context
CASCADIAN will handle massive data volumes:
- Real-time trade ingestion (1000s/minute)
- Historical price data (1-minute OHLC for 1000+ markets)
- Wallet scoring computations (10k+ wallets)
- Signal generation with 30-second freshness

### Decision Points

#### Option A: Hot/Warm/Cold Tier (RECOMMENDED)
```
Supabase (PostgreSQL)
├─ Hot Data (Last 7 days)
│  ├─ markets (current state)
│  ├─ aggregated_signals (latest only)
│  └─ wallet_scores_daily (recent)
│
S3/R2 (Parquet)
├─ Warm Data (7-90 days)
│  ├─ trades (compressed)
│  └─ prices_1m (compressed)
│
ClickHouse
└─ Cold Data (90+ days)
   ├─ trades (columnar, compressed)
   ├─ prices_1m (analytical queries)
   └─ wallet_performance_history
```

**Rationale:**
- Supabase handles real-time reads/writes (low latency)
- S3/R2 cheap storage for mid-term data
- ClickHouse excels at analytical queries on historical data

#### Option B: Dual-Write (AVOID)
```
Write to both Supabase + ClickHouse simultaneously
```
**Issues:** Consistency problems, double write overhead, complex rollback

### Key Learnings from Old System

**What Worked:**
- Materialized views for leaderboard performance (<100ms queries)
- In-memory LRU cache for hot API endpoints
- Composite indexes on (wallet_address, timestamp)

**What Failed:**
- No data retention policy (tables grew unbounded)
- REFRESH MATERIALIZED VIEW blocked queries for 30 seconds
- No backfill mechanism for missing data gaps
- Cron jobs overlapped causing connection pool exhaustion

### Implementation Checklist (Future)
- [ ] Design data retention policy (hot: 7d, warm: 90d, cold: forever)
- [ ] Build ETL pipeline: Supabase → S3 → ClickHouse
- [ ] Implement incremental materialized view refresh
- [ ] Add distributed locks for cron jobs (Redis/Supabase)
- [ ] Design backfill mechanism for data gaps
- [ ] Load test write throughput (target: 10k trades/min)
- [ ] Validate query performance on 1-year historical data

---

## 2. Wallet Strategy: HD Derivation vs ERC-4337

### Context
Users will run multiple strategies simultaneously. Each strategy needs isolated tracking for performance attribution.

### Option A: HD Wallet Derivation (One Seed, Multiple Children)

```
Master Seed (User)
├─ m/44'/60'/0'/0/0  (Strategy 1 Wallet)
├─ m/44'/60'/0'/0/1  (Strategy 2 Wallet)
├─ m/44'/60'/0'/0/2  (Strategy 3 Wallet)
└─ m/44'/60'/0'/0/n  (Strategy N Wallet)
```

**Pros:**
- Simple performance attribution (1 address = 1 strategy)
- Standard HD derivation (BIP-44)
- Easy to export/import (single seed phrase)
- No gas overhead

**Cons:**
- User must approve each transaction per strategy
- No per-strategy position limits enforced on-chain
- Requires managing multiple private keys
- Cannot enforce stop-loss on-chain

### Option B: ERC-4337 Smart Wallet + Session Keys

```
User's Smart Wallet (ERC-4337)
├─ Strategy 1 Session Key (24h expiry, $1000 cap)
├─ Strategy 2 Session Key (24h expiry, $500 cap)
└─ Strategy 3 Session Key (7d expiry, $5000 cap)
```

**Pros:**
- On-chain enforcement of per-strategy caps
- Session keys enable gasless transactions (paymaster)
- Can revoke strategy access instantly
- Advanced features: stop-loss, profit targets on-chain
- Better UX: approve once, strategy runs autonomously

**Cons:**
- Requires smart contract deployment ($20-50 gas)
- Not all exchanges support ERC-4337 yet
- More complex architecture
- Paymaster infrastructure needed

### Key Learnings from Old System

**What the Old System Did:**
- No per-strategy wallets (tracked in database only)
- All paper trading (no real blockchain transactions)
- Performance attribution via `strategy_id` foreign key

**What CASCADIAN Needs:**
- Real on-chain trading (not just paper)
- Per-strategy risk management
- Provable performance (on-chain history)

### Recommended Hybrid Approach

**Phase 1 (MVP):** HD Derivation
- Simpler to implement
- Works with all Polymarket integrations
- Database tracks which address = which strategy

**Phase 2 (Advanced):** Migrate to ERC-4337
- Deploy smart wallet for power users
- Session keys for automated strategies
- Keep HD wallets for manual trading

### Implementation Checklist (Future)
- [ ] Research Polymarket's ERC-4337 support status
- [ ] Design session key permission structure
- [ ] Estimate gas costs for smart wallet deployment
- [ ] Build HD derivation utility (m/44'/60'/0'/0/n)
- [ ] Design migration path from HD → ERC-4337
- [ ] Security audit for key management

---

## 3. Old Repository Database Review (Use as Guide Only)

### Important Context
The old repository had working code but **messy implementation**. Use it to:
- Understand what worked (materialized views, caching)
- Avoid their mistakes (no retention policy, ignored TypeScript errors)
- Speed up by seeing their logic (WIS calculation, signal aggregation)

**DO NOT:**
- Copy schemas exactly (outdated for CASCADIAN)
- Use their normalization ranges (not validated)
- Replicate their cron job structure (had overlap issues)
- Ignore TypeScript errors like they did

**DO:**
- Reference their Bayesian signal aggregator logic
- Study their WIS calculation components (but recalibrate)
- Learn from their materialized view patterns
- Understand their PSP orchestration approach

### Key Takeaways from Implementation Manual

#### Database Design
- **Good:** Composite indexes on (market_id, timestamp)
- **Bad:** No unique constraints on transaction_hash (duplicate trades)
- **Good:** Materialized views for aggregated metrics
- **Bad:** Used regular REFRESH (blocks queries), should be CONCURRENTLY

#### Signal Generation
- **Good:** Parallel PSP execution reduces latency
- **Bad:** Hardcoded weights (40% PSP, 30% crowd, 20% momentum, 10% micro)
- **Good:** Bayesian fusion framework (math is sound)
- **Bad:** No learning/optimization of weights over time

#### Wallet Intelligence Scoring
- **Good:** Multi-factor approach (performance, reliability, volume, specialization)
- **Bad:** Normalization ranges arbitrary (ROI: -100% to +500%, not validated)
- **Good:** Composite score from 4 weighted components
- **Bad:** Specialization factor is 0 for 70% of wallets (wasted weight)

#### Cron Jobs
- **Good:** Simple cron-based ETL (easy to debug)
- **Bad:** No distributed locks (jobs overlapped)
- **Bad:** No checkpoint/resume (restart from 0 on failure)
- **Bad:** Batch size of 10 overwhelmed connection pool

### Reference Points for CASCADIAN

**WIS Calculation Logic:** `/src/services/wallet-etl/smart-score.ts` (lines 736-951)
- Study the 4 factor calculations
- Note their normalization functions (but recalibrate for our data)
- Understand component weighting

**Signal Aggregator:** `/src/services/signals/signal-aggregator.ts` (lines 545-591)
- Bayesian fusion math is solid
- Weight adjustment logic needs improvement
- Agreement score calculation is basic (could use correlation)

**PSP Orchestrator:** `/src/services/psp/orchestrator.ts` (lines 672-719)
- Parallel execution with timeout pattern
- Weighted voting approach
- Note: 5-second timeout was too aggressive

**Materialized Views:** Section 2 (lines 498-533)
- 90-day rolling window pattern
- UNIQUE INDEX required for CONCURRENTLY
- Refresh frequency: 15 minutes

### Implementation Checklist (Future)
- [ ] Extract WIS calculation logic (but recalibrate ranges)
- [ ] Port Bayesian aggregator math (but optimize weights)
- [ ] Study their caching strategy (LRU cache patterns)
- [ ] Review their API endpoint structure (learn from mistakes)
- [ ] Avoid their mistakes (TypeScript errors ignored, no backfills)

---

## Additional Considerations

### UI/UX Items (To Be Done Next)

**Branding Updates:**
- [ ] Replace "Bot" logo with "CASCADIAN" logo
- [ ] Remove crypto price tickers (BTC/USD, ETH/USD) from header
- [ ] Update color scheme to match CASCADIAN branding

**Event Grouping:**
- [ ] Design collapsible market groups in screener
- [ ] Group markets by event_slug (e.g., "US Election 2024")
- [ ] Show event metadata (category, close date)

**API Connection Indicators:**
- [ ] Add Polymarket API status indicator in header
- [ ] Show last data sync timestamp
- [ ] Display connection health (green/yellow/red)

**Discovery Hub Polish:**
- [ ] Ensure consistent spacing and typography
- [ ] Add loading states for all charts
- [ ] Error boundaries for each component
- [ ] Responsive design for mobile

---

## Summary

These three technical decisions are **critical infrastructure** that must be carefully designed before implementation:

1. **Database Strategy** - Affects scalability, cost, query performance
2. **Wallet Architecture** - Affects UX, security, on-chain capabilities
3. **Old System Review** - Speeds up development, avoids known pitfalls

**Status:** Documented and saved for later. Focus now on UI/UX improvements to make the application look functional and polished.

**Next Session Agenda:**
1. Complete UI branding updates
2. Implement event grouping in Market Screener
3. Add API connection indicators
4. Polish Discovery Hub styling
5. Then return to these technical decisions for implementation

---

**Last Updated:** 2025-10-20
**Author:** Claude Code
**Review Required:** Before Phase 3 (Backend Implementation)
