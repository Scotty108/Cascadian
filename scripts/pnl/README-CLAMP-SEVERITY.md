# Clamp Severity Calculator

## Overview

`calculate-clamp-severity.ts` measures the dollar impact of the V20b "external inventory clamp" for wallet PnL calculations.

## What It Does

The script analyzes each wallet's SELL transactions to determine how much the external inventory clamp affects their proceeds:

1. **Dedupes trades** by `event_id` (same as V20b)
2. **Tracks position** using window functions (same as V20b)
3. **Compares**:
   - `raw_sell_proceeds` - total USDC from sells (unclamped)
   - `effective_sell_proceeds` - total USDC after clamping sells to available position
   - `clamp_usdc_impact` - dollar difference
   - `clamp_pct` - percentage impact

## Why It Matters

High clamp percentage indicates:
- Wallet is selling tokens NOT acquired via CLOB trades
- Likely sources: airdrops, ERC1155 transfers, LP positions
- These create "phantom profits" that V20b correctly excludes
- **Wallets with ≤2% clamp are good candidates for V20b validation**

## Usage

```bash
# Default: analyze wallets from data/wallet-classification-report.json
npx tsx scripts/pnl/calculate-clamp-severity.ts

# Single wallet
npx tsx scripts/pnl/calculate-clamp-severity.ts --wallet 0x1234...

# Custom wallet list
npx tsx scripts/pnl/calculate-clamp-severity.ts --wallets data/my-wallets.json
```

## Output Files

- `data/wallet-clamp-severity.json` - Full results for all wallets (sorted by clamp_pct)
- `data/candidate-wallets.json` - Filtered list of wallets with ≤2% clamp

## Output Format

```json
{
  "wallet_address": "0x8bd71f72...",
  "raw_sell_proceeds": 357.13,
  "effective_sell_proceeds": 354.39,
  "clamp_usdc_impact": 2.74,
  "clamp_pct": 0.77,
  "sell_trade_count": 28,
  "clamped_trade_count": 14
}
```

## Results Interpretation

| Clamp % | Status | Meaning |
|---------|--------|---------|
| 0-2% | ✅ Good | Minimal external inventory, good V20b candidate |
| 2-5% | ⚠️ Warning | Some external activity, review case-by-case |
| >5% | ❌ High | Significant external inventory, V20b will undercount |

## Technical Details

Uses the exact same dedupe + window function logic as V20b:

```sql
WITH
  -- Step 1: Dedupe by event_id
  dedup AS (
    SELECT event_id, any(usdc_delta) AS usdc, any(token_delta) AS tokens, ...
    FROM pm_unified_ledger_v9_clob_tbl
    GROUP BY event_id
  ),
  -- Step 2: Track running position
  ordered AS (
    SELECT *, sum(tokens) OVER (PARTITION BY cid, oidx ORDER BY etime, event_id
                                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS pos_before
    FROM dedup
  ),
  -- Step 3: Clamp sells
  clamped AS (
    SELECT
      if(tokens < 0, greatest(tokens, -greatest(pos_before, 0)), tokens) AS token_delta_eff,
      if(tokens < 0, usdc * (greatest(tokens, -pos_before) / tokens), usdc) AS usdc_delta_eff
    FROM ordered
  )
```

## Example Output

From 23 wallet test:
- ✅ **1 wallet** with ≤2% clamp (0x8bd71f72... at 0.77%)
- ⚠️ **4 wallets** in warning range (2-5%)
- ❌ **18 wallets** with high clamp (>5%)

Top candidate:
```
0x8bd71f723fc31f5bfff8a2210628f9ab67b949a5
  clamp: 0.77%
  impact: $2.74
  trades: 14/28 sells clamped
```

## Next Steps

Use the filtered `candidate-wallets.json` for:
1. V20b accuracy validation
2. Benchmark creation
3. UI parity testing
