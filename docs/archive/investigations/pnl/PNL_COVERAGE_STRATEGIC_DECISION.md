# Strategic Decision Analysis: Achieving 100% P&L Coverage for Polymarket Trades

**Date:** 2025-11-07
**Status:** STRATEGIC ANALYSIS
**Priority:** CRITICAL - Blocks full wallet metrics rollout

---

## EXECUTIVE SUMMARY

**The Question:** How do we recover P&L calculation capability for 77.4M trades (48.53%) currently missing `condition_id`?

**Current State:**
- **159.6M total trades** in `trades_raw` table
- **82.1M trades (51.47%)** have `condition_id` → can calculate P&L
- **77.4M trades (48.53%)** missing `condition_id` → currently uncalculable
- **Only ~5% resolution coverage** limits actual P&L calculation to small subset

**The Strategic Choice:**

| Approach | Timeline | Realistic Coverage | Cost | Complexity | Recommendation |
|----------|----------|-------------------|------|------------|----------------|
| **A. Blockchain Reconstruction** | 12-18 hrs | 70-85% | Free | Very High | ❌ **BACKUP ONLY** |
| **B1. CLOB API Recovery** | 6-10 hrs | 60-80% | Free | Medium | ⚠️ **PARTIAL** |
| **B2. Dune Analytics** | 3-5 hrs | 95-99% | $500-2000 | Low | ✅ **BEST ROI** |
| **B3. Goldsky Subgraphs** | 6-8 hrs | 70-85% | Free | Medium | ⚠️ **DATA QUALITY RISK** |
| **HYBRID (Recommended)** | 8-12 hrs | 95%+ | $500-2000 | Medium | ✅ **RECOMMENDED** |

**Recommended Strategy:** HYBRID APPROACH
1. **Dune Analytics** for historical backfill (Dec 2022 - Oct 2024): 3-5 hours, 95% coverage
2. **CLOB API** for recent data + ongoing sync (Oct 2024 - present): 2-4 hours
3. **Blockchain verification** as safety net: Already downloaded, validate against APIs
4. **Total Timeline:** 8-12 hours to 95%+ coverage
5. **Total Cost:** $500-2000 one-time (Dune export)

---

## CRITICAL CONTEXT: What We Actually Know

### From Existing Documentation Analysis

**1. The "159.6M trades" in trades_raw:**
- Source: Blockchain ERC1155 + USDC event parsing
- Date range: Dec 2022 - Oct 2025 (1,048 days)
- Status: ✅ **COMPLETE for blockchain-derived data**
- Coverage: 100% of what blockchain logs can provide

**2. The "387.7M USDC transfers" in staging:**
- These are **RAW blockchain event logs** (not yet decoded)
- NOT all are Polymarket trades (many are generic USDC transfers)
- Require hex decoding of topics/data fields
- Realistic Polymarket subset: 50-100M transfers

**3. The "206K ERC1155 transfers" in production:**
- Only the **cleaned/deduplicated** subset
- Missing: ERC1155 staging table (0 rows)
- **This is the blocker** - without full ERC1155 history, can't decode `condition_id` from blockchain alone

**4. The Resolution Coverage Crisis:**
- Only **2,858 resolutions** in `expanded_resolution_map.json`
- Only **1,179 have valid (non-null) payouts**
- Total conditions in database: **~61,517**
- **Resolution coverage: ~5%** ❌
- Result: 89% of wallets have ZERO resolved trades

**5. The pm_trades Table Reality:**
- Only **537 rows** (vs 159.6M in trades_raw)
- Source: CLOB API pagination (6 proxy wallets, Apr-Nov 2024)
- Status: ❌ **SEVERELY INCOMPLETE**
- Conclusion: CLOB API was never fully backfilled

### What This Means for Strategic Options

**The Honest Truth:**
- Blockchain approach **alone** cannot recover 100% because ERC1155 staging is empty
- CLOB API **alone** cannot recover 100% because it only has recent data (~500 fills per wallet)
- **Resolution data is the real bottleneck** - even if we recover all trades, we can only calculate P&L for ~5% without more resolutions

---

## OPTION A: BLOCKCHAIN RECONSTRUCTION (BACKUP STRATEGY)

### Mechanics

