# Wallet Mapping & Attribution Execution Plan

## Current Status

**Backfill Progress:** 8.71M / 10M rows (87% complete, ETA ~8-10 min)

**What We Have:**
- ✅ CLOB traders: 996K wallets
- ✅ ERC-1155 participants: 139K wallets (growing)
- ✅ Combined: 1.13M active traders
- ⚠️ Missing: ~372K USDC-only wallets (for money flow tracking)
- ⚠️ Missing: System wallet attribution (25% of trades hidden)

**What We Need:**
1. Full 1.5M wallet universe (for money flow analysis)
2. System wallet mapping (for accurate leaderboards)

---

## PHASE 1: Complete Wallet Universe (1.5M Wallets)

**Goal:** Extract all wallets from ERC20 USDC transfers for money flow tracking

### Task 1.1: Create ERC20 Wallet Extraction View
**Time:** 30 minutes
**Complexity:** Medium (387M rows, needs materialized view)

**What to do:**
```sql
-- Create materialized table to avoid header overflow
CREATE TABLE default.erc20_wallets_extracted
ENGINE = ReplacingMergeTree()
ORDER BY wallet_address
AS
SELECT DISTINCT
  lower(replaceAll(replaceAll(topics[2], '0x000000000000000000000000', ''), '0x', '')) as wallet_address,
  'erc20_from' as source,
  MIN(block_number) as first_seen_block,
  MAX(block_number) as last_seen_block
FROM default.erc20_transfers_staging
WHERE length(topics) >= 2 AND topics[2] != ''
GROUP BY wallet_address

UNION ALL

SELECT DISTINCT
  lower(replaceAll(replaceAll(topics[3], '0x000000000000000000000000', ''), '0x', '')) as wallet_address,
  'erc20_to' as source,
  MIN(block_number) as first_seen_block,
  MAX(block_number) as last_seen_block
FROM default.erc20_transfers_staging
WHERE length(topics) >= 3 AND topics[3] != ''
GROUP BY wallet_address
```

**Script to create:**
```bash
npx tsx scripts/build-erc20-wallet-table.ts
```

**Expected output:**
- ~400-500K unique ERC20 wallets
- Materialized table for fast queries
- Avoids header overflow issues

---

### Task 1.2: Create Unified Wallet Universe View
**Time:** 15 minutes
**Complexity:** Low

**What to do:**
```sql
-- Combine all wallet sources
CREATE VIEW default.vw_all_polymarket_wallets AS
SELECT
  wallet_address,
  'clob_trader' as primary_source,
  TRUE as is_trader,
  FALSE as usdc_only
FROM (
  SELECT DISTINCT wallet_address
  FROM default.trade_direction_assignments
)

UNION ALL

SELECT
  wallet_address,
  'erc1155_participant' as primary_source,
  TRUE as is_trader,
  FALSE as usdc_only
FROM (
  SELECT DISTINCT from_address as wallet_address
  FROM default.erc1155_transfers
  WHERE from_address != '' AND from_address != '0000000000000000000000000000000000000000'

  UNION ALL

  SELECT DISTINCT to_address as wallet_address
  FROM default.erc1155_transfers
  WHERE to_address != '' AND to_address != '0000000000000000000000000000000000000000'
)

UNION ALL

SELECT
  wallet_address,
  'usdc_only' as primary_source,
  FALSE as is_trader,
  TRUE as usdc_only
FROM default.erc20_wallets_extracted
WHERE wallet_address NOT IN (
  SELECT wallet_address FROM default.trade_direction_assignments
)
```

**Script to create:**
```bash
npx tsx scripts/build-unified-wallet-view.ts
```

**Result:** Single view with all 1.5M wallets, tagged by source and activity type

---

### Task 1.3: Build Wallet Network Graph (Money Flow)
**Time:** 1 hour
**Complexity:** Medium

