# C1 Operational Runbook: External Trade Coverage Updates

**Owner:** C1
**Last Updated:** 2025-11-15
**Status:** ACTIVE

---

## Purpose

This runbook documents C1's operational workflow for responding to new external trade coverage reported by C2. The P&L and Omega system is designed to remain stable as pm_trades_complete gains more external trades over time.

---

## Core Principle

**pm_trades_complete is a black box**

- Do NOT modify schema
- Do NOT change source policy
- Do NOT alter P&L math
- ONLY read from it via existing views

---

## Trigger Event

**C2 reports:** "New external trade coverage available for wallet(s) X, Y, Z"

---

## Standard Response Workflow

### Step 1: Generate Fresh Snapshots

Run snapshot script for affected wallets:

```bash
# Single wallet
npx tsx scripts/127-snapshot-wallet-pnl.ts \
  --wallet cce2b7c71f21e358b8e5e797e586cbc03160d58b

# Top 10 by P&L
npx tsx scripts/127-snapshot-wallet-pnl.ts \
  --top 10 --by pnl

# Top 10 by volume
npx tsx scripts/127-snapshot-wallet-pnl.ts \
  --top 10 --by volume

# Named test set
npx tsx scripts/127-snapshot-wallet-pnl.ts \
  --wallet-list cce2b7c71f21e358b8e5e797e586cbc03160d58b,dome,mg
```

**Output:** `reports/PNL_SNAPSHOT_*_YYYY-MM-DD.md`

---

### Step 2: Generate Before/After Diff

Compare new snapshot to baseline:

```bash
# Compare to baseline snapshot
npx tsx scripts/128-diff-wallet-pnl.ts \
  --wallet cce2b7c71f21e358b8e5e797e586cbc03160d58b \
  --baseline reports/PNL_SNAPSHOT_baseline_2025-11-15.md

# Or compare to baseline by date
npx tsx scripts/128-diff-wallet-pnl.ts \
  --wallet cce2b7c71f21e358b8e5e797e586cbc03160d58b \
  --baseline-date 2025-11-15

# Or compare two specific snapshots
npx tsx scripts/128-diff-wallet-pnl.ts \
  --before reports/PNL_SNAPSHOT_before_2025-11-15.md \
  --after reports/PNL_SNAPSHOT_after_2025-11-16.md
```

**Output:** `reports/PNL_DIFF_*_YYYY-MM-DD.md`

---

### Step 3: Regenerate Leaderboards

Update whale and omega leaderboards:

```bash
# Regenerate both leaderboards
npx tsx scripts/136-generate-leaderboard-reports-simple.ts
```

**Output:**
- `WHALE_LEADERBOARD.md`
- `OMEGA_LEADERBOARD.md`

---

### Step 4: Review Diff Reports

Check diff reports for expected changes:

**Expected:**
- ✅ Markets increased (new ghost markets)
- ✅ Trades increased (new external trades)
- ✅ P&L increased (positive from new positions)
- ✅ External % increased (more external coverage)

**Unexpected (escalate to supervisor):**
- ❌ P&L decreased unexpectedly
- ❌ Markets decreased
- ❌ Negative Omega changes
- ❌ Win rate drops significantly

---

### Step 5: Archive Reports

Move reports to timestamped archive:

```bash
mkdir -p reports/archive/$(date +%Y-%m-%d)
mv reports/PNL_SNAPSHOT_*.md reports/archive/$(date +%Y-%m-%d)/
mv reports/PNL_DIFF_*.md reports/archive/$(date +%Y-%m-%d)/
```

---

## Standard Test Wallet Set

Maintain consistent test set for before/after comparisons:

1. **cce2b7c71f21e358b8e5e797e586cbc03160d58b** - xcnstrategy (external trades)
2. **Top 5 by P&L** - High-volume whales
3. **Top 5 by Omega** - Best risk-adjusted performers

**Snapshot command:**
```bash
# Generate full test set
npx tsx scripts/127-snapshot-wallet-pnl.ts --top 5 --by pnl
npx tsx scripts/127-snapshot-wallet-pnl.ts --wallet cce2b7c71f21e358b8e5e797e586cbc03160d58b
npx tsx scripts/136-generate-leaderboard-reports-simple.ts
```

---

## Success Criteria

After processing new coverage, verify:

- [ ] All snapshots generated without errors
- [ ] Diff reports show expected changes
- [ ] Leaderboards updated successfully
- [ ] No schema changes needed
- [ ] No math changes needed
- [ ] pm_trades_complete remains black box

---

## Escalation

**Escalate to supervisor if:**

1. Unexpected P&L changes (>10% variance from C2's reported impact)
2. Schema changes required
3. Math formula changes needed
4. Data quality issues (negative shares, invalid prices, etc.)
5. Query failures or performance degradation

---

## Scripts Reference

| Script | Purpose | Key Modes |
|--------|---------|-----------|
| `127-snapshot-wallet-pnl.ts` | Generate P&L snapshots | --wallet, --top N, --wallet-list |
| `128-diff-wallet-pnl.ts` | Compare snapshots | --baseline, --before/--after |
| `136-generate-leaderboard-reports-simple.ts` | Regenerate leaderboards | (no args) |

---

## View Chain (READ ONLY)

```
pm_trades_complete (black box)
    ↓
pm_wallet_market_pnl_resolved
    ↓
pm_wallet_market_omega
    ↓
pm_wallet_omega_stats
    ↓
Snapshots & Leaderboards
```

**DO NOT modify any views in this chain without supervisor approval.**

---

## File Locations

**Snapshots:** `reports/PNL_SNAPSHOT_*_YYYY-MM-DD.md`
**Diffs:** `reports/PNL_DIFF_*_YYYY-MM-DD.md`
**Leaderboards:** `WHALE_LEADERBOARD.md`, `OMEGA_LEADERBOARD.md`
**Archive:** `reports/archive/YYYY-MM-DD/`

---

## Example Workflow

```bash
# 1. C2 reports new coverage for xcnstrategy
echo "C2: New external trades added for wallet cce2b7c71f21e358b8e5e797e586cbc03160d58b"

# 2. Generate new snapshot
npx tsx scripts/127-snapshot-wallet-pnl.ts \
  --wallet cce2b7c71f21e358b8e5e797e586cbc03160d58b

# 3. Compare to baseline (from yesterday)
npx tsx scripts/128-diff-wallet-pnl.ts \
  --wallet cce2b7c71f21e358b8e5e797e586cbc03160d58b \
  --baseline-date 2025-11-15

# 4. Review diff report
cat reports/PNL_DIFF_cce2b7c71f21e358b8e5e797e586cbc03160d58b_2025-11-16.md

# 5. Regenerate leaderboards
npx tsx scripts/136-generate-leaderboard-reports-simple.ts

# 6. Archive reports
mkdir -p reports/archive/2025-11-16
mv reports/PNL_*.md reports/archive/2025-11-16/

# 7. Report completion to supervisor
echo "✅ Coverage update processed successfully"
```

---

## Monitoring Metrics

Track these metrics over time:

- **External coverage %** - Should increase as C2 adds data
- **Ghost markets** - New markets appearing in external trades
- **P&L impact** - Expected gains from new coverage
- **Query performance** - Should remain stable

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-11-15 | Initial runbook created |

---

**Signed:** Claude 1 (C1)
**Date:** 2025-11-15 (PST)
