# Export Validated Wallets

## Overview

The `export-validated-wallets.ts` script reads UI parity test results and exports wallets that meet validation criteria to CSV and JSON formats. This creates a defensible export that can be shared with anyone.

## Usage

```bash
npx tsx scripts/pnl/export-validated-wallets.ts
```

## Input

The script expects a JSON file at:
```
data/ui-parity-results.json
```

### Expected Format

```json
{
  "timestamp": "2025-12-15T00:00:00.000Z",
  "metadata": {
    "test_type": "v20b_ui_parity",
    "total_tested": 50
  },
  "results": [
    {
      "wallet": "0x...",
      "name": "WalletName",
      "status": "PASS",
      "ui_net": 1000000.00,
      "ui_gain": 1200000.00,
      "ui_loss": -200000.00,
      "ui_volume": 2000000.00,
      "v20b_net": 999500.00,
      "delta_abs": 500.00,
      "delta_pct": 0.05,
      "clamp_pct": 0.25,
      "mapping_pct": 99.95,
      "mapped_clob_rows": 5000,
      "markets": 150,
      "sign_match": true
    }
  ]
}
```

## Eligibility Criteria

Wallets must meet ALL of the following criteria:

1. **Status**: `PASS`
2. **Mapping Percentage**: >= 99.5%
3. **Clamp Percentage**: <= 2.0%

These criteria can be adjusted in the script by modifying the `DEFAULT_CRITERIA` object.

## Outputs

### 1. CSV File: `data/validated-wallets.csv`

Columns:
- `wallet_address`: Ethereum wallet address
- `v20b_ui_parity_status`: Validation status (PASS/FAIL)
- `ui_net`: UI total PnL
- `ui_gain`: UI total gains
- `ui_loss`: UI total losses
- `ui_volume`: UI trading volume
- `v20b_net`: V20b engine total PnL
- `delta_abs`: Absolute delta between UI and V20b
- `delta_pct`: Percentage delta
- `clamp_pct`: Percentage of clamped values
- `mapped_clob_rows`: Number of CLOB rows mapped
- `markets`: Number of markets traded

### 2. JSON File: `data/validated-wallets.json`

Structure:
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
  "validated_wallets": [...]
}
```

## Summary Statistics

The script prints:

1. **Total candidates tested**: Number of wallets in input file
2. **Passed count**: Wallets meeting all criteria
3. **Failed count by reason**: Breakdown of why wallets failed
4. **Average delta %**: Average percentage difference for passed wallets

## Example Output

```
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
```

## Sample Validated Wallets Table

```
Wallet                                     | Status | UI Net        | V20b Net      | Delta %
-------------------------------------------|--------|---------------|---------------|----------
0x56687bf447db6ffa42ffe2204a05edaa20f55839 | PASS   |  $22053934.00 |  $22050000.00 |  0.0178%
0x1f2dd6d473f3e824cd2f8a89d9c69fb96f6ad0cf | PASS   |  $16620028.00 |  $16615000.00 |  0.0302%
```

## Workflow

1. Run UI parity validation script to generate `data/ui-parity-results.json`
2. Run this export script: `npx tsx scripts/pnl/export-validated-wallets.ts`
3. Share the generated CSV/JSON files as the defensible export

## Notes

- If no wallets pass criteria, script exits with warning (no files created)
- CSV format is suitable for Excel/Google Sheets
- JSON format is suitable for programmatic processing
- Both files can be version controlled for audit trail
- The sample input file at `data/ui-parity-results.json` can be used for testing

## Customization

To adjust validation criteria, modify the `DEFAULT_CRITERIA` object in the script:

```typescript
const DEFAULT_CRITERIA: ValidationCriteria = {
  min_mapping_pct: 99.5,  // Adjust minimum mapping %
  max_clamp_pct: 2.0,     // Adjust maximum clamp %
};
```
