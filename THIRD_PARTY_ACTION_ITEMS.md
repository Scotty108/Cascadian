# THIRD-PARTY VERIFICATION: ACTION ITEMS
## Priority tasks to validate claims before proceeding

**Prepared By:** Independent Database Auditor
**Date:** November 7, 2025
**Status:** 🛑 **BLOCKERS IDENTIFIED - READ THIS FIRST**

---

## IMMEDIATE ACTIONS (Do These First - They Take 1-2 Hours)

### ACTION A1: Understand the 0.08% Coverage Issue [CRITICAL BLOCKER]
**Time Estimate:** 30-45 minutes

```sql
-- Question: Why are 99.92% of markets empty?

-- Step 1: Confirm the numbers
SELECT
  COUNT(DISTINCT condition_id) as total_markets,
  (SELECT COUNT(DISTINCT condition_id) FROM trades_raw) as markets_with_trades,
  ROUND(
    (SELECT COUNT(DISTINCT condition_id) FROM trades_raw) * 100.0 /
    COUNT(DISTINCT condition_id),
    2
  ) as coverage_percent
FROM market_resolutions_final;

-- Step 2: Understand what "empty" means
SELECT
  COUNT(*) as empty_market_count
FROM market_resolutions_final
WHERE condition_id NOT IN (SELECT DISTINCT condition_id FROM trades_raw);

-- Step 3: Check if it's recent data only
SELECT
  DATE(MAX(block_timestamp)) as latest_trade_date,
  COUNT(DISTINCT condition_id) as markets_since_date
FROM trades_raw
WHERE block_timestamp >= (NOW() - INTERVAL 30 DAY);

-- Step 4: Check market age
SELECT
  DATE(MIN(created_at)) as oldest_market,
  DATE(MAX(created_at)) as newest_market,
  COUNT(*) as total_markets
FROM gamma_markets;
```

**Decision Point:**
```
IF coverage = 0.08% THEN
  ├─ IF historical data missing: Re-run backfill with older dates
  ├─ IF only recent data: Document as "recent markets only"
  └─ IF join bug: Fix joins before proceeding

ELSE
  └─ Proceed with verified coverage number
```

---

### ACTION A2: Validate P&L Formula Against Polymarket API [CRITICAL BLOCKER]
**Time Estimate:** 45-60 minutes

```typescript
// Step 1: Get wallet address to test
const testWallet = '0x...'; // Use HolyMoses7 or another known wallet

// Step 2: Fetch from Polymarket API
const pmResponse = await fetch(`https://clob.polymarket.com/user/${testWallet}`);
const pmWallet = await pmResponse.json();
const pmPnL = pmWallet.total_pnl; // Expected: $1,907,531.19 or similar

// Step 3: Query database
const dbResult = await clickhouse.query({
  query: `
    SELECT
      wallet,
      realized_pnl_usd,
      unrealized_pnl_usd,
      total_pnl_usd
    FROM wallet_pnl_summary_v2
    WHERE wallet = $1
  `,
  query_params: [testWallet]
});

// Step 4: Compare
const variance = Math.abs((dbResult.total_pnl_usd - pmPnL) / pmPnL * 100);
console.log(`
  Polymarket API:   $${pmPnL.toLocaleString()}
  Database:         $${dbResult.total_pnl_usd.toLocaleString()}
  Variance:         ${variance.toFixed(2)}%

  Status: ${variance < 5 ? '✅ MATCH' : '❌ MISMATCH - INVESTIGATE'}
`);
```

**Decision Point:**
```
IF variance < 5% THEN
  └─ Formula is validated ✅

ELSE (variance >= 5%) THEN
  ├─ Check if difference is unrealized P&L
  ├─ Confirm expected value includes realized + unrealized
  ├─ If only calculated realized: Document scope limitation
  └─ Do NOT claim formula is "validated" yet
```

---

### ACTION A3: Clarify the Target Values [CRITICAL BLOCKER]
**Time Estimate:** 15-20 minutes

**Decision Point:** Which target are we actually aiming for?

```
Current Confusion:
├─ $99,691.54    ← Manual calculation (unverified)
├─ $102,001.46   ← From Polymarket profile (unverified)
├─ $117.24       ← Actual database value (verified)
└─ $1,907,531.19 ← New claim (partially verified)

Action: Decide which one is REAL
├─ If targeting Polymarket profile: Fetch via API, not manual read
├─ If targeting calculated value: Show the calculation logic
├─ If targeting database value: Confirm it matches reality
└─ Document the decision clearly
```

---

## VERIFICATION STEPS (2-4 Hours Total)

### STEP 1: Run Data Quality Audit
**Time:** 30 minutes

```bash
# Connect to ClickHouse and execute:
cat > quick_audit.sql << 'EOF'
-- Data quality baseline
SELECT
  'trades_raw' as table_name,
  COUNT(*) as row_count,
  COUNT(DISTINCT wallet_address) as unique_wallets,
  COUNT(DISTINCT condition_id) as unique_conditions,
  COUNT(CASE WHEN realized_pnl_usd IS NOT NULL THEN 1 END) as rows_with_pnl,
  COUNT(CASE WHEN realized_pnl_usd = 0 THEN 1 END) as zero_pnl_rows