**Step 1: Decode 387.7M USDC Transfers (2-3 hours)**
```typescript
// Extract from raw blockchain logs
const decodedTransfer = {
  from_address: topics[1].slice(-40),  // Extract from indexed topic
  to_address: topics[2].slice(-40),    // Extract from indexed topic
  amount: parseInt(data, 16) / 1e6     // Decode hex to USDC amount
}
```

**Step 2: Fetch Missing ERC1155 Transfers (4-6 hours)**
- **Current Status:** 0 rows in `erc1155_transfers_staging`
- **Need:** Full historical ERC1155 `TransferBatch` events
- **Source:** Polygon archive node via Alchemy/Infura RPC
- **Query:** Filter for CTF Exchange contract: `0x4bfb41d5b3570deb38c37251976ac1ee41e82ec0`
- **Estimate:** 10-50M events to fetch and decode

**Step 3: Decode Condition IDs from Token IDs (2-3 hours)**
```typescript
// Polymarket token encoding
const token_id = BigInt(raw_token_id)
const condition_id = (token_id >> 8n).toString(16).padStart(64, '0')
const outcome_index = Number(token_id & 0xFFn)
```

**Step 4: Join USDC + ERC1155 by tx_hash (2-3 hours)**
- Match transfers by `transaction_hash`
- Aggregate to trade-level: `cost_basis = USDC amount`, `shares = token amount`
- Compute `side` from net flows (**NDR** skill)

**Step 5: Validate Against Existing trades_raw (1-2 hours)**
- Compare decoded blockchain data to existing 159.6M rows
- Verify transaction hashes match
- Check for schema consistency

### Timeline Estimate: 12-18 hours

### Expected Coverage: 70-85%

**Why Not Higher?**
- ERC1155 data availability unknown (might be incomplete)
- Many blockchain transfers are position transfers (not trades)
- Complex multi-leg trades might be hard to reconstruct
- Matching logic could miss edge cases

### Advantages
✅ Fully deterministic (blockchain is immutable source of truth)
✅ Data already downloaded for USDC (387.7M rows = sunk cost)
✅ Can validate every trade against on-chain events
✅ No external dependencies after initial fetch
✅ Free (besides RPC costs for ERC1155)

### Disadvantages
❌ Very long timeline (12-18 hours minimum)
❌ Complex decoding required (hex parsing, ABI knowledge)
❌ ERC1155 staging is currently empty (need to fetch from scratch)
❌ Risk: Even if we decode perfectly, still limited by 5% resolution coverage
❌ Doesn't solve the real problem (need more resolution data)

### Risk Assessment: MEDIUM-HIGH

**Known Unknowns:**
1. Can we actually fetch all historical ERC1155 transfers? (RPC rate limits, archive depth)
2. Will decoded data match existing `trades_raw` structure? (schema mapping risk)
3. Are there edge cases in token encoding we don't know about?

**Critical Blocker:** Even if successful, we still only have 5% resolution coverage

---

## OPTION B1: CLOB API RECOVERY

### Mechanics

**Polymarket CLOB API Endpoints:**
- Base URL: `https://clob.polymarket.com/`
- Fills endpoint: `/trades?market=<id>&start_ts=<unix>&end_ts=<unix>`
- Pagination: Cursor-based, ~1000 fills per page
- Rate limits: ~100-200 req/sec (public endpoint)

**Step 1: Test Historical Depth (15 minutes)**
```bash
curl "https://clob.polymarket.com/trades?market=<market_id>&limit=1&before=1000000000000"
# Check earliest timestamp returned
```

**Step 2: Paginate All Markets (4-6 hours)**
- Get list of all market IDs from `gamma_markets` (151.8K markets)
- For each market: Paginate through all fills
- Store: trade_id, maker, taker, price, size, timestamp, tx_hash

**Step 3: Match to Existing trades_raw (1-2 hours)**
- Join on `transaction_hash` (most reliable)
- Extract `condition_id` from CLOB metadata
- Backfill missing `condition_id` values in trades_raw

**Step 4: Validate Coverage (30 minutes)**
- Check how many of 77.4M missing trades now have `condition_id`
- Compare timestamps to verify historical depth

### Timeline Estimate: 6-10 hours

### Expected Coverage: 60-80%

**Why This Range?**
- CLOB API **likely** doesn't have data back to Dec 2022 (only recent months)
- Based on `pm_trades` evidence: Only 537 fills from 6 wallets (recent only)
- Checkpoints last updated Nov 6, 2024 (suggests recent ingestion only)
- Historical CLOB data may not be retained by Polymarket

