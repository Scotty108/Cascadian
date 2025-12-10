# Terminal 1 → Terminal 2 Handoff Report

**Date:** 2025-12-07
**Terminal:** Claude 1
**Status:** ✅ COMPLETE

---

## Mission Summary

Terminal 1 executed "Truth Ops" mission to provide clean, coverage-aware truth sources for Terminal 2 PnL validation work.

---

## Artifacts Delivered

### 1. UI PnL Snapshot (Fresh)
**File:** `tmp/ui_pnl_live_snapshot_2025_12_07.json`

**Stats:**
- Total wallets: 50
- Successful: 42 (84%)
- Nonexistent: 8 (16%) - correctly excluded
- Failed: 0 (0%)

**Quality:** 100% success rate on existing profiles. Nonexistent profiles (anon + $0) properly detected and excluded.

**Fetch Time:** ~3m 45s with hardened Playwright fetcher

**Usage:** Primary truth source for UI PnL validation

---

### 2. Dome Realized PnL Snapshot (Small Cohort)
**File:** `tmp/dome_realized_small_20_2025_12_07.json`

**Stats:**
- Total wallets: 20
- Successful: 20 (100%)
- Failed: 0 (0%)

**Quality:** 100% success rate, all wallets have real Dome data (no placeholders)

**Coverage:** Small cohort = moderate activity wallets (500-2000 ledger events)

**Usage:** Secondary truth source for cross-validation

---

### 3. Dome Coverage Report (Small Cohort)
**File:** `tmp/dome_coverage_small_20_2025_12_07_fresh.json`

**Coverage Analysis:**
- High confidence: 20 (100%)
- Low confidence: 0 (0%)
- No confidence: 0 (0%)
- Placeholders: 0 (0%)

**Reliable wallets:** 20/20 (100%)

**Usage:** Confirms all small cohort wallets have reliable Dome data

---

### 4. Merged Dome Truth Map
**File:** `tmp/dome_truth_map_2025_12_07_fresh.json`

**Stats:**
- Total wallets: 40 (20 small + 20 big)
- Reliable: 23 (57.5%)
- Unreliable: 17 (42.5%)

**Source Snapshots:**
- `dome_realized_small_20_2025_12_07` (100% reliable)
- `dome_realized_big_20_2025_12_07` (15% reliable, 85% placeholders)

**Format:**
```json
{
  "metadata": {
    "generated_at": "...",
    "source_snapshots": [...],
    "total_wallets": 40,
    "reliable": 23,
    "unreliable": 17
  },
  "wallets": {
    "0xabc...": {
      "dome_realized": 123.45,
      "dome_confidence": "high",
      "source_snapshot": "..."
    }
  }
}
```

**Usage:** Programmatic coverage gating - filter wallets by `dome_confidence !== 'none'` before validation

---

## Key Findings

### 1. Dome Coverage Gaps
- **Small cohort:** 100% coverage (all reliable)
- **Big cohort (worst divergent):** 15% coverage (85% placeholders)
- **Conclusion:** Dome API has incomplete coverage, especially for high-divergence wallets

### 2. Placeholder Detection Rule
**Signature:** `start_time == 1609459200` (2021-01-01) AND `pnl_to_date == 0`

**Interpretation:** Dome returns placeholder responses for unprocessed wallets

**Implementation:** `lib/pnl/domeClient.ts` detects placeholders and marks `confidence='none'`

### 3. Truth Hierarchy (Unchanged)
1. UI PnL (primary truth)
2. Dome API (secondary, coverage-aware)
3. Cascadian V29 (validation target)

**Rule:** Never validate against `confidence='none'` wallets

---

## Recommended Terminal 2 Workflow

### Step 1: Load Truth Sources
```typescript
import uiSnapshot from './tmp/ui_pnl_live_snapshot_2025_12_07.json';
import domeTruthMap from './tmp/dome_truth_map_2025_12_07_fresh.json';
```

### Step 2: Filter Reliable Wallets
```typescript
const reliableWallets = Object.keys(domeTruthMap.wallets)
  .filter(w => domeTruthMap.wallets[w].dome_confidence !== 'none');

console.log(`Reliable Dome wallets: ${reliableWallets.length}/${Object.keys(domeTruthMap.wallets).length}`);
```

### Step 3: Validate with Coverage Gating
```typescript
for (const wallet of testWallets) {
  const domeData = domeTruthMap.wallets[wallet.toLowerCase()];

  if (!domeData || domeData.dome_confidence === 'none') {
    console.warn(`⚠️  Skipping ${wallet} - no reliable Dome coverage`);
    continue;
  }

  const domeRealized = domeData.dome_realized;
  const cascadianRealized = v29Engine.getRealized(wallet);

  // Compare...
}
```

### Step 4: Use UI PnL as Primary Truth
```typescript
const uiData = uiSnapshot.wallets.find(w => w.wallet === wallet);

if (uiData && uiData.status === 'success') {
  const uiPnl = uiData.pnl;
  // Use UI as primary truth
} else if (domeData && domeData.dome_confidence === 'high') {
  const domePnl = domeData.dome_realized;
  // Fall back to Dome
} else {
  console.warn(`⚠️  No reliable truth for ${wallet}`);
}
```