FROM trades_raw

UNION ALL

SELECT
  'wallet_pnl_summary_v2',
  COUNT(*),
  COUNT(DISTINCT wallet),
  COUNT(DISTINCT 1),
  COUNT(CASE WHEN realized_pnl_usd != 0 THEN 1 END),
  COUNT(CASE WHEN realized_pnl_usd = 0 THEN 1 END)
FROM wallet_pnl_summary_v2

UNION ALL

SELECT
  'market_resolutions_final',
  COUNT(*),
  COUNT(DISTINCT condition_id),
  COUNT(DISTINCT 1),
  COUNT(CASE WHEN winning_outcome IS NOT NULL THEN 1 END),
  COUNT(CASE WHEN winning_outcome IS NULL THEN 1 END)
FROM market_resolutions_final;
EOF

clickhouse-client --query="$(cat quick_audit.sql)"
```

**Expected Output Format:**
```
| Table | Rows | Wallets | Conditions | Non-Zero P&L | Zero/Null P&L |
|-------|------|---------|------------|--------------|---------------|
| trades_raw | 159.6M | 65K | 166K | ??? | ??? |
| wallet_pnl_summary_v2 | ??? | ??? | ??? | ??? | ??? |
| market_resolutions_final | 224K | ??? | 224K | ??? | ??? |
```

**What to Look For:**
- If wallet_pnl_summary_v2 is empty → Formula wasn't run
- If wallet_pnl_summary_v2 matches wallet_pnl_summary_final → Good (tables are in sync)
- If zero_pnl_rows is high → Most positions unresolved (expected for open markets)

---

### STEP 2: Profile a Single Wallet Completely
**Time:** 45 minutes

```sql
-- Use HolyMoses7 as test case
-- Expected P&L: $1,907,531.19 or $89,975.16 or $102,001 (unclear which)

-- All trades
SELECT
  wallet_address,
  COUNT(*) as total_trades,
  COUNT(DISTINCT condition_id) as unique_positions,
  SUM(volume_usdc) as total_volume,
  MIN(block_timestamp) as first_trade,
  MAX(block_timestamp) as last_trade
FROM trades_raw
WHERE lower(wallet_address) = 'holymoses7';

-- Resolved vs unresolved split
SELECT
  wallet_address,
  'resolved' as status,
  COUNT(*) as trade_count,
  COUNT(DISTINCT condition_id) as condition_count,
  SUM(realized_pnl_usd) as total_pnl
FROM trades_raw
WHERE lower(wallet_address) = 'holymoses7'
  AND condition_id IN (SELECT condition_id FROM market_resolutions_final)

UNION ALL

SELECT
  wallet_address,
  'unresolved' as status,
  COUNT(*) as trade_count,
  COUNT(DISTINCT condition_id) as condition_count,
  NULL as total_pnl
FROM trades_raw
WHERE lower(wallet_address) = 'holymoses7'
  AND condition_id NOT IN (SELECT condition_id FROM market_resolutions_final);

-- Final P&L from database
SELECT
  wallet_address,
  realized_pnl_usd,
  unrealized_pnl_usd,
  total_pnl_usd
FROM wallet_pnl_summary_v2
WHERE lower(wallet_address) = 'holymoses7';
```

**Analysis:**
- If resolved count is high → Formula has data to work with
- If resolved count is ~0 → Explains why P&L is $0 (no resolutions)
- Compare to expected value → Determine if variance is data gap or formula bug

---

### STEP 3: Timeline Reality Check
**Time:** 30 minutes

```sql
-- Estimate actual backfill time
SELECT
  'Timeline Component' as component,
  'Estimated Hours' as estimate,
  'Notes' as notes

UNION ALL

SELECT 'Raw ingest (159.6M rows)',
  ROUND((159.6 * 1000000 / (8 * 2000000 / 3600)) / 3600, 1),
  '8 workers, 2M rows/sec each'

UNION ALL

SELECT 'Deduplication',
  0.5,
  'Against existing records'

UNION ALL

SELECT 'Direction inference',
  1.0,
  'Buy/sell classification'

UNION ALL

SELECT 'ID normalization',
  0.5,
  'Condition ID cleanup'

UNION ALL

SELECT 'P&L calculation',
  2.0,
  'Including joins to resolutions'

UNION ALL

SELECT 'Wallet metrics',
  1.5,
  'Win rate, Roi, etc'

UNION ALL

SELECT 'Index creation',
  1.0,
  'Performance optimization'

UNION ALL

SELECT 'Validation & testing',
  1.0,
  'Spot checks, data quality'

UNION ALL

SELECT 'TOTAL ESTIMATE',
  ROUND(0.5 + 1.0 + 0.5 + 2.0 + 1.5 + 1.0 + 1.0 + 1.0, 1),
  'Conservative (4-8 hours in practice)';