### Advantages
✅ Official Polymarket data source (highest quality)
✅ Includes order-level metadata (maker/taker, fees)
✅ Free (public API)
✅ Can be used for ongoing sync after backfill
✅ Well-documented REST API

### Disadvantages
❌ Historical depth unknown (likely <6 months)
❌ Rate limits will slow pagination (6-10 hours)
❌ May not recover the oldest 50% of trades (Dec 2022 - Apr 2024)
❌ Still doesn't solve resolution coverage problem (5%)
❌ Requires robust retry logic (network failures)

### Risk Assessment: MEDIUM

**Known Limitations:**
- `pm_trades` only has 537 rows (not 159M) - suggests API wasn't used for historical backfill
- Last checkpoint: Nov 6, 2024 - suggests only recent data available
- May need to combine with another source for full coverage

---

## OPTION B2: DUNE ANALYTICS (RECOMMENDED)

### What Dune Has

**Dune Polymarket Spellbook Tables:**
- `polymarket_polygon.market_trades` - All historical fills
- `polymarket_polygon.market_outcomes` - Market resolutions
- `polymarket_polygon.markets` - Market metadata
- Coverage: Dec 2022 - present (1,048+ days)
- Freshness: 5-10 minute lag

### Mechanics

**Step 1: Create Dune Account + Write Query (1 hour)**
```sql
-- Export all Polymarket trades with condition_id
SELECT
  trader AS wallet_address,
  market_id,
  condition_id,
  token_id,
  outcome,
  side,
  price,
  size,
  transaction_hash,
  block_time AS timestamp
FROM polymarket_polygon.market_trades
WHERE block_time >= '2022-12-01'
ORDER BY block_time ASC
```

**Step 2: Export Data (30 minutes)**
- Dune Free Tier: CSV export (up to 1M rows per query)
- Dune Paid Tier ($500-2000/mo): Unlimited exports via API
- Alternative: Run multiple queries with date filters to chunk data

**Step 3: Load to ClickHouse (1-2 hours)**
```python
# Python ETL script
import pandas as pd
from clickhouse_driver import Client

# Read CSV
df = pd.read_csv('dune_export.csv')

# Normalize condition_id (IDN skill)
df['condition_id_norm'] = df['condition_id'].str.lower().str.replace('0x', '')

# Bulk insert to ClickHouse
client.execute('INSERT INTO trades_raw ...', df.to_dict('records'))
```

**Step 4: Match to Existing trades_raw (30 minutes)**
- Join Dune data to existing `trades_raw` by `transaction_hash`
- Update `condition_id` where missing
- Track coverage improvement

**Step 5: Validate Sample (30 minutes)**
- Pick 100 random trades
- Verify against Polymarket UI (polymarket.com)
- Check P&L calculations match

### Timeline Estimate: 3-5 hours

### Expected Coverage: 95-99%

**Why This High?**
- Dune Spellbook is community-maintained and comprehensive
- Used by major dashboards (proven reliability)
- Full historical depth confirmed in documentation

### Advantages
✅ **Fastest option** (3-5 hours total)
✅ **Highest coverage** (95-99% of all trades)
✅ Community-validated data quality
✅ Includes market metadata (names, categories)
✅ Can export resolutions too (solve both problems at once)
✅ No complex decoding or pagination logic

### Disadvantages
❌ **Cost:** $500-2000 for premium export (or free with chunking)
❌ Vendor lock-in for ongoing sync (better to switch to own pipeline)
❌ 5-10 minute data lag (not real-time)
❌ Need to validate data quality (not guaranteed 100% accurate)
❌ Free tier limits (1M rows per query = need multiple queries)

### Risk Assessment: LOW

**Validation Plan:**
1. Export sample of 10K trades from Dune
2. Compare to existing `trades_raw` by `transaction_hash`
3. Check for discrepancies (should be <1%)
4. If validation passes, proceed with full export

### Cost Breakdown

**Option 1: Free Tier (Chunked Export)**
- Cost: $0
- Effort: +2 hours (write multiple queries with date filters)
- Total timeline: 5-7 hours

**Option 2: Paid Tier (API Export)**
- Cost: $500-2000/month (can cancel after export)
- Effort: Standard 3-5 hours
- Total timeline: 3-5 hours

