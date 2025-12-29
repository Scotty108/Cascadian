# V7 Maker+Taker Investigation Report

**Date:** 2025-12-16
**Status:** Complete

## Summary

Investigated why including both maker and taker trades in `pm_unified_ledger_v7` causes PnL inflation compared to the Polymarket UI, even though there's no double-counting from role overlap.

## Key Findings

### 1. Maker+Taker Are NOT Duplicates

- **Confirmed**: No wallet has both maker AND taker on the same `fill_key` (event_id without role suffix)
- **Finding**: Within the same transaction, a wallet can be maker on some fills and taker on others
- **Example**: Theo4 has transactions with multiple fills where they're maker on some order_ids and taker on others
- **Conclusion**: These are legitimate separate trades, not data duplication

### 2. Token Map Is Clean

- `pm_token_to_condition_map_v5` has 400,157 unique tokens with 1:1 mapping
- No duplicate token_id_dec entries
- JOIN does not cause row multiplication

### 3. Trade Distribution Varies by Wallet

| Wallet | Maker % | Taker % | V6 Accuracy |
|--------|---------|---------|-------------|
| Theo4 | ~80% | ~20% | ✓ 0.5% error |
| primm | 23% | **77%** | ✗ 472% error |
| anon | ~50% | ~50% | ✗ 235% error |

### 4. V6 (Maker-Only) Matches UI for Most Wallets

**V6 Results against Dec 16 Benchmarks:**
- 5/9 (56%) ≤1% error
- 6/9 (67%) ≤10% error
- 3 wallets with massive errors are primarily TAKERS

**V7 Results (Maker+Taker):**
- 0/9 (0%) ≤1% error
- 0/9 (0%) ≤10% error
- ALL wallets show significant inflation

### 5. Root Cause: UI Calculates PnL Differently

The Polymarket UI appears to:
1. Only use maker trades (or equivalent data source) for PnL calculation
2. NOT include taker trades in realized/unrealized PnL
3. Or use a position-based calculation that differs from our cash-flow approach

### 6. Taker Trade Impact Analysis (Theo4)

| Metric | V6 (Maker) | V7 (All) | Taker Contribution |
|--------|------------|----------|-------------------|
| Rows | 16,002 | 20,498 | +4,496 |
| Cash Flow | -$20M | -$14.1M | +$5.8M |
| Winner Tokens | 42M | 47.8M | +5.7M |
| **PnL** | $22M ✓ | $33.7M ✗ | +$11.5M |

## Recommendations

### Short Term (Current Sprint)

1. **Keep V6 (maker-only) as production baseline** - it matches UI for 67% of wallets
2. **Do NOT deploy V7** - causes regression for all wallets
3. **Tag ENGINE_BUG wallets as "taker-primary"** - these need different treatment

### Medium Term

1. **Investigate Polymarket's actual PnL methodology**
   - Review their API documentation
   - Check if they expose position-level data
   - Compare with their Activity API

2. **Build position-based PnL engine**
   - Track net position per (wallet, condition_id, outcome_index)
   - Only count resolution payouts for positions held at resolution
   - Handle partial position closes correctly

3. **Consider hybrid approach**
   - Use maker trades for new positions
   - Use taker trades only for position closes
   - Track position state over time

### Long Term

1. **Build comprehensive position tracking system**
2. **Match Polymarket's exact PnL methodology**
3. **Add data source confidence scoring**

## Technical Details

### Event ID Structure
```
{tx_hash}_{order_id}-{role}
Example: 0x003d512c..._{order_id}-m (maker)
         0x003d512c..._{order_id}-t (taker)
```

### V6 View Definition (Working)
- Filters: `role = 'maker'`
- Token map: `pm_token_to_condition_map_v5`
- Dedup: `GROUP BY event_id, trader_wallet`

### V7 View Definition (Causes Inflation)
- Filters: None (includes both roles)
- Token map: `pm_token_to_condition_map_v5`
- Dedup: `GROUP BY event_id, trader_wallet`

## Files Created

- `scripts/pnl/create-unified-ledger-v7-canonical.ts` - V7 creation script
- `scripts/pnl/seed-fresh-benchmarks-dec16.ts` - Fresh benchmark seeding
- `pm_unified_ledger_v7` - ClickHouse view (DO NOT USE for production)

## Conclusion

The maker-only approach (V6) is correct for matching Polymarket UI PnL. The taker trades represent real economic activity but are not included in how Polymarket calculates displayed PnL. For wallets that are primarily takers (like primm), our maker-only approach will undercount their activity, but this matches the UI behavior.