**What to do:**
```sql
-- Create transfer graph table
CREATE TABLE default.wallet_transfer_network
ENGINE = ReplacingMergeTree()
ORDER BY (from_wallet, to_wallet, block_number)
AS
SELECT
  lower(replaceAll(replaceAll(topics[2], '0x000000000000000000000000', ''), '0x', '')) as from_wallet,
  lower(replaceAll(replaceAll(topics[3], '0x000000000000000000000000', ''), '0x', '')) as to_wallet,
  tx_hash,
  block_number,
  created_at,
  'usdc_transfer' as transfer_type
FROM default.erc20_transfers_staging
WHERE length(topics) >= 3
```

**Script to create:**
```bash
npx tsx scripts/build-wallet-transfer-network.ts
```

**Use cases:**
- Track where successful traders send their money
- Detect multi-wallet patterns
- Follow capital flows
- Identify wallet relationships

---

## PHASE 2: System Wallet Mapping (Gasless Trading Attribution)

**Goal:** Map 25% of trades back to real users for accurate leaderboards

### Task 2.1: Identify All System Wallets
**Time:** 15 minutes
**Complexity:** Low (already done, just verify)

**What to do:**
```typescript
// scripts/verify-system-wallets.ts
const SYSTEM_WALLETS = [
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
  '0x2d613c30614b68eada0a37d65bddf3778d981fa7',
  '0xcf3b13042cb6ceb928722b2aa5d458323b6c5107',
  '0x23786fdad0073692157c6d7dc81f281843a35fcb',
  '0xb733d4d4821c709c977adeb66b0fa8f9e41ec872',
  '0xe2025e6ad2abe425f3caa231ca72913ab97b3f01',
  '0x988e68717111080ff101b5242d491f393732e358',
  '0x1e8a3aec2e12020f06d0788cefd357c21aa29f8f',
  '0xa65e13aa5967c719418ce29a2fc9162084d59642'
];

// Check volume per system wallet
// Verify they still account for ~25% of trades
```

**Script:**
```bash
npx tsx scripts/verify-system-wallets.ts
```

---

### Task 2.2: Build System Wallet → User Mapping
**Time:** 1-2 hours (long-running query on 23M+ trades)
**Complexity:** High

**What to do:**
Use existing script `build-system-wallet-map-v2.ts` with improvements:

**Strategy:**
1. Find all transactions involving system wallets
2. Look for paired user wallets in ERC-1155 events
3. Look for paired user wallets in ERC-20 USDC events
4. Match by: same tx_hash, same condition_id, same direction, similar shares

**Confidence levels:**
- HIGH: Both ERC-1155 AND ERC-20 events show same user wallet
- MEDIUM: Only ERC-1155 OR ERC-20 shows user wallet
- LOW: Inferred from transaction patterns

**Script:**
```bash
npx tsx build-system-wallet-map-v2.ts
```

**Expected output:**
```
System Wallet Mapping Results:
├─ Total system wallet trades: 23.7M
├─ HIGH confidence mappings: 18M (76%)
├─ MEDIUM confidence: 4M (17%)
├─ LOW confidence: 1M (4%)
└─ Unmapped (infrastructure): 0.7M (3%)

Recovery rate: 97% of trades mapped to real users
```

**Table created:**
```sql
system_wallet_map:
  tx_hash String
  system_wallet String
  user_wallet String  ← RECOVERED USER!
  condition_id_norm String
  direction Enum8
  shares Decimal(18, 8)
  confidence Enum8('HIGH', 'MEDIUM', 'LOW')
  mapping_method String
```

---

### Task 2.3: Update Analytics Queries with Mapping
**Time:** 1 hour (multiple queries to update)
**Complexity:** Medium

**What to do:**

**Update leaderboard query:**
```sql
-- Before (WRONG - missing 25% of trades)
SELECT wallet_address, win_rate, trades
FROM wallet_metrics
WHERE wallet_address NOT IN (system_wallets)

-- After (CORRECT - includes all trades)
WITH remapped_trades AS (
  SELECT
    COALESCE(m.user_wallet, t.wallet_address) as real_wallet,
    t.*
  FROM fact_trades_clean t
  LEFT JOIN system_wallet_map m
    ON m.system_wallet = t.wallet_address
   AND m.tx_hash = t.tx_hash
   AND m.confidence = 'HIGH'
)
SELECT
  real_wallet as wallet_address,
  win_rate,
  trades
FROM remapped_trades
GROUP BY real_wallet
```