**Recommendation:** Start with free tier, upgrade to paid only if chunking is too slow

---

## OPTION B3: GOLDSKY SUBGRAPHS

### What Goldsky Has

**Goldsky Polymarket Subgraphs:**
- `activity-subgraph` - Trade activity
- `positions-subgraph` - Position tracking
- `pnl-subgraph` - P&L calculations
- `orderbook-subgraph` - Order book state

**Source:** Already referenced in codebase (`scripts/` folder has Goldsky scripts)

### Known Data Quality Issues

**From codebase documentation:**
- **128x shares inflation bug** - Known data quality issue
- Scripts exist to fix this: `fix-goldsky-inflation.ts`
- Coverage: 85-95% (not comprehensive)

### Mechanics

**Step 1: Query Goldsky GraphQL API (2-3 hours)**
```graphql
{
  trades(
    first: 1000
    orderBy: timestamp
    orderDirection: asc
    where: { timestamp_gte: "2022-12-01" }
  ) {
    id
    market
    condition_id
    trader
    side
    price
    size
    timestamp
    transaction_hash
  }
}
```

**Step 2: Apply Inflation Fix (1-2 hours)**
- Divide all `size` values by 128 (documented bug)
- Validate against known correct values

**Step 3: Load to ClickHouse (1-2 hours)**
- Similar to Dune approach
- Normalize condition_id (**IDN** skill)
- Match to existing trades_raw

**Step 4: Validate Coverage (1 hour)**
- Check how many missing trades recovered
- Cross-reference with blockchain data

### Timeline Estimate: 6-8 hours

### Expected Coverage: 70-85%

**Why Lower Than Dune?**
- Known data quality issues (128x bug)
- Historical coverage uncertain
- Less battle-tested than Dune Spellbook

### Advantages
✅ Free (public GraphQL endpoints)
✅ Scripts already exist in codebase
✅ Real-time data (better than Dune's 5-10 min lag)
✅ Multiple subgraphs for cross-validation

### Disadvantages
❌ **Known data quality issues** (128x inflation bug)
❌ Coverage uncertain (85-95% estimate)
❌ Need to apply manual fixes
❌ Historical depth unknown
❌ Still doesn't solve resolution coverage (5%)

### Risk Assessment: MEDIUM-HIGH

**Trust Issues:**
- If there's one known bug (128x), what else is broken?
- Less community validation than Dune
- Subgraph maintainer responsiveness unknown

---

## HYBRID APPROACH (RECOMMENDED STRATEGY)

### The Plan

**Phase 1: Dune Backfill (Historical Data)**
- **Timeline:** 3-5 hours
- **Coverage:** Dec 2022 - Sep 2024 (95%+ of historical)
- **Cost:** $0-500 (use free tier with chunking)
- **Output:** Recover ~73M missing trades

**Phase 2: CLOB API (Recent + Ongoing)**
- **Timeline:** 2-4 hours
- **Coverage:** Oct 2024 - present (100% of recent)
- **Cost:** $0 (free API)
- **Output:** Recover remaining ~4M recent trades + establish ongoing sync

**Phase 3: Blockchain Verification (Safety Net)**
- **Timeline:** 2-3 hours
- **Coverage:** Validate against 387.7M USDC transfers
- **Cost:** $0 (data already downloaded)
- **Output:** Confirm Dune + CLOB accuracy

**Phase 4: Resolution Data Expansion (CRITICAL)**
- **Timeline:** 4-6 hours
- **Coverage:** Fetch all historical resolutions from Polymarket API
- **Cost:** $0 (free API)
- **Output:** Expand from 5% to 30-50% resolution coverage

### Total Timeline: 11-18 hours
### Total Cost: $0-500
### Expected Coverage: 95%+ for trades, 30-50% for resolutions

### Why This Works

**Complementary Strengths:**
- Dune covers historical depth (oldest trades)
- CLOB API covers recent data + ongoing sync
- Blockchain validates both sources
- Resolution expansion unlocks actual P&L calculation

**Risk Mitigation:**
- If Dune fails validation, fall back to CLOB API + blockchain
- If CLOB API is rate-limited, rely on Dune for bulk
- Blockchain serves as ground truth for conflicts

**Optimal ROI:**
- Fastest path to 95%+ coverage (11-18 hours)
- Lowest cost ($0-500 vs building from scratch)
- Highest data quality (validated against multiple sources)
- Establishes sustainable ongoing pipeline

---

## THE REAL PROBLEM: RESOLUTION COVERAGE

### Why Trade Recovery Alone Isn't Enough

**Current Reality:**
- Even if we recover all 77.4M missing trades, we still have **only 5% resolution coverage**
- Without resolutions, we can't calculate realized P&L
- Result: 89% of wallets still won't have metrics

**From DEBRIEFING_PNL_BUG_AND_RESOLUTION_COVERAGE.md:**
- Total wallets: 28,001
- Wallets with ≥1 resolved trade: ~2,959 (11%)
- Wallets with ZERO resolved trades: ~25,042 (89%)

**The Math:**
- Total conditions in database: ~61,517
- Conditions with resolutions: ~2,858
- **Resolution coverage: 4.6%** ❌

### The Solution: Resolution Data Expansion

**Must be done in parallel with trade recovery:**

**Step 1: Fetch All Historical Resolutions (2-3 hours)**
```typescript
// Polymarket API endpoint
const resolutions = await fetch(
  `https://gamma-api.polymarket.com/markets?resolved=true&limit=1000&offset=${offset}`
)