```

---

## VALIDATION CHECKLIST

Before declaring any claim "verified", check these:

### ✅ Claim #1: 159.6M rows in trades_raw
- [ ] Query returns exactly 159.6M rows
- [ ] Date range spans at least 1 year
- [ ] Wallet count is reasonable (10K-100K)
- [ ] Condition coverage explained (if <5% markets covered)

### ✅ Claim #2: P&L formula 2.05% accurate
- [ ] Define ground truth (Polymarket API or specific expected values)
- [ ] Run formula on 5 random wallets
- [ ] Compare database output to ground truth
- [ ] Document any discrepancies
- [ ] ONLY THEN claim it's "validated"

### ✅ Claim #3: Wallets have zero resolved conditions
- [ ] Clarify which wallets (top 4? specific names?)
- [ ] Query actual resolution coverage per wallet
- [ ] Explain why zero is "expected"
- [ ] Or correct the claim if data shows otherwise

### ✅ Claim #4: 0.08% market coverage
- [ ] Confirm actual coverage percentage
- [ ] Explain the cause (recent data? join bug? other?)
- [ ] Decide if acceptable or needs fixing
- [ ] Document decision clearly

### ✅ Claim #5: 87→18 table consolidation
- [ ] Confirm actual table count (149? 87? other?)
- [ ] Map which 70+ can be deleted
- [ ] Verify no dependencies on deletion targets
- [ ] Test deletion on staging first

### ✅ Claim #6: Omega ratio pending
- [ ] Confirm no omega/sharpe/ratio tables exist
- [ ] Document as "pending feature"
- [ ] Mark as non-blocking for current deployment

### ✅ Claim #7: 2-4 hour backfill
- [ ] Document actual time estimate (likely 4-8 hours)
- [ ] Include all components (prep, ingest, calc, validation)
- [ ] Set realistic SLA for operations

### ✅ Claim #8: Formula breakthrough validated
- [ ] Provide independent verification (API comparison)
- [ ] Show test results from at least 5 wallets
- [ ] Document any caveats (unrealized P&L scope, etc)
- [ ] Or correct the claim if verification fails

---

## GO/NO-GO DECISION

### You CAN proceed IF:
- [ ] Action A1 resolves coverage issue satisfactorily
- [ ] Action A2 validates formula with <5% variance
- [ ] Action A3 defines clear target values
- [ ] Checklist items completed with ✅ marks

### You MUST NOT proceed IF:
- [ ] Coverage remains unexplained at 0.08%
- [ ] Formula validation shows >10% variance
- [ ] Blockers remain unresolved
- [ ] Target values still conflicted

---

## Document Template for Final Sign-Off

Once all actions are complete, use this to document your findings:

```markdown
# VERIFICATION COMPLETE

## Claim #1: trades_raw - 159.6M rows
Status: ✅ VERIFIED
Evidence: [Query result showing exact count]
Variance: [Coverage percentage]
Conclusion: Ready for use

## Claim #2: P&L Formula - 2.05% accurate
Status: ✅ VERIFIED / ❌ FAILED / ⚠️ CONDITIONAL
Evidence: [Comparison to API]
Variance: [Actual variance found]
Conclusion: [Can/cannot proceed]

[Continue for all 8 claims...]

## Overall Decision
Proceed with backfill: YES / NO
Timeline: [Actual estimated hours]
Blockers remaining: [List any]
Next steps: [What to do]
```

---

## How to Read Your Results

Once you run the above, compare against this decision matrix:

| Claim | Data Shows | Action |
|-------|-----------|--------|
| Coverage > 1% | Proceed ✅ | Deploy without changes |
| Coverage 0.1-1% | Investigate | Understand why before deploying |
| Coverage < 0.1% | Blocker 🛑 | Must fix or document limitation |
| P&L variance < 5% | Proceed ✅ | Formula is correct |
| P&L variance 5-10% | Investigate | Is difference unrealized P&L? |
| P&L variance > 10% | Blocker 🛑 | Do not deploy without fix |
| All targets consistent | Proceed ✅ | Deployment ready |
| Targets inconsistent | Blocker 🛑 | Define which is ground truth first |

---

## SUCCESS METRICS

You'll know verification is COMPLETE when:

1. ✅ All queries in Action A1-A3 run without errors
2. ✅ Coverage percentage explained (not left as mystery)
3. ✅ P&L formula compared to external source (API)
4. ✅ Target values consolidated into single accepted value
5. ✅ Timeline realistic and documented
6. ✅ All 8 claims have explicit PASS/FAIL verdict
7. ✅ No unresolved blockers

---

## Time Investment

- **Minimum:** 2 hours (quick verification of key metrics)
- **Recommended:** 4-6 hours (thorough validation)
- **Comprehensive:** 8-12 hours (including API integration test)

**This time investment saves 20-40 hours of debugging after deployment.**

---

**Your next action:** Pick Action A1 and run it NOW. The 0.08% coverage issue must be understood before anything else.
