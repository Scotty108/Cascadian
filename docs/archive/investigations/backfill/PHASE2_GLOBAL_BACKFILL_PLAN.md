# Phase 2: Global Backfill - CORRECT Architecture

## Executive Summary

**Key Insight**: Don't backfill per-wallet. Backfill the entire universe ONCE, then all wallets benefit.

**Three-Step Global Backfill**:
1. **All Markets** - Fetch complete market universe from Gamma API (150K+ markets)
2. **All Wallets** - Extract unique wallets from blockchain data, fetch their API positions
3. **Unified View** - Combine blockchain + API data for ANY wallet to query

---

## Why Global Backfill?

### ❌ Wrong Approach (Per-Wallet)
```bash
# This scales poorly
for wallet in wallets:
  fetch_positions(wallet)  # 10K wallets × 5 min = 833 hours!
```

### ✅ Correct Approach (Global Universe)
```bash
# This scales well
fetch_all_markets()              # 30 min → ALL markets
fetch_all_blockchain_wallets()   # 2-4 hours → ALL known wallets
create_unified_view()            # 10 min → ANY wallet can query
```

---

## Three-Step Plan

### Step 1: Global Market Universe (30-60 min)

**Script**: `backfill-all-markets-global.ts`

**What it does**:
- Fetches ALL markets from Gamma API (active + closed)
- Stores in `api_markets_staging`
- Expected: 150K+ total markets

**Run**:
```bash
npx tsx backfill-all-markets-global.ts
```

**Output**:
- All Polymarket markets with metadata
- Condition IDs for joining
- Market status (active/closed/resolved)

**Status**: ✅ Running in background

---

### Step 2: All Wallets from Blockchain (2-4 hours)

**Script**: `backfill-all-wallets-from-blockchain.ts`

**What it does**:
- Extracts ALL unique wallets from `vw_trades_canonical`
- For each wallet, fetches positions from Data API
- Stores in `api_positions_staging`
- Checkpoints every 500 wallets (resumable)

**Run**:
```bash
# Start the backfill
npx tsx backfill-all-wallets-from-blockchain.ts

# Resume if interrupted
npx tsx backfill-all-wallets-from-blockchain.ts  # Auto-resumes from checkpoint
```

**Expected Stats**:
- Unique wallets: 10K-50K
- API calls: ~50K (one per wallet)
- Positions: 500K-2M total
- Runtime: 2-4 hours with rate limiting

**Features**:
- ✅ Automatic checkpointing (resume from failures)
- ✅ Rate limiting (respects API limits)
- ✅ Progress tracking (every 10 wallets)
- ✅ Error handling (continues on failures)

---

### Step 3: Create Unified View (10 min)

**Script**: `create-unified-trades-view.ts` (to be created)

**What it does**:
- Combines blockchain trades (`vw_trades_canonical`)
- With API positions (`api_positions_staging`)
- Using market metadata (`api_markets_staging`)
- Creates `vw_trades_unified` view

**SQL Structure**:
```sql
CREATE VIEW vw_trades_unified AS
-- Blockchain trades (on-chain settlements)
SELECT
  wallet,
  market_cid,
  outcome,
  shares,
  price,
  'blockchain' as source
FROM vw_trades_canonical

UNION ALL

-- API positions (CLOB trades)
SELECT
  wallet_address as wallet,
  condition_id as market_cid,
  outcome,
  size as shares,
  entry_price as price,
  'clob_api' as source
FROM api_positions_staging;
```

---

## Architecture Comparison

### Before (Per-Wallet) ❌
```
┌─────────────────────────────────┐
│  For each wallet:               │
│  1. Fetch positions API         │
│  2. Insert to staging           │
│  3. Repeat 10K+ times          │
│                                 │
│  Total: 833+ hours!            │
└─────────────────────────────────┘
```

### After (Global) ✅
```
┌─────────────────────────────────┐
│  1. Fetch ALL markets (30 min) │
│  2. Fetch ALL wallets (4 hrs)  │
│  3. Create unified view (10min) │
│                                 │
│  Total: ~4.5 hours              │
│  Result: ALL wallets covered   │
└─────────────────────────────────┘
```

