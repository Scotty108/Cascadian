# PnL Engine CLOB Accuracy Analysis - Final Report

**Date:** January 10, 2026
**Status:** Complete

## Executive Summary

We've identified the complete formula for accurate CLOB-only PnL calculation and characterized which wallets it works for.

### The Correct Formula

```
PnL = Cash_flow + Long_wins - Short_losses
```

Where:
- **Cash_flow** = Σ(sell_usdc) - Σ(buy_usdc)
- **Long_wins** = Σ(net_tokens) for positions where net_tokens > 0 AND outcome won
- **Short_losses** = Σ(|net_tokens|) for positions where net_tokens < 0 AND outcome won

The key insight: **Short positions that "win" create a liability**. If you sold more than you bought and the outcome wins, you owe $1 per token.

## Accuracy Results

### Validation Wallets (No Phantom Inventory)

| Multi-Outcome % | Wallets | Within $1 | Within $100 | Avg Error |
|-----------------|---------|-----------|-------------|-----------|
| < 10% | 10 | **100%** | 100% | $0.01 |
| < 20% | 11 | **100%** | 100% | $0.01 |
| < 30% | 15 | 93% | 100% | $0.24 |
| < 40% | 19 | 90% | 95% | $7.03 |
| < 50% | 20 | 90% | 95% | $6.68 |
| All | 125 | 74% | 90% | $59.65 |

### Key Findings

1. **Wallets with <20% multi-outcome trades achieve 100% accuracy within $1**
2. **Wallets with phantom inventory cannot be calculated from CLOB alone** (437 of 600 validation wallets)
3. **73% of validation trades are in multi-outcome events** - these require special NegRisk netting

## Classification Criteria

### High Confidence (Use CLOB Calculation)

Wallets that meet BOTH criteria:
1. **No phantom inventory**: `YES_sold <= YES_bought * 1.01` AND `NO_sold <= NO_bought * 1.01`
2. **Low multi-outcome trading**: Less than 30% of trades in multi-outcome events

Expected accuracy: 93-100% within $1

### Low Confidence (Use API Fallback)

Any wallet with:
- Phantom inventory (sells tokens never bought via CLOB)
- High multi-outcome trading (>30% of trades)

## Implementation

### SQL Query for High-Confidence PnL

```sql
WITH
  positions AS (
    SELECT
      wallet,
      condition_id,
      outcome_index,
      sum(CASE WHEN side = 'buy' THEN token_amount ELSE -token_amount END) as net_tokens,
      sum(CASE WHEN side = 'sell' THEN usdc_amount ELSE -usdc_amount END) as cash_flow
    FROM pm_validation_fills_canon_v1
    GROUP BY wallet, condition_id, outcome_index
  )
SELECT
  wallet,
  sum(cash_flow) +
  sum(CASE WHEN net_tokens > 0 AND payout = 1 THEN net_tokens ELSE 0 END) -
  sum(CASE WHEN net_tokens < 0 AND payout = 1 THEN -net_tokens ELSE 0 END) as pnl
FROM positions p
LEFT JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id
GROUP BY wallet
```

### Wallet Classification Query

```sql
WITH
  wallet_inventory AS (
    SELECT wallet,
      sumIf(tokens, outcome = 0 AND side = 'buy') as yes_bought,
      sumIf(tokens, outcome = 0 AND side = 'sell') as yes_sold,
      sumIf(tokens, outcome = 1 AND side = 'buy') as no_bought,
      sumIf(tokens, outcome = 1 AND side = 'sell') as no_sold
    FROM trades
    GROUP BY wallet
    HAVING yes_sold <= yes_bought * 1.01 AND no_sold <= no_bought * 1.01
  ),
  wallet_multi_pct AS (
    SELECT wallet, countIf(is_multi_outcome) / count() as multi_pct
    FROM trades WHERE wallet IN (SELECT wallet FROM wallet_inventory)
    GROUP BY wallet
  )
SELECT wallet,
  CASE WHEN multi_pct < 0.30 THEN 'high_confidence' ELSE 'low_confidence' END as tier
FROM wallet_multi_pct
```

## Tables Created

| Table | Purpose |
|-------|---------|
| `pm_validation_fills_canon_v1` | Canonical fills with self-fill collapse |
| `pm_multi_outcome_events_v1` | Events with 3+ conditions (NegRisk-like) |

## Root Causes of Errors

1. **Self-fill double-counting** (SOLVED): Keep only taker leg when wallet is both maker and taker
2. **Short position liability** (SOLVED): Subtract losses from short positions that win
3. **Phantom inventory** (UNSOLVABLE from CLOB): NegRisk minting deposits collateral off-CLOB
4. **Multi-outcome netting** (PARTIALLY SOLVED): Filter out high multi-outcome wallets

## Recommendations

### For Copy Trading Metrics

1. **Use CLOB for**: Trade timing, position sizing, market selection
2. **Use API for**: Absolute PnL numbers
3. **Use CLOB calculation for**: High-confidence wallets (no phantom + low multi-outcome)

### For Production

1. Classify wallets on first sync using inventory + multi-outcome criteria
2. Use CLOB PnL for high-confidence wallets (faster, no API dependency)
3. Fall back to API for low-confidence wallets

---

*Analysis completed: January 10, 2026*