// Extract resolution data
for (const market of resolutions) {
  if (market.resolved) {
    resolutionMap[market.condition_id] = {
      winning_outcome: market.resolved_outcome,
      payout_numerators: market.payout_numerators,
      payout_denominator: market.payout_denominator,
      resolved_at: market.resolved_at
    }
  }
}
```

**Step 2: Apply to trades_raw (1-2 hours)**
- Use **PNL** skill: `pnl_usd = shares * (arrayElement(payout_numerators, winning_index + 1) / payout_denominator) - cost_basis`
- Mark `is_resolved = 1` for all matched trades
- Compute `realized_pnl_usd`

**Step 3: Expected Coverage After Expansion**
- Realistic resolution coverage: **30-50%** (based on typical market resolution rates)
- Wallets with ≥1 resolved trade: **15,000-20,000** (vs current 2,959)
- Leaderboard-qualified wallets: **3,000-6,000** (vs current 51)

---

## DECISION MATRIX: ALL OPTIONS COMPARED

| Factor | Blockchain | CLOB API | Dune | Goldsky | HYBRID |
|--------|-----------|----------|------|---------|--------|
| **Timeline** | 12-18 hrs | 6-10 hrs | 3-5 hrs | 6-8 hrs | 11-18 hrs |
| **Trade Coverage** | 70-85% | 60-80% | 95-99% | 70-85% | 95%+ |
| **Resolution Coverage** | 5% (no change) | 5% (no change) | 30-50% (if exported) | 5% (no change) | 30-50% |
| **Cost** | Free | Free | $0-2000 | Free | $0-500 |
| **Complexity** | Very High | Medium | Low | Medium | Medium |
| **Data Quality** | Highest (on-chain) | High (official) | High (validated) | Medium (bugs) | Highest (validated) |
| **Risk Level** | Medium-High | Medium | Low | Medium-High | Low |
| **Ongoing Sync** | Complex | Easy | Vendor lock-in | Easy | Easy |
| **Validation Effort** | High | Medium | Low | High | Medium |
| **Success Probability** | 60% | 70% | 90% | 65% | 95% |

### Recommendation: ✅ HYBRID APPROACH

**Why:**
1. **Fastest path to 95%+** trade coverage (11-18 hours)
2. **Solves both problems** (trades + resolutions)
3. **Lowest risk** (multiple data sources validate each other)
4. **Best long-term** (establishes sustainable pipeline)
5. **Optimal cost** ($0-500 vs $0 for uncertain blockchain approach)

---

## CRITICAL UNKNOWNS & VALIDATION PLAN

### Before Committing to Any Approach

**Test 1: CLOB API Historical Depth (15 minutes)**
```bash
# Check earliest available trade
curl "https://clob.polymarket.com/trades?limit=1&before=1000000000000" | jq '.data[0].timestamp'

