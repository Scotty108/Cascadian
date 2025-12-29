# Validated Wallets Export Guide

**Date**: 2025-12-15
**Script**: `scripts/pnl/export-validated-wallets.ts`
**Purpose**: Create defensible export of UI parity validated wallets

---

## Quick Start

```bash
# 1. Run UI parity validation to create input data
npx tsx scripts/pnl/[your-ui-parity-test-script].ts

# 2. Export validated wallets
npx tsx scripts/pnl/export-validated-wallets.ts

# 3. Find outputs in data/ directory
ls -lh data/validated-wallets.*
```

---

## What This Does

The export script reads UI parity test results and filters to only wallets that:

1. **Status = PASS**: Wallet passed UI parity validation
2. **Mapping >= 99.5%**: At least 99.5% of CLOB data was successfully mapped
3. **Clamp <= 2%**: No more than 2% of values were clamped/adjusted

This creates a **defensible export** of wallets that meet strict quality criteria.

---

## Output Files

### 1. CSV Export: `data/validated-wallets.csv`

**Use case**: Excel analysis, spreadsheet sharing, human review

**Columns**:
- `wallet_address` - Ethereum address
- `v20b_ui_parity_status` - Validation status
- `ui_net` - Polymarket UI total PnL
- `ui_gain` - UI total gains
- `ui_loss` - UI total losses
- `ui_volume` - UI trading volume
- `v20b_net` - V20b engine total PnL
- `delta_abs` - Absolute difference (UI - V20b)
- `delta_pct` - Percentage difference
- `clamp_pct` - % of clamped values
- `mapped_clob_rows` - CLOB rows successfully mapped
- `markets` - Number of markets traded

**Example**:
```csv
wallet_address,v20b_ui_parity_status,ui_net,ui_gain,ui_loss,ui_volume,v20b_net,delta_abs,delta_pct,...
"0x56687bf447db6ffa42ffe2204a05edaa20f55839","PASS","22053934.00","25000000.00","-2946066.00",...
```

### 2. JSON Export: `data/validated-wallets.json`

**Use case**: Programmatic processing, API integration, audit trail

**Structure**:
```json
{
  "exported_at": "2025-12-15T...",
  "criteria": {
    "min_mapping_pct": 99.5,
    "max_clamp_pct": 2.0
  },
  "summary": {
    "total_candidates": 50,
    "passed": 35,
    "failed": 15,
    "pass_rate": 0.7,
    "avg_delta_pct": 0.037
  },
  "fail_reasons": {
    "CLAMP_PCT_TOO_HIGH": 8,
    "MAPPING_PCT_TOO_LOW": 7
  },
  "validated_wallets": [
    {
      "wallet": "0x...",
      "status": "PASS",
      "ui_net": 22053934,
      "v20b_net": 22050000,
      "delta_pct": 0.0178,
      ...
    }
  ]
}
```

---

## Summary Statistics

The script provides detailed statistics:

```
Total candidates tested:     50
Passed (eligible):           35 (70.0%)
Failed (ineligible):         15 (30.0%)

Average delta % (passed):    0.0370%

Failed count by reason:
  CLAMP_PCT_TOO_HIGH                 8 (16.0%)
  MAPPING_PCT_TOO_LOW                7 (14.0%)
```

---

## Validation Criteria

### Default Thresholds

| Criterion | Threshold | Rationale |
|-----------|-----------|-----------|
| **Status** | PASS | Must pass UI parity validation |
| **Mapping %** | >= 99.5% | Ensures nearly complete data coverage |
| **Clamp %** | <= 2% | Limits data adjustments/approximations |

### Why These Criteria?

- **99.5% mapping**: Ensures we're not missing significant CLOB activity
- **2% clamp**: Allows minor edge case handling without compromising accuracy
- **PASS status**: Wallet must meet all other parity checks

These criteria create a **high-confidence subset** suitable for:
- Production deployments
- Public-facing leaderboards
- Copy trading features
- Customer-facing analytics

---

## Common Failure Reasons

| Reason | Meaning | Impact |
|--------|---------|--------|
| `CLAMP_PCT_TOO_HIGH` | Too many clamped/adjusted values | Data quality concerns |
| `MAPPING_PCT_TOO_LOW` | Incomplete CLOB data mapping | Missing activity |
| `FAIL` (generic) | Failed UI parity validation | PnL mismatch with UI |
| `SIGN_MISMATCH` | Opposite sign (profit vs loss) | Fundamental calculation error |

---

## Use Cases

### 1. Production Leaderboard
```bash
# Export validated wallets
npx tsx scripts/pnl/export-validated-wallets.ts

# Load into production database
# Use validated-wallets.csv for bulk import
```

### 2. Copy Trading Whitelist
```typescript
// Read validated wallets
const validatedData = JSON.parse(
  fs.readFileSync('data/validated-wallets.json', 'utf-8')
);

// Extract wallet addresses
const whitelistedWallets = validatedData.validated_wallets
  .map(w => w.wallet);
```

### 3. Audit Trail
```bash
# Archive with timestamp
cp data/validated-wallets.json \
   archive/validated-wallets-$(date +%Y%m%d).json

# Commit to version control
git add data/validated-wallets.*
git commit -m "chore: export validated wallets $(date +%Y-%m-%d)"
```

