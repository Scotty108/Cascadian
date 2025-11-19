# PHASE 1B: @ULTRATHINK - CORRECT P&L FORMULA DESIGN

## Context Summary

**What We Know:**
1. ✅ Phase 1A diagnostic found: 98.38% of trades have `trade_idx = win_idx + 1`
2. ❌ Current formula mixes units (dollars + shares): `SUM(cashflows) + SUM(delta_shares)`
3. ✅ Expected result for niggemon: ~$102,001 (Polymarket published value)
4. ❌ Current result for niggemon: $3.6M (36x inflation)

**Root Causes Identified:**
1. **Index Offset Bug**: `trade_idx` is 1 position ahead of `win_idx` (fix: use `=` with `+1`)
2. **Unit Mismatch Bug**: Settlement shares not multiplied by $1.00 settlement value

**Data Available:**
- `trade_flows_v2`: Contains `wallet`, `market_id`, `trade_idx`, `cashflow_usdc`, `delta_shares`
- `canonical_condition`: Maps `market_id` → `condition_id_norm`
- `winning_index`: Maps `condition_id_norm` → `win_idx`, `resolved_at`

## Formula Design Challenge

**Current (Broken) Formula:**
```sql
realized_pnl_usd = SUM(cashflow_usdc) + SUM(delta_shares where trade_idx = win_idx)
                   [dollars]              [shares - WRONG UNITS!]
                   [=$3.69M]             [=$0 due to index offset]
                   Result: $3.69M ❌
```

**Proposed Fix:**
```sql
realized_pnl_usd = SUM(cashflow_usdc) + (SUM(delta_shares where trade_idx = win_idx + 1) × $1.00)
                   [dollars]           [shares × $1/share = dollars]
                   [=$3.69M]           [=missing settlement]
```

## Question for @ultrathink

1. **Index offset correctness**: Is `trade_idx = win_idx + 1` the right way to match winning outcome trades?
   - Or should it be `trade_idx = win_idx` (since outcome_idx is 1-based in ClickHouse)?
   - What does the 1.62% non-matching trades represent?

2. **Unit conversion**: Confirm that `SUM(delta_shares) × $1.00` correctly computes settlement payout for winning outcomes?
   - delta_shares already has correct sign (+ for BUY, - for SELL)?
   - Need to net shares per condition BEFORE multiplying by $1.00?
   - Or sum ONLY for winning outcomes, which naturally gives net?

3. **Aggregation level**: Should settlement be calculated:
   - Per trade (as now)? → Then sum across all trades in position
   - Per condition? → Then aggregate to wallet
   - Per wallet? → Direct aggregation without intermediate steps

4. **Test case validation**:
   - niggemon current: $3.6M
   - niggemon expected: $102,001
   - With new formula: sum(cashflows=$3.69M) + (settlement=?) = $102,001
   - Implies: settlement must be -$3,587,999 (negative! How?)
   - OR: Fundamental formula structure is wrong?

## Key Constraints

- All data in trade_flows_v2 and winning_index must align correctly
- Must handle both resolved and unresolved markets
- Must not double-count or lose precision
- Must work for all 4 target wallets (niggemon, HolyMoses7, LucasMeow, xcnstrategy)

## Please Design

1. The mathematically correct P&L formula
2. Whether the index offset fix alone is sufficient or if there's deeper structural issue
3. SQL implementation approach
4. Expected values after fix (sanity check)