# If timestamp > Jan 2024, CLOB API has <12 months of data
# If timestamp < Jan 2023, CLOB API has 2+ years of data
```

**Test 2: Dune Data Quality (1 hour)**
```sql
-- Export 10K sample trades from Dune
-- Compare to existing trades_raw by transaction_hash
-- Calculate match rate (should be >95%)
```

**Test 3: ERC1155 Data Availability (30 minutes)**
```bash
# Check if we can fetch historical ERC1155 transfers
curl "https://polygon-mainnet.g.alchemy.com/v2/$API_KEY" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "eth_getLogs",
    "params": [{
      "address": "0x4bfb41d5b3570deb38c37251976ac1ee41e82ec0",
      "fromBlock": "0x1C00000",  # Early 2023
      "toBlock": "latest",
      "topics": ["0x...TransferBatch..."]
    }],
    "id": 1
  }'

# If returns data, blockchain approach is viable
# If returns "query exceeds limit", need to chunk or abandon
```

### Go/No-Go Decision Tree

```
Run Test 1 (CLOB API depth)
├─ Earliest trade < Jan 2023?
│  ├─ YES → CLOB API has full history, consider Option B1
│  └─ NO → CLOB API only has recent data, skip Option B1
│
Run Test 2 (Dune validation)
├─ Match rate > 95%?
│  ├─ YES → Dune data quality confirmed, proceed with Hybrid
│  └─ NO → Dune has quality issues, consider blockchain approach
│
Run Test 3 (ERC1155 availability)
├─ Can fetch historical ERC1155?
│  ├─ YES → Blockchain approach viable as backup
│  └─ NO → Blockchain approach not viable, must use APIs

