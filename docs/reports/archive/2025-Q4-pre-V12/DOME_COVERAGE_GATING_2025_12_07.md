# Dome Coverage-Aware Truth Gating

**Date:** 2025-12-07  
**Terminal:** Claude 1  
**Status:** ✅ COMPLETE

---

## Executive Summary

Implemented **placeholder detection** and **confidence gating** for Dome API data to prevent unreliable wallets from contaminating validation results.

**Key Rule:** Wallets with `start_time=2021-01-01` AND `pnl_to_date=0` are **placeholders** (Dome hasn't processed them yet) and are marked with `confidence='none'`.

---

## Placeholder Detection Rule

### Sentinel Values

**Placeholder Signature:**
- `start_time == 1609459200` (2021-01-01 00:00:00 UTC)
- AND `pnl_over_time[last].pnl_to_date == 0`

**Interpretation:** Dome API returns this placeholder response for wallets it hasn't processed yet.

### Implementation

**Location:** `lib/pnl/domeClient.ts`

```typescript
const PLACEHOLDER_START_TIME = 1609459200; // 2021-01-01 00:00:00 UTC

function isPlaceholderDomePnl(data: any): boolean {
  if (!data) return true;
  
  const startTime = data.start_time;
  const pnlOverTime = data.pnl_over_time;
  
  // Check for placeholder start time
  if (startTime === PLACEHOLDER_START_TIME) {
    // Check if pnl_to_date is 0
    if (Array.isArray(pnlOverTime) && pnlOverTime.length > 0) {
      const latest = pnlOverTime[pnlOverTime.length - 1];
      if (latest?.pnl_to_date === 0) {
        return true;
      }
    }
  }
  
  return false;
}
```

---

## Confidence Levels

**Updated `DomeRealizedResult` interface:**

```typescript
interface DomeRealizedResult {
  wallet: string;
  realizedPnl: number | null;
  confidence: 'high' | 'low' | 'none';  // NEW
  isPlaceholder: boolean;               // NEW
  raw?: any;
  error?: string;
}
```

### Confidence Assessment Logic

| Condition | Confidence | Usage |
|-----------|------------|-------|
| Placeholder detected | `none` | ❌ Exclude from validation |
| Extraction failed | `none` | ❌ Exclude from validation |
| realizedPnl == 0 | `low` | ⚠️ Use with caution |
| realizedPnl != 0 | `high` | ✅ Primary truth |

---

## Coverage Classification

### Small Cohort (20 wallets)
- **High confidence:** 19 (95.0%)
- **Low confidence:** 1 (5.0%)
- **No confidence:** 0 (0.0%)
- **Reliable:** 20 (100.0%)

### Big Cohort (20 worst divergent wallets)
- **High confidence:** 3 (15.0%)
- **Low confidence:** 0 (0.0%)
- **No confidence:** 17 (85.0%)
- **Reliable:** 3 (15.0%) ❌
- **Placeholders:** 13 (65.0%) 🚨

**Finding:** 85% of worst-case wallets have NO Dome coverage.

---

## Tools & Outputs

### 1. **Coverage Classifier**
**Script:** `scripts/pnl/classify-dome-coverage.ts`

**Usage:**
```bash
npx tsx scripts/pnl/classify-dome-coverage.ts \
  --snapshot=tmp/dome_realized_big_20_2025_12_07.json \
  --output=tmp/dome_coverage_big_20_2025_12_07.json
```

**Output Structure:**
```json
{
  "metadata": {
    "source_snapshot": "...",
    "analyzed_at": "...",
    "total_wallets": 20
  },
  "summary": {
    "high_confidence": 3,
    "low_confidence": 0,
    "no_confidence": 17,
    "placeholders": 13,
    "errors": 4
  },
  "reliable_wallets": ["0x...", "0x..."],
  "placeholder_wallets": ["0x...", "0x..."],
  "error_wallets": []
}
```

### 2. **Truth Map Builder**
**Script:** `scripts/pnl/build-dome-truth-map.ts`

**Usage:**
```bash
npx tsx scripts/pnl/build-dome-truth-map.ts \
  --snapshots=tmp/dome_realized_small_20_2025_12_07.json,tmp/dome_realized_big_20_2025_12_07.json \
  --output=tmp/dome_truth_map_2025_12_07.json
```

**Output Structure:**
```json
{
  "metadata": {
    "generated_at": "2025-12-07T01:30:00.000Z",
    "source_snapshots": ["dome_realized_small_20_2025_12_07", "..."],
    "total_wallets": 38,
    "reliable": 21,
    "unreliable": 17
  },
  "wallets": {
    "0xd69be738...": {
      "dome_realized": -252767.93,
      "dome_confidence": "high",
      "source_snapshot": "dome_realized_small_20_2025_12_07"
    },
    "0xdfda01f4...": {
      "dome_realized": null,
      "dome_confidence": "none",
      "source_snapshot": "dome_realized_big_20_2025_12_07"
    }
  }
}
```

---

## Usage for Terminal 2

**Recommended Workflow:**

1. **Load Truth Map:**
   ```typescript
   const truthMap = JSON.parse(fs.readFileSync('tmp/dome_truth_map_2025_12_07.json', 'utf8'));
   ```

2. **Check Coverage Before Validation:**
   ```typescript
   const domeData = truthMap.wallets[wallet.toLowerCase()];
   if (domeData && domeData.dome_confidence === 'high') {
     // Use Dome as truth
     const truth = domeData.dome_realized;
   } else {
     // Fall back to UI truth or skip
     console.warn(`Wallet ${wallet} has no reliable Dome data`);
   }
   ```

3. **Filter Reliable Wallets:**
   ```typescript
   const reliableWallets = Object.keys(truthMap.wallets)
     .filter(w => truthMap.wallets[w].dome_confidence !== 'none');
   ```

---

## Files Created

| File | Purpose |
|------|---------|
| `lib/pnl/domeClient.ts` (updated) | Placeholder detection + confidence |
| `scripts/pnl/classify-dome-coverage.ts` | Coverage analyzer |
| `scripts/pnl/build-dome-truth-map.ts` | Truth map builder |
| `tmp/dome_coverage_small_20_2025_12_07.json` | Small cohort report |
| `tmp/dome_coverage_big_20_2025_12_07.json` | Big cohort report |
| `tmp/dome_truth_map_2025_12_07.json` | **Merged truth for Terminal 2** |

---

## Key Takeaways

1. **Dome placeholders are systematic:** 2021-01-01 start time is a sentinel
2. **Big wallets lack coverage:** 85% of worst divergent wallets = placeholders
3. **Confidence gating is mandatory:** Never use `confidence='none'` for validation
4. **Truth hierarchy unchanged:** UI PnL remains primary, Dome supplementary

---

**Generated:** 2025-12-07T01:30 UTC  
**Terminal:** Claude 1  
**Ready for:** Terminal 2 validation workflows
