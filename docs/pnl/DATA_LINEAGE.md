# PnL Data Lineage

> Last updated: 2025-12-15
> Status: Active development - V17 is canonical for CLOB-only flat wallets

## Source Tables

### Primary Fills Source
| Table | Rows | Purpose | Notes |
|-------|------|---------|-------|
| `pm_trader_events_dedup_v2_tbl` | ~520M | Canonical CLOB fills | Has 2x rows per event_id - MUST use GROUP BY event_id |
| `pm_trader_events_v2` | ~520M | Raw CLOB fills | Source table, more duplicates |

### Token Mapping
| Table | Purpose | Notes |
|-------|---------|-------|
| `pm_token_to_condition_map_v5` | token_id -> (condition_id, outcome_index) | Latest version, use this |
| `pm_token_to_condition_map_v3` | Legacy mapping | Deprecated, less coverage |

### Resolution Data
| Table | Purpose | Notes |
|-------|---------|-------|
| `pm_condition_resolutions` | condition_id -> payout_numerators | JSON array, 1-indexed via arrayElement |

### Wallet Classification
| Table | Purpose | Notes |
|-------|---------|-------|
| `wallet_classification_latest` | CLOB-only detection | erc1155_transfer_count, split_merge_count |

## Engines

### V17 (Canonical for Cascadian)
- **File**: `lib/pnl/uiActivityEngineV17.ts`
- **Source tables**: pm_trader_events_dedup_v2_tbl, pm_token_to_condition_map_v5, pm_condition_resolutions
- **Formula**: `realized_pnl = trade_cash_flow + (final_shares * resolution_price)`
- **Normalization**: Paired-outcome hedge leg filtering (drops sell leg from complete-set trades)
- **Status**: FROZEN - do not modify without explicit approval

### V29 (Archived)
- **File**: `lib/pnl/archive/engines_pre_v12/inventoryEngineV29.ts`
- **Purpose**: Earlier validation attempt
- **Status**: Archived

## Validation Target

### UI Tooltip Net (Polymarket)
- **What it shows**: Total P&L including realized + unrealized
- **Where**: Hover on info icon next to "Profit / Loss" on profile page
- **URL pattern**: `https://polymarket.com/profile/{wallet}`
- **Fields extracted**: Volume traded, Gain, Loss, Net total

### Current Validation Scope
For the first high-confidence export, validate only wallets that are:
- `--clob-only`: No ERC1155 transfers, no split/merge
- `--no-open`: No open positions (is_flat = true)
- `mapping_coverage >= 99%`: Nearly all fills map to condition_ids

### Pass Criteria (Strict)
- For small PnL (|ui_net| < $25): `abs_delta <= $0.25`
- For larger PnL (|ui_net| >= $25): `abs_delta <= max($0.25, 1% of |ui_net|)`

## Known Gaps

### Not Yet Handled
1. **ERC1155 transfers** - Direct token transfers without CLOB trades
2. **CTF split/merge** - Complete set minting/redemption
3. **FPMM (AMM) trades** - Deprecated, most activity is CLOB now
4. **Proxy wallets** - Trading through intermediate contracts

### Known Definition Differences
1. **Paired-outcome normalization**: V17 filters hedge legs, UI may not
2. **Unrealized mark price**: V17 uses 0.5, UI may use last trade price
3. **Fee treatment**: Needs investigation

## Critical Patterns

### CLOB Deduplication (REQUIRED)
```sql
SELECT ... FROM (
  SELECT
    event_id,
    any(side) as side,
    any(usdc_amount) / 1e6 as usdc,
    any(token_amount) / 1e6 as tokens
  FROM pm_trader_events_dedup_v2_tbl
  WHERE trader_wallet = '0x...'
  GROUP BY event_id
) ...
```

### Resolution Price Lookup
```sql
arrayElement(
  JSONExtract(r.payout_numerators, 'Array(Float64)'),
  m.outcome_index + 1  -- ClickHouse arrays are 1-indexed
)
```

## Validation Scripts

| Script | Purpose |
|--------|---------|
| `scripts/pnl/validate-duel-vs-ui-synthetic.ts` | Main Playwright-based UI validation |
| `scripts/pnl/test-v17-from-benchmark-table.ts` | Benchmark table validation |

## Export Workflow

```bash
# 1. Clear old state
rm -rf /tmp/duel-ui-validation
mkdir -p /tmp/duel-ui-validation

# 2. Start new validation
npx tsx scripts/pnl/validate-duel-vs-ui-synthetic.ts --count=200 --clob-only --no-open

# 3. Scrape UI values using Playwright (interactive)
# ... save results ...

# 4. Generate report
npx tsx scripts/pnl/validate-duel-vs-ui-synthetic.ts --report

# 5. Export CSV for analysis
npx tsx scripts/pnl/validate-duel-vs-ui-synthetic.ts --csv
```