Decision:
├─ Dune validated + CLOB recent → HYBRID APPROACH ✅
├─ Dune failed + CLOB full history → Option B1
├─ Both APIs failed + ERC1155 available → Option A (blockchain)
└─ All failed → Manual escalation required
```

---

## IMPLEMENTATION ROADMAP

### Week 1: Validation & Quick Wins (8-12 hours)

**Day 1 (2-3 hours):**
- [ ] Run Test 1: CLOB API depth check (15 min)
- [ ] Run Test 2: Dune data quality validation (1 hour)
- [ ] Run Test 3: ERC1155 availability check (30 min)
- [ ] Make go/no-go decision (30 min)

**Day 2-3 (6-9 hours):**
- [ ] **If Hybrid:** Execute Dune export + CLOB pagination
- [ ] **If Blockchain:** Start ERC1155 fetch + decoding
- [ ] **Track progress:** Monitor coverage improvement every 2 hours

**Day 4 (2 hours):**
- [ ] Validate recovered trades against blockchain (spot check 1000 trades)
- [ ] Update `condition_id` for all recovered trades (**IDN** skill)
- [ ] Measure coverage improvement (target: 95%+)

### Week 2: Resolution Expansion (8-12 hours)

**Day 5-6 (4-6 hours):**
- [ ] Fetch all historical resolutions from Polymarket API
- [ ] Expand `expanded_resolution_map.json` from 2,858 to 18K-30K
- [ ] Validate payout vectors (**GATE** skill: check neutrality)

**Day 7 (2-3 hours):**
- [ ] Apply resolutions to `trades_raw` (**PNL** skill)
- [ ] Mark `is_resolved = 1` for all matched trades
- [ ] Calculate `realized_pnl_usd` for resolved positions

**Day 8 (2-3 hours):**
- [ ] Re-compute wallet metrics for all 28K wallets
- [ ] Validate leaderboard (expect 3K-6K wallets vs current 51)
- [ ] Run verification queries (win rate 30-50%, omega ratio 0.8-1.2)

### Week 3: Ongoing Sync Setup (4-6 hours)

**Day 9-10 (4-6 hours):**
- [ ] Build CLOB API daily sync script
- [ ] Build Polymarket resolution daily sync script
- [ ] Set up cron jobs or GitHub Actions
- [ ] Establish monitoring/alerting

**Final Validation:**
- [ ] 95%+ trade coverage confirmed
- [ ] 30-50% resolution coverage confirmed
- [ ] 15K-20K wallets with metrics (vs 2,959)
- [ ] Leaderboard shows 3K-6K profitable wallets (vs 51)

---

## COST-BENEFIT ANALYSIS

### Option Comparison: Total Cost of Ownership (3 months)

| Approach | Initial Setup | Ongoing Sync | Maintenance | Total (3mo) |
|----------|--------------|--------------|-------------|-------------|
| **Blockchain Only** | 18 hrs ($0) | 4 hrs/mo ($0) | 8 hrs/mo ($0) | **54 hrs** |
| **CLOB API Only** | 10 hrs ($0) | 2 hrs/mo ($0) | 4 hrs/mo ($0) | **28 hrs** |
| **Dune Only** | 5 hrs ($500) | $2000/mo | 2 hrs/mo ($0) | **$6500 + 11 hrs** |
| **Hybrid (Recommended)** | 12 hrs ($500) | 2 hrs/mo ($0) | 4 hrs/mo ($0) | **$500 + 30 hrs** |

**Winner:** Hybrid Approach
- Lowest initial cost ($500 one-time)
- Fastest setup (12 hours)
- No recurring costs (own pipeline for sync)
- Highest data quality (multi-source validation)

---

## RISK MITIGATION STRATEGIES

### Risk 1: Dune Data Quality Issues
**Mitigation:**
- Validate sample of 10K trades before full export
- Cross-reference with blockchain data
- If >5% discrepancy, fall back to CLOB API + blockchain

### Risk 2: CLOB API Rate Limits
**Mitigation:**
- Implement exponential backoff
- Use multiple API keys if available
- Chunk by market_id (parallel processing)
- Fall back to Dune if too slow

### Risk 3: Resolution Coverage Still Too Low
**Mitigation:**
- Prioritize high-volume markets first
- Accept 30-50% coverage as "good enough" for MVP
- Build manual resolution queue for VIP wallets
- Fetch resolutions on-demand for specific wallet requests

### Risk 4: Blockchain Reconstruction Complexity
**Mitigation:**
- Use blockchain only as validation layer (not primary source)
- Keep as backup option if all APIs fail
- Document hex decoding patterns for future reference

---

## SUCCESS CRITERIA

### Minimum Viable Recovery (Week 1)
- [ ] 80%+ trade coverage (target: 127M of 159M trades have condition_id)
- [ ] <5% data quality issues (spot check 1000 trades)
- [ ] All recovered trades have valid transaction_hash

### Target Recovery (Week 2)
- [ ] 95%+ trade coverage (target: 151M of 159M trades)
- [ ] 30-50% resolution coverage (target: 18K-30K of 61K conditions)
- [ ] 15K-20K wallets with metrics (vs current 2,959)

### Optimal Recovery (Week 3)
- [ ] 98%+ trade coverage (target: 156M of 159M trades)
- [ ] 50%+ resolution coverage (target: 30K+ of 61K conditions)
- [ ] 20K+ wallets with metrics
- [ ] Ongoing sync pipeline established (daily updates)

---

## FINAL RECOMMENDATION

### Execute HYBRID APPROACH in This Order:

**Phase 1: Validation (2-3 hours)**
1. Test CLOB API historical depth
2. Validate Dune data quality (10K sample)
3. Make go/no-go decision

**Phase 2: Historical Backfill (6-8 hours)**
1. Export from Dune (Dec 2022 - Sep 2024)
2. Load to ClickHouse + normalize condition_id
3. Validate coverage improvement

**Phase 3: Recent Data Recovery (2-4 hours)**
1. Paginate CLOB API (Oct 2024 - present)
2. Merge with Dune data
3. Achieve 95%+ trade coverage

**Phase 4: Resolution Expansion (6-8 hours)**
1. Fetch all Polymarket resolutions
2. Apply to trades_raw (**PNL** skill)
3. Achieve 30-50% resolution coverage

**Phase 5: Ongoing Sync (4-6 hours)**
1. Build daily CLOB sync script
2. Build daily resolution sync script
3. Establish monitoring

**Total Timeline:** 20-29 hours
**Total Cost:** $0-500 (Dune export if needed)
**Expected Outcome:** 95%+ trade coverage, 30-50% resolution coverage, 15K-20K wallets with metrics

---

## NEXT STEPS (IMMEDIATE)

1. **Run validation tests** (Test 1, 2, 3) → 2 hours
2. **Review results with user** → 30 minutes
3. **Get approval for Hybrid approach** → Decision point
4. **Execute Phase 1: Dune export** → 3-5 hours
5. **Execute Phase 2: CLOB pagination** → 2-4 hours
6. **Execute Phase 3: Resolution expansion** → 6-8 hours

**Est. Time to 95% Coverage:** 13-19 hours of execution + validation

---

**END OF STRATEGIC ANALYSIS**

Generated: 2025-11-07
Next Update: After validation tests complete
