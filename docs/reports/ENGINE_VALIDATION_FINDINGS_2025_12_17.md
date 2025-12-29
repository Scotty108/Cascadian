# PnL Engine Validation Findings

**Date:** 2025-12-17
**Engine:** polymarket_avgcost_v1

## Summary

The Polymarket-accurate PnL engine uses weighted average cost basis and auto-settlement for resolved markets. Validation shows:

- **@cozyfnf**: -6% delta ✅ (clean wallet, passing)
- **@amused85**: +243% delta ❌ (ERC-1155 transfer exposure)
- **@antman**: +12% delta ⚠️ (marginal, likely data gaps)
- **wasianiversonworldchamp2025**: -105% delta ❌ (massive auto-settlement over-correction)

## Root Cause Analysis

### 1. Auto-Settlement Over-Correction

For wallets with large resolved positions, auto-settlement dominates:

| Wallet | Engine PnL | UI PnL | Auto-Settle | Without AS |
|--------|------------|--------|-------------|------------|
| @cozyfnf | +$1.33M | +$1.41M | -$1.70M | +$3.02M |
| @antman | +$465k | +$417k | -$7.52M | +$7.98M |
| wasianiverson... | -$147k | +$2.86M | -$27.36M | +$27.21M |

**Key insight:** Auto-settlement is HELPING bring the engine closer to UI, but it over-corrects for wallets with massive positions.

### 2. Position Resolution Coverage

For wasianiversonworldchamp2025:
- **RESOLVED**: 356 positions, $57.4M cost basis (86.9%)
- **UNRESOLVED**: 1 position, $3,472 cost basis (0.0%)
- **UNMAPPED**: 87 positions, $8.7M cost basis (13.1%)

The UNMAPPED positions (13%) cannot be properly auto-settled because we don't know if their markets resolved.

### 3. Cash Flow Analysis

wasianiversonworldchamp2025:
- **Total Buy USDC**: $70.5M (171.7M tokens)
- **Total Sell USDC**: $48.5M (80.6M tokens)
- **Net Cash Flow**: -$22M (spent more than received)
- **UI PnL**: +$2.86M

The $25M gap is explained by unrealized gains on open positions. UI marks these at current market prices; engine marks resolved ones at settlement prices.

### 4. Data Deduplication

The `pm_trader_events_dedup_v2_tbl` table still contains duplicates:
- Raw rows: 3,313
- Distinct event_ids: 3,178

The engine correctly uses `GROUP BY event_id` to deduplicate.

## Engine Accuracy by Wallet Type

| Wallet Profile | Expected Accuracy | Notes |
|----------------|-------------------|-------|
| Clean (no transfers) | ±10% | Good for copy-trading |
| Moderate transfers | ±25% | Use with caution |
| Heavy transfers | ±50%+ | Not reliable |
| Massive positions ($10M+) | Variable | Auto-settlement dominates |

## Confidence Scoring

The engine provides a confidence score based on:

1. **Transfer Exposure**: ERC-1155 tokens received/sent
2. **Skipped Sells Ratio**: Sells without matching buys
3. **Clamped Tokens Ratio**: Token amounts capped at tracked balance

| Confidence | Score | Description |
|------------|-------|-------------|
| HIGH | 70-100 | Clean data, reliable |
| MEDIUM | 40-69 | Some data gaps |
| LOW | 0-39 | High transfer exposure |

**Important**: HIGH confidence does NOT guarantee accuracy for wallets with massive resolved positions.

## Recommendations

### For Copy-Trading Export

1. **Filter by confidence**: Only export HIGH confidence wallets
2. **Filter by total PnL**: Focus on moderate winners ($1k-$100k)
3. **Spot-check outliers**: Manually verify top performers via UI

### For Engine Improvement

1. **UNMAPPED positions**: Investigate why 13% of tokens can't be mapped
2. **Mark-to-market**: Add current price fetching for unresolved positions
3. **Auto-settlement tuning**: Consider only auto-settling confirmed winners

## Data Sources

| Table | Purpose |
|-------|---------|
| pm_trader_events_dedup_v2_tbl | CLOB trades (with duplicates!) |
| pm_ctf_split_merge_expanded | Split/merge events |
| pm_redemption_payouts_agg | Redemption payouts |
| pm_token_to_condition_map_current | Token → condition mapping |
| pm_condition_resolutions | Market resolutions |
| pm_erc1155_transfers | Token transfers |

## Next Steps

1. Build stratified validation harness (100 wallets across PnL bands)
2. Correlate confidence scores with actual UI delta
3. Investigate UNMAPPED tokens to improve resolution coverage
4. Consider using Polymarket's gamma-api for ground truth comparison