---

## Tools Available for Terminal 2

### Coverage Classifier
**Script:** `scripts/pnl/classify-dome-coverage.ts`

**Usage:**
```bash
npx tsx scripts/pnl/classify-dome-coverage.ts \
  --snapshot=tmp/dome_realized_COHORT.json \
  --output=tmp/dome_coverage_COHORT.json
```

**Output:** Categorizes wallets as reliable/placeholder/error

---

### Truth Map Builder
**Script:** `scripts/pnl/build-dome-truth-map.ts`

**Usage:**
```bash
npx tsx scripts/pnl/build-dome-truth-map.ts \
  --snapshots=tmp/snapshot1.json,tmp/snapshot2.json \
  --output=tmp/dome_truth_map.json
```

**Output:** Merged truth map for consumption

---

### UI PnL Fetcher
**Script:** `scripts/pnl/fetch-polymarket-profile-pnl.ts`

**Usage:**
```bash
npx tsx scripts/pnl/fetch-polymarket-profile-pnl.ts \
  --wallets-file=tmp/wallets.json \
  --limit=50 \
  --concurrency=2 \
  --headless=true \
  --output=tmp/ui_snapshot.json \
  --nav-timeout-ms=15000 \
  --overall-timeout-ms=25000
```

**Features:**
- Hardened retry logic (exponential backoff + jitter)
- Single browser, multiple contexts
- Anon+$0 detection for nonexistent profiles
- Configurable timeouts

---

### Dome Realized Fetcher
**Script:** `scripts/pnl/fetch-dome-realized-pnl.ts`

**Usage:**
```bash
npx tsx scripts/pnl/fetch-dome-realized-pnl.ts \
  --wallets-file=tmp/wallets.json \
  --limit=20 \
  --concurrency=3 \
  --output=tmp/dome_snapshot.json
```

**Features:**
- Automatic placeholder detection
- Confidence gating (high/low/none)
- In-memory caching

---

## Documentation References

| Topic | Location |
|-------|----------|
| Dome placeholder detection | `docs/reports/DOME_COVERAGE_GATING_2025_12_07.md` |
| Dome truth lock | `docs/reports/DOME_REALIZED_TRUTH_LOCK_2025_12_07.md` |
| UI snapshot system | `docs/reports/UI_TRUTH_V2_LIVE_SNAPSHOT_READY_2025_12_07.md` |
| Dome client implementation | `lib/pnl/domeClient.ts` |

---

## Critical Rules for Terminal 2

1. **Never validate against `confidence='none'` wallets** - they're placeholders
2. **Use UI PnL as primary truth** - Dome is supplementary
3. **Check coverage before validation** - load truth map first
4. **Exclude nonexistent profiles** - UI snapshot already filters these
5. **Trust the small cohort 100%** - all have reliable Dome data

---

## Next Steps for Terminal 2

### Recommended Validation Strategy

1. **Load truth sources** (UI snapshot + Dome truth map)
2. **Filter reliable wallets** (exclude `confidence='none'`)
3. **Run V29 validation** on filtered cohort
4. **Compare against UI PnL** (primary) and Dome (secondary)
5. **Analyze discrepancies** with coverage context

### Suggested Cohorts for Testing

| Cohort | Size | Dome Coverage | Best For |
|--------|------|---------------|----------|
| Small (moderate activity) | 20 | 100% | Baseline validation |
| UI snapshot (trader_strict) | 42 | ~55% | UI parity testing |
| Big (worst divergent) | 20 | 15% | Edge case analysis |

**Recommendation:** Start with small cohort (100% Dome coverage) for clean baseline

---

## Files Ready for Handoff

```bash
# Truth sources
tmp/ui_pnl_live_snapshot_2025_12_07.json              # 42 wallets, UI truth
tmp/dome_truth_map_2025_12_07_fresh.json              # 40 wallets, Dome truth with coverage

# Supporting data
tmp/dome_realized_small_20_2025_12_07.json            # Raw Dome snapshot (small)
tmp/dome_coverage_small_20_2025_12_07_fresh.json      # Coverage report (small)

# Documentation
docs/reports/TERMINAL_1_HANDOFF_2025_12_07.md         # This file
docs/reports/DOME_COVERAGE_GATING_2025_12_07.md       # Coverage system
docs/reports/DOME_REALIZED_TRUTH_LOCK_2025_12_07.md   # Dome definition
```

---

## Terminal 1 Sign-Off

**Mission:** ✅ COMPLETE
**Quality:** ✅ HIGH
**Coverage:** ✅ DOCUMENTED
**Tools:** ✅ READY

**Handoff Status:** Ready for Terminal 2 validation workflows

---

**Generated:** 2025-12-07T01:35 UTC
**Terminal:** Claude 1
**Next Terminal:** Claude 2 (Validation)
