# HolyMoses7 P&L Gap: Breakthrough Strategy

## The Core Problem (Restated)

| Metric | Value | Status |
|--------|-------|--------|
| Database calc (snapshot) | $61,921.44 | Current |
| UI Target | $89,975.16 | Ground truth |
| Closed trades file | $109,168.40 | Question: When exported? |
| Gap | -$28,053.72 (-31.2%) | **ROOT CAUSE: File date unknown** |

---

## Non-Destructive Breakthrough Tests

### **Breakthrough #1: File Metadata Analysis (2 min)**

Instead of guessing the export date, extract it from the file itself:

```bash
# Check file creation/modification dates
ls -la HolyMoses7_closed_trades.md
stat HolyMoses7_closed_trades.md

# Check if file has any embedded date metadata
head -20 HolyMoses7_closed_trades.md | grep -i "date\|export\|snapshot\|as of"
tail -20 HolyMoses7_closed_trades.md | grep -i "date\|total\|summary"
```

**This will tell us if the file was exported today or on 2025-10-31.**

---

### **Breakthrough #2: Daily P&L Velocity Analysis (5 min)**

If the file is from 2025-11-06, the overage should decompose into daily tranches:

```sql
-- Check if there are 6 days worth of trades (Nov 1-6) post-snapshot
SELECT
  DATE(created_at) as trade_date,
  count() as num_trades,
  sum(realized_pnl_usd) as daily_pnl
FROM trades_enriched_with_condition
WHERE wallet_address = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'
  AND created_at > '2025-10-31 23:59:59'
  AND created_at <= '2025-11-06 23:59:59'
  AND is_resolved = 1
GROUP BY DATE(created_at)
ORDER BY trade_date DESC
```

**Expected:** 6 rows (Nov 1, 2, 3, 4, 5, 6) summing to ~$19k overage

If this shows ~$3,200/day, that validates the "file is from today" hypothesis.

---

### **Breakthrough #3: Snapshot-Exact Query (5 min)**

Run this to get the EXACT P&L at the snapshot moment:

```sql
SELECT
  'At Snapshot (2025-10-31 23:59:59)' as period,
  sum(realized_pnl_usd) as realized_pnl,
  (SELECT sum(unrealized_pnl_usd) 
   FROM wallet_unrealized_pnl_v2 
   WHERE wallet = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8') as unrealized_pnl,
  realized_pnl + unrealized_pnl as total_pnl
FROM trades_enriched_with_condition
WHERE wallet_address = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'
  AND created_at <= '2025-10-31 23:59:59'
  AND is_resolved = 1
  
UNION ALL

SELECT
  'Today (2025-11-06)' as period,
  sum(realized_pnl_usd) as realized_pnl,
  (SELECT sum(unrealized_pnl_usd) 
   FROM wallet_unrealized_pnl_v2 
   WHERE wallet = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8') as unrealized_pnl,
  realized_pnl + unrealized_pnl as total_pnl
FROM trades_enriched_with_condition
WHERE wallet_address = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'
  AND is_resolved = 1
```

**This will show:**
- Snapshot P&L (should be ~$89,975 if file is from today)
- Today's P&L (should be ~$109,168 matching file)
- The gap should map exactly to Nov 1-6 trades

---

### **Breakthrough #4: Settlement Mechanics for Pure Shorts (10 min)**

HolyMoses7 is 99.7% short. Test if shorts settle differently:

```sql
SELECT
  'Long positions' as position_type,
  count() as num_positions,
  sum(realized_pnl_usd) as total_pnl,
  round(sum(realized_pnl_usd) / count(), 2) as avg_pnl_per_position,
  countIf(realized_pnl_usd > 0) as winning
FROM trades_enriched_with_condition
WHERE wallet_address = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'
  AND side = 'BUY'
  AND created_at <= '2025-10-31 23:59:59'
  AND is_resolved = 1

UNION ALL

SELECT
  'Short positions' as position_type,
  count() as num_positions,
  sum(realized_pnl_usd) as total_pnl,
  round(sum(realized_pnl_usd) / count(), 2) as avg_pnl_per_position,
  countIf(realized_pnl_usd > 0) as winning
FROM trades_enriched_with_condition
WHERE wallet_address = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'
  AND side = 'SELL'
  AND created_at <= '2025-10-31 23:59:59'
  AND is_resolved = 1
```

**If shorts have systematically different P&L per position, that's the formula bug.**

---

## Recommended Sequence for Main Agent

**Step 1 (1 min):** Run Breakthrough #1 → Get file metadata
- If shows "Nov 6" → Go to Step 2a
- If shows "Oct 31" → Go to Step 2b

**Step 2a (5 min):** Run Breakthrough #2 → Daily P&L velocity
- Confirm 6 days of post-snapshot trades
- Verify $3,200/day pattern
- **Conclusion:** Gap explained, reconciliation complete ✅

**Step 2b (10 min):** Run Breakthrough #3 → Snapshot-exact queries
- If snapshot query shows $89,975 → File was exported on Oct 31, gap is data completeness
- If snapshot query shows $61,921 → File is newer, matches current state

**Step 3 (if gap remains):** Run Breakthrough #4 → Short settlement check
- Test if shorts have different settlement rules
- Look for systematic P&L/position differences

---

## Why This Works

1. **File metadata** answers the "when" question in 1 minute
2. **Daily velocity** validates the hypothesis across 6 days of data
3. **Snapshot queries** prove what P&L SHOULD be at the exact moment
4. **Short settlement** catches any edge case formula bugs for pure short portfolios

**Total time to resolution: 15-25 minutes**

---

## Expected Outcomes

| Test | Pass | Fail |
|------|------|------|
| File is from Nov 6 | Gap explained, done ✅ | File is from Oct 31, continue |
| Daily velocity shows $3.2k/day | Gap explained, done ✅ | File timing unclear, investigate |
| Snapshot query matches target | Reconciliation complete ✅ | Formula bug detected, fix needed |
| Shorts settle normally | No edge cases ✅ | Short settlement rule found, apply |

---

## If All Tests Pass

**Conclusion:** HolyMoses7 file is from today (Nov 6), snapshot was Oct 31, database calculation is correct at the snapshot moment. The $28k gap is legitimate post-snapshot trading activity.

**Action:** Document that snapshots are date-sensitive, apply same methodology to production.

