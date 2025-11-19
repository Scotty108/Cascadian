# Phase 2: Direct Action Memo
**From:** Secondary Claude (Research Complete)
**To:** Main Claude
**Status:** Ready to Implement
**Time to Resolution:** 15-30 minutes

---

## The Issue (In One Sentence)

Your settlement join condition is **off by one**: you're checking `trade_idx = win_idx` when you should check `trade_idx = win_idx + 1`.

---

## The Fix (Copy-Paste Ready)

**File:** `/scripts/realized-pnl-corrected.sql`

**Current (BROKEN) - Lines 105-117:**
```sql
round(
  sum(tf.cashflow_usdc) +
  sumIf(
    tf.delta_shares,
    coalesce(
      tf.trade_idx,
      multiIf(
        upperUTF8(tf.outcome_raw) = 'YES', 1,
        upperUTF8(tf.outcome_raw) = 'NO', 0,
        NULL
      )
    ) = wi.win_idx  -- ❌ THIS LINE IS WRONG
  ),
  8
)
```

**New (CORRECT):**
```sql
round(
  sum(tf.cashflow_usdc) +
  sumIf(
    tf.delta_shares,
    coalesce(
      tf.trade_idx,
      multiIf(
        upperUTF8(tf.outcome_raw) = 'YES', 1,
        upperUTF8(tf.outcome_raw) = 'NO', 0,
        NULL
      )
    ) = wi.win_idx + 1  -- ✅ ADD "+ 1" HERE
  ),
  8
)
```

---

## Why This Works

From Phase 1A diagnostic we proved:
- **98.38% of trades** have `trade_idx = win_idx + 1` (off by one)
- **1.62% of trades** have `trade_idx = win_idx` (exact match)

Your current formula matches the 1.62%, getting settlement contribution near zero, leaving only cashflows ($3.69M). Adding the +1 fixes the join to match the 98%.

---

## Expected Result After Fix

```
BEFORE FIX:
  niggemon: $1,900,000 (19x inflation) ❌

AFTER FIX:
  niggemon: ~$102,001 (matches Polymarket profile) ✅
  HolyMoses7: ~$90,000 (matches Polymarket profile) ✅

Variance: ±15% is acceptable
Confidence: Very High (85%+)
```

---

## How to Implement

### Option 1: Quick Test (15 min)

1. **Edit the file:**
   ```bash
   cd /Users/scotty/Projects/Cascadian-app
   # Edit scripts/realized-pnl-corrected.sql line 116
   # Change: ) = wi.win_idx
   # To:     ) = wi.win_idx + 1
   ```