---

## Customizing Criteria

To adjust thresholds, edit `scripts/pnl/export-validated-wallets.ts`:

```typescript
const DEFAULT_CRITERIA: ValidationCriteria = {
  min_mapping_pct: 99.5,  // Increase for stricter filtering
  max_clamp_pct: 2.0,     // Decrease for higher quality
};
```

**Recommendation**: Keep defaults unless you have specific requirements.

---

## Workflow Integration

### Step 1: Generate UI Parity Results
```bash
# Run comprehensive validation
npx tsx scripts/pnl/comprehensive-v20-accuracy-test.ts

# This creates /tmp/v20-comprehensive-test-results.json
# Move to data directory
cp /tmp/v20-comprehensive-test-results.json data/ui-parity-results.json
```

### Step 2: Export Validated Wallets
```bash
npx tsx scripts/pnl/export-validated-wallets.ts
```

### Step 3: Review and Deploy
```bash
# Review CSV in spreadsheet
open data/validated-wallets.csv

# Check JSON summary
cat data/validated-wallets.json | jq '.summary'

# Deploy to production
# (use your deployment process)
```

---

## Error Handling

### Input File Not Found
```
❌ Input file not found: data/ui-parity-results.json
```
**Solution**: Run UI parity test script first

### No Wallets Passed
```
⚠️  No wallets passed validation criteria!
```
**Solution**: Review criteria thresholds or improve data quality

### Invalid JSON Format
```
❌ Invalid input format: missing "results" array
```
**Solution**: Ensure input file has correct structure

---

## Best Practices

1. **Version Control**: Commit both CSV and JSON to git for audit trail
2. **Timestamps**: Use exported_at field to track when data was generated
3. **Archive**: Keep historical exports for comparison
4. **Document Changes**: If criteria change, document in commit message
5. **Validate Outputs**: Spot-check CSV/JSON against source data

---

## File Locations

| File | Location | Purpose |
|------|----------|---------|
| Script | `scripts/pnl/export-validated-wallets.ts` | Main export logic |
| Input | `data/ui-parity-results.json` | UI parity test results |
| CSV Output | `data/validated-wallets.csv` | Human-readable export |
| JSON Output | `data/validated-wallets.json` | Machine-readable export |
| README | `scripts/pnl/README-EXPORT-VALIDATED-WALLETS.md` | Detailed usage |
| This Doc | `docs/reports/VALIDATED_WALLETS_EXPORT_GUIDE.md` | Integration guide |

---

## Sample Output

### Terminal Output
```
================================================================================
EXPORT VALIDATED WALLETS FROM UI PARITY RESULTS
================================================================================

📖 Reading input from: data/ui-parity-results.json
   Total candidates: 50

🔍 Applying eligibility criteria:
   - Mapping >= 99.5%
   - Clamp <= 2%

================================================================================
SUMMARY STATISTICS
================================================================================

Total candidates tested:     50
Passed (eligible):           35 (70.0%)
Failed (ineligible):         15 (30.0%)

Average delta % (passed):    0.0370%

Failed count by reason:
  CLAMP_PCT_TOO_HIGH                 8 (16.0%)
  MAPPING_PCT_TOO_LOW                7 (14.0%)

📝 Exporting to CSV...
   ✅ Written: data/validated-wallets.csv
   Rows: 35

📝 Exporting to JSON...
   ✅ Written: data/validated-wallets.json
   Wallets: 35

================================================================================
SAMPLE VALIDATED WALLETS (first 5)
================================================================================

Wallet                                     | Status | UI Net        | V20b Net      | Delta %
-------------------------------------------|--------|---------------|---------------|----------
0x56687bf447db6ffa42ffe2204a05edaa20f55839 | PASS   |  $22053934.00 |  $22050000.00 |  0.0178%
0x1f2dd6d473f3e824cd2f8a89d9c69fb96f6ad0cf | PASS   |  $16620028.00 |  $16615000.00 |  0.0302%

================================================================================
✅ EXPORT COMPLETE
================================================================================

Outputs:
  CSV:  data/validated-wallets.csv
  JSON: data/validated-wallets.json

These files can be shared as the defensible export of validated wallets.
```

---

## Next Steps

1. **Review Outputs**: Open CSV in Excel, inspect JSON structure
2. **Verify Sample Wallets**: Spot-check top wallets against Polymarket UI
3. **Archive**: Save outputs with timestamp for audit trail
4. **Deploy**: Use validated wallet list in production features
5. **Monitor**: Track pass rate over time as data quality improves

---

## Questions?

- **Script details**: See `scripts/pnl/README-EXPORT-VALIDATED-WALLETS.md`
- **UI parity testing**: See `scripts/pnl/comprehensive-v20-accuracy-test.ts`
- **Data quality**: See `docs/systems/pnl/PNL_METRIC_SPEC.md`
- **Database patterns**: See `docs/systems/database/STABLE_PACK_REFERENCE.md`

---

**Last Updated**: 2025-12-15
**Maintainer**: Cascadian Team
**Status**: Production Ready