---

## Data Coverage

### What We'll Have After Phase 2

| Data Source | Coverage | Count |
|-------------|----------|-------|
| **Markets** | Complete universe | 150K+ |
| **Blockchain Trades** | Complete (1,048 days) | 291K transfers |
| **CLOB Positions** | All blockchain wallets | 10K-50K wallets |
| **Combined** | Hybrid | ANY wallet can query |

### Coverage for ANY Wallet

After Phase 2, for **any wallet address**:
1. If they traded on-chain → blockchain data ✅
2. If they have CLOB positions → API data ✅
3. If they did both → unified data ✅

---

## Execution Timeline

### Immediate (Now)
- ✅ Phase 1 complete (P&L views fixed)
- 🔄 Step 1 running (global markets backfill)

### Next 30 min
- ✅ Step 1 completes (market universe loaded)
- ▶️  Step 2 starts (wallet backfill)

### Next 2-4 hours
- 🔄 Step 2 running (checkpointed, can monitor)
- 💾 Checkpoint file tracks progress

### After Step 2
- ▶️  Step 3 (create unified view)
- ✅ Complete data coverage for ALL wallets

---

## Monitoring Progress

### Step 1 (Markets)
```bash
# Check if running
ps aux | grep backfill-all-markets

# Check ClickHouse
npx tsx -e "
  const ch = require('@clickhouse/client').createClient({...});
  const result = await ch.query({
    query: 'SELECT count() FROM default.api_markets_staging',
    format: 'JSONEachRow'
  });
  console.log(await result.json());
"
```

### Step 2 (Wallets)
```bash
# Check checkpoint file
cat backfill-wallets-checkpoint.json

# Watch progress in real-time
tail -f backfill-wallets-checkpoint.json

# Check ClickHouse
npx tsx -e "
  const ch = require('@clickhouse/client').createClient({...});
  const result = await ch.query({
    query: 'SELECT count(DISTINCT wallet_address) FROM default.api_positions_staging',
    format: 'JSONEachRow'
  });
  console.log(await result.json());
"
```

---

## Overnight Execution

**Recommended**: Start Step 2 now, let it run overnight

```bash
# Start in background with logging
nohup npx tsx backfill-all-wallets-from-blockchain.ts > backfill-wallets.log 2>&1 &

# Check progress tomorrow
cat backfill-wallets-checkpoint.json
tail -100 backfill-wallets.log
```

**Resume if needed**:
```bash
# If interrupted, just re-run (auto-resumes)
npx tsx backfill-all-wallets-from-blockchain.ts
```

---

## Success Criteria

### Step 1 Complete ✅
- [ ] api_markets_staging has 150K+ rows
- [ ] All condition_ids populated
- [ ] Active + closed markets covered

### Step 2 Complete ✅
- [ ] api_positions_staging has 500K+ rows
- [ ] 10K+ unique wallets
- [ ] Checkpoint file shows 100% complete

### Step 3 Complete ✅
- [ ] vw_trades_unified view created
- [ ] Combines blockchain + API sources
- [ ] Test wallet shows complete coverage

---

## Files Created

1. ✅ `setup-api-staging-tables.ts` - Tables created
2. ✅ `backfill-all-markets-global.ts` - Running now
3. ✅ `backfill-all-wallets-from-blockchain.ts` - Ready to run
4. ⏳ `create-unified-trades-view.ts` - To be created after Step 2

---

## Ready to Execute?

**Current Status**:
- Phase 1: ✅ Complete (P&L views fixed)
- Step 1 (Markets): 🔄 Running in background
- Step 2 (Wallets): ✅ Ready to start

**Next Action**:
- Wait for Step 1 to complete (~30 min)
- Start Step 2 (can run overnight)
- Create Step 3 script tomorrow

**Timeline**:
- Tonight: Start Step 2 backfill
- Tomorrow morning: Step 2 complete
- Tomorrow: Create unified view (Phase 3)
- Result: Complete coverage for ALL wallets
