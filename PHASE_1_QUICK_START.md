# Phase 1 Quick Start: Backfill Missing Trades

**Objective:** Import Oct 31 - Nov 6 trades to make LucasMeow & xcnstrategy visible
**Timeline:** 2-3 hours
**Current Step:** START HERE

---

## Step 1: Verify Source Data Exists (5 min)

Check if Oct 31 - Nov 6 trades are available in trades_raw:

```bash
# Login to ClickHouse (adjust URL/credentials as needed)
clickhouse-client --host igm38nvzub.us-central1.gcp.clickhouse.cloud \
  --user default \
  --password <your_password> \
  --secure \
  --port 9440
```

Once logged in, run:
```sql
SELECT
  COUNT(*) as trade_count,
  MIN(timestamp) as earliest,
  MAX(timestamp) as latest,
  COUNT(DISTINCT wallet) as affected_wallets
FROM trades_raw
WHERE timestamp > 1730419199;  -- Oct 31 23:59:59
```

**Expected output:**
- Should show thousands of trades
- latest timestamp should be after 2025-11-06
- affected_wallets should be in thousands

**If result is 0 rows:**
- Block: Data import script never ran post-Oct 31
- Action: Check `/scripts/ingest-clob-fills.ts` and `/scripts/ingest-erc1155-transfers.ts`
- Contact: Blockchain data import maintainer

---

## Step 2: Rebuild outcome_positions_v2 (30-45 min)

Find the position-building script:

```bash
# List available scripts
ls -la scripts/ | grep -E "(position|outcome|build)"
```

Look for files like:
- `build-positions-from-erc1155.ts`
- `build-outcome-positions-canonical.ts`
- `build-positions.ts`

**Most likely candidate:**
```bash
npx tsx scripts/build-positions-from-erc1155.ts
```

**If that script doesn't exist,** try:
```bash
# Search for outcome_positions_v2 creation
grep -r "outcome_positions_v2" scripts/
```

**Run with no date cutoff (capture ALL data):**
```bash
npx tsx scripts/build-positions-from-erc1155.ts --no-cutoff
# OR
npx tsx scripts/build-positions-from-erc1155.ts --date-min=0
# OR (if neither works, check script docs)
npx tsx scripts/build-positions-from-erc1155.ts
```

**Expected:** Script runs 10-15 minutes, rebuilds outcome_positions_v2 table

**Verification:**
```bash
# After script completes, check row count increased
echo "SELECT COUNT(*) FROM outcome_positions_v2" | clickhouse-client [connection-flags]
```

---

## Step 3: Rebuild trade_cashflows_v3 (30-45 min)

Similarly for cashflows:

```bash
# Find the script
ls -la scripts/ | grep -E "(cashflow|ingest)"
```

Most likely:
```bash
npx tsx scripts/build-trade-cashflows-canonical.ts
# OR
npx tsx scripts/ingest-cashflows.ts
```

**Run it:**
```bash
npx tsx scripts/build-trade-cashflows-canonical.ts --no-cutoff
```

**Verification:**
```bash
echo "SELECT COUNT(*) FROM trade_cashflows_v3" | clickhouse-client [connection-flags]
```

---

## Step 4: Verify All Priority 1 Wallets Present (5 min)

After both scripts complete, verify all 4 core wallets are now in the database:

```sql
-- Check all Priority 1 wallets
SELECT wallet, COUNT(*) as row_count
FROM outcome_positions_v2
WHERE wallet IN (
  lower('0x7f3c8979d0afa00007bae4747d5347122af05613'),  -- LucasMeow
  lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'),  -- xcnstrategy
  lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'),  -- HolyMoses7
  lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')   -- niggemon
)
GROUP BY wallet
ORDER BY wallet;
```

**Success criteria:**
- LucasMeow: Should show > 0 rows (was 0 before)
- xcnstrategy: Should show > 0 rows (was 0 before)
- HolyMoses7: Should show > 0 rows
- niggemon: Should show > 0 rows (was already present)

**Expected output:**
```
0x1489... | 1000+
0x7f3c... | 1000+
0xa4b3... | 1000+
0xeb6f... | 1000+
```

**GATE RULE:** If ANY wallet shows 0 rows, Phase 1 backfill FAILED. Stop and troubleshoot before proceeding.

**If any shows 0 rows:**
- Backfill scripts didn't capture the data
- Check: Do these wallets have any trades in trades_raw at all?
- Query: `SELECT COUNT(*) FROM trades_raw WHERE wallet IN ('0x7f3c...', '0xcce2...')`
- If zero there too: Data import pipeline never included these wallets (investigate blockchain importer)

---

## Troubleshooting

### Script not found
```bash
# Search for all build scripts
find scripts -name "*.ts" | grep -i build | head -20
```

### Script fails with error
- Check: Is ClickHouse connection working? (`clickhouse-client --version`)
- Check: Environment variables set? (`echo $CLICKHOUSE_PASSWORD`)
- Check: Disk space available? (`df -h`)
- Check: ClickHouse service running? (provider status page)

### Still seeing 0 rows after rebuild
1. Verify trades_raw HAS the data: `SELECT COUNT(*) FROM trades_raw WHERE timestamp > 1730419199`
2. Check script output for errors (scroll up)
3. Verify wallet addresses are formatted correctly (lowercase, with 0x)

---

## When Phase 1 Complete

Reply with:
```
Phase 1 Complete:
- LucasMeow row count: [N]
- xcnstrategy row count: [N]
- HolyMoses7 row count: [N]
- niggemon row count: [N]
- Any errors: [None/describe]
```

**GATE CHECK:** If ALL four wallets show > 0 rows, Phase 1 PASSED ✅

If ANY wallet shows 0 rows, Phase 1 FAILED ❌ - Stop and troubleshoot before proceeding.

---

## After Phase 1 Success

**Phase 4 Validation:** Once all phases 1-3 complete, we'll run a comprehensive validation using the test suite in:
- **VALIDATION_TEST_SUITE.md** - Extended wallet validation with 10+ reference traders

This test suite ensures your P&L calculations work correctly across diverse wallet types and P&L ranges.

Then we proceed to **Phase 2: Daily Sync** (30 min setup, runs automatically after that)

---

## If Stuck

- Show me the error message from the script
- Show me the output of: `SELECT COUNT(*) FROM trades_raw WHERE timestamp > 1730419199`
- Check: Which scripts exist in `/scripts` that mention outcome, position, or cashflow?

I'll guide step-by-step from there.

**Next action:** Run Step 1 verification. Post results. 🚀