**Update PnL calculation:**
```sql
CREATE VIEW vw_wallet_pnl_with_mapping AS
SELECT
  COALESCE(m.user_wallet, t.wallet_address) as real_wallet,
  SUM(t.pnl) as total_pnl,
  COUNT(*) as trades,
  AVG(t.pnl) as avg_pnl
FROM vw_trade_pnl_final t
LEFT JOIN system_wallet_map m
  ON m.system_wallet = t.wallet_address
 AND m.tx_hash = t.tx_hash
 AND m.confidence IN ('HIGH', 'MEDIUM')
GROUP BY real_wallet
```

**Files to update:**
- `lib/clickhouse/queries/wallet-leaderboard.ts`
- `lib/clickhouse/queries/wallet-pnl.ts`
- `lib/clickhouse/queries/wallet-metrics.ts`

---

## PHASE 3: Validation & Quality Assurance

### Task 3.1: Validate Wallet Universe Completeness
**Time:** 15 minutes
**Complexity:** Low

**Checks:**
```sql
-- Total unique wallets (should be ~1.5M)
SELECT COUNT(DISTINCT wallet_address) FROM vw_all_polymarket_wallets

-- Breakdown by source
SELECT primary_source, COUNT(*) FROM vw_all_polymarket_wallets GROUP BY primary_source

-- Traders vs USDC-only
SELECT
  countIf(is_trader) as traders,
  countIf(usdc_only) as usdc_only
FROM vw_all_polymarket_wallets
```

**Expected:**
- Total: ~1.5M wallets
- Traders: ~1.13M
- USDC-only: ~370K

---

### Task 3.2: Validate System Wallet Mapping Quality
**Time:** 30 minutes
**Complexity:** Medium

**Checks:**
```sql
-- Mapping coverage
SELECT
  COUNT(*) as total_system_trades,
  countIf(m.user_wallet IS NOT NULL) as mapped_trades,
  round(100.0 * countIf(m.user_wallet IS NOT NULL) / COUNT(*), 2) as coverage_pct
FROM fact_trades_clean t
LEFT JOIN system_wallet_map m ON m.tx_hash = t.tx_hash
WHERE t.wallet_address IN (system_wallets)

-- Confidence distribution
SELECT
  confidence,
  COUNT(*) as mappings,
  round(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as pct
FROM system_wallet_map
GROUP BY confidence

-- Validate no circular mappings
SELECT COUNT(*) as circular_mappings
FROM system_wallet_map
WHERE user_wallet IN (system_wallets)  -- Should be 0!
```

**Quality gates:**
- Coverage: >90% of system wallet trades mapped
- HIGH confidence: >70% of mappings
- Circular mappings: 0

---

### Task 3.3: Test Leaderboard Before/After Mapping
**Time:** 15 minutes
**Complexity:** Low

**Compare results:**
```sql
-- Top 10 WITHOUT mapping
SELECT wallet_address, win_rate, trades
FROM wallet_metrics_old
ORDER BY win_rate DESC
LIMIT 10

-- Top 10 WITH mapping
SELECT wallet_address, win_rate, trades
FROM wallet_metrics_with_mapping
ORDER BY win_rate DESC
LIMIT 10
```

**Expected change:**
- System wallets disappear from top 10
- Real high-performing users appear
- More wallets with >1K trades (recovered from system wallets)

---

## EXECUTION TIMELINE

### Immediate (Next 10 min)
- [x] ERC-1155 backfill completes (10M+ rows) ✅
- [ ] Verify final row count and unique condition_ids

### Phase 1: Wallet Universe (2-3 hours)
**Start after backfill completes**
- [ ] Task 1.1: Extract ERC20 wallets (30 min)
- [ ] Task 1.2: Create unified wallet view (15 min)
- [ ] Task 1.3: Build transfer network (1 hour)
- [ ] Task 3.1: Validate completeness (15 min)