2. **Create test script** (I'll do this for you below)

3. **Run and verify:** Execute the updated SQL against niggemon

4. **If result is $90K-$110K:** SUCCESS, proceed to Phase 3
5. **If result is still $1.9M:** Fall back to Option 2 (below)

### Option 2: Robust Implementation (if Option 1 doesn't work)

Use the proven formula from `VERIFIED_CORRECT_PNL_APPROACH.md` which:
- Starts from `trades_raw` (source of truth)
- Implements side-aware cashflow calculation
- Uses `market_resolutions_final` for winners
- Produces $99,691 (-2.3% variance) in documented tests

See `PHASE_2_RESEARCH_REPORT.md` Section "The Correct Fix" for implementation template.

---

## Quick Validation Test

I'll create a script that you can run immediately after making the change:

Create `/Users/scotty/Projects/Cascadian-app/test-offset-fix.ts`:

```typescript
/**
 * PHASE 2: Test the +1 offset fix
 *
 * This script validates that changing the settlement condition from
 * trade_idx = win_idx to trade_idx = win_idx + 1 produces expected results
 */

import { client } from '../lib/clickhouse/client';

async function testOffsetFix() {
  console.log('═'.repeat(80));
  console.log('PHASE 2: Testing +1 Offset Fix');
  console.log('═'.repeat(80));

  const testWallets = [
    { address: '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0', name: 'niggemon', expected: 102001 },
    { address: '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8', name: 'HolyMoses7', expected: 90000 },
  ];

  try {
    for (const wallet of testWallets) {
      console.log(`\nTesting ${wallet.name}:`);
      console.log(`  Expected: $${wallet.expected.toLocaleString()}`);

      // Execute the corrected SQL view
      const result = await client.query({
        query: `
          SELECT
            wallet,
            realized_pnl_usd,
            ROUND(ABS(realized_pnl_usd - ${wallet.expected}) / ${wallet.expected} * 100, 2) AS variance_pct
          FROM wallet_realized_pnl_v2
          WHERE wallet = lower('${wallet.address}')
        `
      });

      if (result.data.length > 0) {
        const r = result.data[0];
        const actual = r.realized_pnl_usd || 0;
        const variance = ((actual - wallet.expected) / wallet.expected * 100).toFixed(2);

        console.log(`  Actual:   $${actual.toLocaleString()}`);
        console.log(`  Variance: ${variance}%`);

        if (Math.abs(parseFloat(variance)) < 20) {
          console.log(`  Status:   ✅ PASS (within 20% tolerance)`);
        } else {
          console.log(`  Status:   ❌ FAIL (variance too high)`);
        }
      } else {
        console.log(`  Status:   ❌ NO DATA`);
      }
    }

    console.log('\n' + '═'.repeat(80));
    console.log('Summary:');
    console.log('- If both wallets are PASS: Proceed to Phase 3');
    console.log('- If either FAIL: Check that the +1 change was saved');
    console.log('═'.repeat(80));

  } catch (error) {
    console.error('Error during test:', error);
    process.exit(1);
  }
}

testOffsetFix();
```

---

## Step-by-Step Execution

1. **Make the change to SQL file:** (2 min)
   - Open `scripts/realized-pnl-corrected.sql`
   - Find line 116 (the settlement sumIf condition)
   - Change `= wi.win_idx` to `= wi.win_idx + 1`
   - Save the file

2. **Execute the updated SQL:** (5 min)
   - This is a view, so you'll need to run it to recreate the view
   - Then create/run a test query against wallet_realized_pnl_v2

3. **Run the test script:** (5 min)
   - Run: `npx tsx test-offset-fix.ts`
   - Should show niggemon ≈ $102K

4. **If test passes:** Celebrate, move to Phase 3 (unrealized P&L)
5. **If test fails:** Let me know, we'll implement Option 2 (proven formula approach)

---

## Why We're Confident This Will Work

| Factor | Evidence |
|--------|----------|
| **Data-driven** | Phase 1A diagnostic proved 98% of trades have +1 offset |
| **Consistent** | 30+ validation scripts reference same expected values |
| **Documented** | VERIFIED_CORRECT_PNL_APPROACH.md proves the formula works |
| **Specific** | This is the exact condition causing settlement match failure |
| **Low risk** | One-line change to a view, easy to revert if needed |

---

## Checklist Before You Start

- [ ] Read this memo
- [ ] Read `PHASE_2_RESEARCH_REPORT.md` (detailed evidence)
- [ ] Have `scripts/realized-pnl-corrected.sql` open
- [ ] Know where line 116 is (the settlement condition)
- [ ] Ready to make the change

---

## If This Doesn't Work (Fallback Plan)

If the +1 fix doesn't produce results in the $90K-$110K range:

1. **Don't panic.** The offset theory is still sound based on the diagnostic evidence.
2. **Document what you got:** Note exact values for both wallets
3. **Escalate with data:** Show me the results, we'll investigate why +1 didn't fully solve it
4. **Plan B ready:** I have a complete alternate implementation ready to go using the proven formula from `VERIFIED_CORRECT_PNL_APPROACH.md`

---

## Timeline

- **If +1 fix works (90% probability):** 15 min to validate, then Phase 3
- **If +1 fix doesn't work (10% probability):** 2-3 hours for full rewrite using proven formula
- **Overall:** Phase 2 complete by end of session regardless

---

**You've got this. The root cause is identified. The fix is a one-line change. Execute.**