**Deliverable:** Full 1.5M wallet universe with money flow tracking

### Phase 2: System Wallet Mapping (2-4 hours)
**Can run in parallel with Phase 1**
- [ ] Task 2.1: Verify system wallets (15 min)
- [ ] Task 2.2: Build mapping table (1-2 hours) ⏱️ LONG
- [ ] Task 2.3: Update analytics queries (1 hour)
- [ ] Task 3.2: Validate mapping quality (30 min)
- [ ] Task 3.3: Test leaderboard (15 min)

**Deliverable:** Accurate leaderboards with 100% trader coverage

### Total Time: 4-7 hours
- Phase 1: 2-3 hours
- Phase 2: 2-4 hours
- Can run phases in parallel (saves 1-2 hours)

---

## SCRIPTS TO CREATE/UPDATE

### New Scripts Needed:
1. `scripts/build-erc20-wallet-table.ts` - Extract wallets from ERC20 transfers
2. `scripts/build-unified-wallet-view.ts` - Combine all wallet sources
3. `scripts/build-wallet-transfer-network.ts` - Create money flow graph
4. `scripts/verify-system-wallets.ts` - Validate system wallet list
5. `scripts/validate-wallet-mapping.ts` - QA checks for mapping quality

### Existing Scripts to Run:
1. `build-system-wallet-map-v2.ts` - Already exists, just needs to run
2. `identify-system-wallets.ts` - Already exists, for verification

### Queries to Update:
1. `lib/clickhouse/queries/wallet-leaderboard.ts` - Add mapping JOIN
2. `lib/clickhouse/queries/wallet-pnl.ts` - Add mapping JOIN
3. `lib/clickhouse/queries/wallet-metrics.ts` - Add mapping JOIN

---

## SUCCESS CRITERIA

### Phase 1 Success (Wallet Universe):
- ✅ 1.5M total wallets in unified view
- ✅ ~1.13M traders identified
- ✅ ~370K USDC-only wallets identified
- ✅ Transfer network table with 387M edges
- ✅ Can query money flow between any two wallets

### Phase 2 Success (System Wallet Mapping):
- ✅ >90% of system wallet trades mapped to users
- ✅ >70% HIGH confidence mappings
- ✅ 0 circular mappings (system → system)
- ✅ Leaderboard shows real users, not system wallets
- ✅ Win rates include ALL user trades (direct + gasless)

### Overall Success:
- ✅ Track smart money movements across wallet network
- ✅ Accurate leaderboards with 100% trader coverage
- ✅ Can attribute gasless trading to real users
- ✅ Full 1.5M wallet universe for comprehensive analytics

---

## PRIORITY ORDER

**If time limited, do in this order:**

**Priority 1 (CRITICAL):** System wallet mapping (Phase 2)
- Without this: Leaderboards are wrong
- Blocks: Accurate performance metrics
- Time: 2-4 hours

**Priority 2 (HIGH):** ERC20 wallet extraction (Phase 1, Task 1.1)
- Without this: Missing money flow tracking
- Blocks: Wallet network analysis
- Time: 30 min

**Priority 3 (MEDIUM):** Unified wallet view (Phase 1, Task 1.2)
- Nice to have: Clean interface to all wallets
- Blocks: Nothing critical
- Time: 15 min

**Priority 4 (LOW):** Transfer network (Phase 1, Task 1.3)
- Nice to have: Advanced money flow analysis
- Blocks: Nothing critical
- Time: 1 hour

---

## NEXT STEPS

**Immediately after backfill (10 min from now):**
1. Check final ERC-1155 row count
2. Verify unique condition_ids (should be 12-13K)
3. Choose: Run phases in parallel OR sequential

**Recommended approach:**
Run Phase 2 (system wallet mapping) FIRST - it's most critical for accurate analytics and blocks leaderboard launch.

Then run Phase 1 (wallet universe) - it's nice to have but not blocking.

**Want me to start Phase 2 now (system wallet mapping) while backfill finishes?**
